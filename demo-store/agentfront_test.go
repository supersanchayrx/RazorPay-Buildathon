package main

// The merchant's half of Tier C, driven through a real server.
//
// WHAT THIS SUITE IS ACTUALLY DEFENDING. This middleware sits in front of every
// response a storefront makes. It buffers, it rewrites, and it calls a third
// party while a customer waits. Each of those is a way to break a shop that was
// working fine, and none of them announce themselves:
//
//   - a truncated asset still returns 200
//   - a page served without the injection looks identical to a page served with
//     it, unless you read the source
//   - a gateway that hangs turns into a storefront that hangs
//
// So the assertions below are mostly about the store SURVIVING this file, not
// about the feature working. The feature is the smaller half of the risk.
//
//	go test ./...

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const jsonldTag = `<script type="application/ld+json">{"@type":"Product","name":"Green Tea"}</script>`
const linkTag = `<link rel="ucp" type="application/json" href="/.well-known/ucp">`

// A gateway that answers agentview and llms.txt, and counts how often it is
// asked — because "does the cache work?" is a question about call counts.
func fakeGateway(t *testing.T, hits *int64) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/llms.txt") {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = io.WriteString(w, "# Test Store\n")
			return
		}
		atomic.AddInt64(hits, 1)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{
			"page": "product",
			"head": %q,
			"jsonld": %q,
			"link": "</.well-known/ucp>; rel=\"ucp\"",
			"json": {"page":"product","path":%q},
			"max_age": 300
		}`, jsonldTag+linkTag, jsonldTag, r.URL.Query().Get("path"))
	}))
}

const page = `<!doctype html><html><head><title>Green Tea</title></head><body>Hello</body></html>`

// A storefront: one HTML page, one asset, one JSON API, one 404.
func storefront() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/product.html", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, page)
	})
	mux.HandleFunc("/already-tagged.html", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w,
			`<!doctype html><html><head><script type="application/ld+json">{"@type":"Product","name":"Theirs"}</script></head><body></body></html>`)
	})
	mux.HandleFunc("/fragment.html", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, `<div>no head here</div>`)
	})
	mux.HandleFunc("/huge.html", func(w http.ResponseWriter, r *http.Request) {
		// An HTML page past captureMax. This is the ONLY path that reaches the
		// mid-stream flush, because a non-HTML response streams from its first
		// byte and never grows the buffer at all.
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, "<!doctype html><html><head></head><body>")
		chunk := bytes.Repeat([]byte("y"), 1<<20)
		for i := 0; i < 5; i++ {
			_, _ = w.Write(chunk)
		}
		_, _ = io.WriteString(w, "</body></html>")
	})
	mux.HandleFunc("/api/orders", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = io.WriteString(w, `{"orders":[]}`)
	})
	mux.HandleFunc("/big.bin", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		// Deliberately larger than captureMax. An earlier draft buffered every
		// response and gave up past the cap, which served this file's first
		// 4 MB with a 200 and no warning anywhere.
		chunk := bytes.Repeat([]byte("x"), 1<<20)
		for i := 0; i < 5; i++ {
			_, _ = w.Write(chunk)
		}
	})
	return mux
}

func serve(h http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestInjectsIntoHTML(t *testing.T) {
	var hits int64
	gw := fakeGateway(t, &hits)
	defer gw.Close()
	h := newTierC(gw.URL, "pk_test").wrap(storefront())

	rec := serve(h, httptest.NewRequest("GET", "/product.html?handle=green-tea", nil))
	body := rec.Body.String()

	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	if !strings.Contains(body, jsonldTag) {
		t.Error("JSON-LD was not injected")
	}
	if !strings.Contains(body, linkTag) {
		t.Error("ucp link tag was not injected")
	}
	if i, j := strings.Index(body, jsonldTag), strings.Index(body, "</head>"); i > j {
		t.Error("injected after </head>, which puts it in the body")
	}
	if !strings.Contains(body, "Hello") {
		t.Error("the page's own content was lost")
	}
	if got := rec.Header().Get("Link"); !strings.Contains(got, `rel="ucp"`) {
		t.Errorf("Link header = %q", got)
	}
	// Without Vary a shared cache stores one representation of this URL and
	// hands it to everyone — JSON to a browser, or the page to an agent.
	if got := rec.Header().Get("Vary"); !strings.Contains(got, "Accept") {
		t.Errorf("Vary = %q, want Accept", got)
	}
	// The body grew; a stale Content-Length would truncate it at the client.
	if got := rec.Header().Get("Content-Length"); got != "" {
		t.Errorf("Content-Length left behind = %q", got)
	}
}

func TestPathSentToGatewayIncludesQuery(t *testing.T) {
	var hits int64
	gw := fakeGateway(t, &hits)
	defer gw.Close()
	h := newTierC(gw.URL, "pk_test").wrap(storefront())

	// The gateway must be told the FULL request URI. Send only the path and
	// every product page gets the homepage's markup — which looks like it is
	// working. The fake gateway echoes back the path it was given.
	rec := serve(h, httptest.NewRequest("GET", "/product.html?handle=green-tea&format=json", nil))
	if !strings.Contains(rec.Body.String(), "handle=green-tea") {
		t.Errorf("gateway was not told the query string: %s", rec.Body.String())
	}
}

func TestContentNegotiation(t *testing.T) {
	var hits int64
	gw := fakeGateway(t, &hits)
	defer gw.Close()
	h := newTierC(gw.URL, "pk_test").wrap(storefront())

	cases := []struct {
		name     string
		url      string
		accept   string
		wantJSON bool
	}{
		{"query parameter", "/product.html?format=json", "", true},
		{"accept header", "/product.html", "application/json", true},
		{"a browser", "/product.html", "text/html,application/xhtml+xml,*/*;q=0.8", false},
		{"a client with no opinion", "/product.html", "*/*", false},
		{"plain request", "/product.html", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", c.url, nil)
			if c.accept != "" {
				req.Header.Set("Accept", c.accept)
			}
			rec := serve(h, req)
			ct := rec.Header().Get("Content-Type")
			isJSON := strings.HasPrefix(ct, "application/json")
			if isJSON != c.wantJSON {
				t.Errorf("content-type %q, wantJSON=%v", ct, c.wantJSON)
			}
			if c.wantJSON && !strings.Contains(rec.Body.String(), `"page":"product"`) {
				t.Errorf("machine view missing: %s", rec.Body.String())
			}
			if !c.wantJSON && !strings.Contains(rec.Body.String(), "<!doctype html>") {
				t.Error("expected the page")
			}
		})
	}
}

// The property the whole file is arranged around.
func TestGatewayDownServesThePage(t *testing.T) {
	// A gateway that is not there at all.
	h := newTierC("http://127.0.0.1:1", "pk_test").wrap(storefront())

	rec := serve(h, httptest.NewRequest("GET", "/product.html", nil))
	if rec.Code != 200 {
		t.Fatalf("status = %d — the shop went down with the gateway", rec.Code)
	}
	if rec.Body.String() != page {
		t.Errorf("page was altered:\n%s", rec.Body.String())
	}

	// Asking for JSON when we cannot produce one gets the page, not a 502. The
	// caller learns the machine view is unavailable by getting HTML, which is a
	// worse answer and a working store.
	req := httptest.NewRequest("GET", "/product.html?format=json", nil)
	rec = serve(h, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "<!doctype html>") {
		t.Errorf("status %d, body %q", rec.Code, rec.Body.String())
	}
}

func TestGatewaySlownessIsBounded(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5 * time.Second)
	}))
	defer slow.Close()

	h := newTierC(slow.URL, "pk_test").wrap(storefront())
	start := time.Now()
	rec := serve(h, httptest.NewRequest("GET", "/product.html", nil))
	elapsed := time.Since(start)

	if rec.Code != 200 || rec.Body.String() != page {
		t.Error("a slow gateway cost the customer their page")
	}
	// The client timeout is 2.5s. Anything near the gateway's 5s means the
	// storefront inherited someone else's latency.
	if elapsed > 4*time.Second {
		t.Errorf("waited %v on a third party while a customer watched", elapsed)
	}
}

func TestAssetsPassThroughIntact(t *testing.T) {
	var hits int64
	gw := fakeGateway(t, &hits)
	defer gw.Close()
	h := newTierC(gw.URL, "pk_test").wrap(storefront())

	rec := serve(h, httptest.NewRequest("GET", "/big.bin", nil))
	if got := rec.Body.Len(); got != 5<<20 {
		t.Errorf("served %d bytes of a %d byte file — silent truncation", got, 5<<20)
	}
	if n := atomic.LoadInt64(&hits); n != 0 {
		t.Errorf("asked the gateway about a binary file %d times", n)
	}
}

// The mid-stream flush, which the asset test cannot reach.
//
// A page bigger than the buffer is not one we will rewrite, but it is still a
// page the shop has to deliver. This exists because the first draft returned
// len(b) and threw the bytes away — a 200 with a document cut off mid-word.
func TestOversizedHTMLIsServedWhole(t *testing.T) {
	var hits int64
	gw := fakeGateway(t, &hits)
	defer gw.Close()
	h := newTierC(gw.URL, "pk_test").wrap(storefront())

	rec := serve(h, httptest.NewRequest("GET", "/huge.html", nil))
	body := rec.Body.String()

	// Counted from the literals, not written down. A hand-computed length is a
	// second copy of the fixture that drifts the moment the fixture changes.
	want := len("<!doctype html><html><head></head><body>") + 5<<20 + len("</body></html>")
	if len(body) != want {
		t.Errorf("served %d bytes of a %d byte page — silent truncation", len(body), want)
	}
	if !strings.HasSuffix(body, "</body></html>") {
		t.Error("the end of the document never arrived")
	}
	if strings.Contains(body, "ld+json") {
		t.Error("rewrote a page we had already given up buffering")
	}
}

func TestJSONAPIsAreNotHijacked(t *testing.T) {
	var hits int64
	gw := fakeGateway(t, &hits)
	defer gw.Close()
	h := newTierC(gw.URL, "pk_test").wrap(storefront())

	req := httptest.NewRequest("GET", "/api/orders", nil)
	req.Header.Set("Accept", "application/json")
	rec := serve(h, req)

	if rec.Body.String() != `{"orders":[]}` {
		t.Errorf("the store's own API was replaced with the machine view: %s", rec.Body.String())
	}
	if n := atomic.LoadInt64(&hits); n != 0 {
		t.Errorf("gateway consulted for a JSON endpoint %d times", n)
	}
}

func TestExistingStructuredDataWins(t *testing.T) {
	var hits int64
	gw := fakeGateway(t, &hits)
	defer gw.Close()
	h := newTierC(gw.URL, "pk_test").wrap(storefront())

	body := serve(h, httptest.NewRequest("GET", "/already-tagged.html", nil)).Body.String()

	if n := strings.Count(body, "application/ld+json"); n != 1 {
		t.Errorf("%d ld+json blocks — two Product nodes is an ambiguous page, not a richer one", n)
	}
	if !strings.Contains(body, `"Theirs"`) {
		t.Error("the merchant's own markup was replaced")
	}
	if !strings.Contains(body, linkTag) {
		t.Error("the link tag should still go in — it is not structured data")
	}
}

func TestPagesWithoutAHeadAreLeftAlone(t *testing.T) {
	var hits int64
	gw := fakeGateway(t, &hits)
	defer gw.Close()
	h := newTierC(gw.URL, "pk_test").wrap(storefront())

	body := serve(h, httptest.NewRequest("GET", "/fragment.html", nil)).Body.String()
	if body != `<div>no head here</div>` {
		t.Errorf("rewrote a document that did not have the shape we expected: %s", body)
	}
}

func TestNonGETIsUntouched(t *testing.T) {
	var hits int64
	gw := fakeGateway(t, &hits)
	defer gw.Close()
	h := newTierC(gw.URL, "pk_test").wrap(storefront())

	rec := serve(h, httptest.NewRequest("POST", "/product.html", nil))
	if strings.Contains(rec.Body.String(), "ld+json") {
		t.Error("a form result is not a page an agent should be told it can re-fetch as data")
	}
	if n := atomic.LoadInt64(&hits); n != 0 {
		t.Errorf("gateway consulted on a POST %d times", n)
	}
}

func TestNotFoundStaysNotFound(t *testing.T) {
	var hits int64
	gw := fakeGateway(t, &hits)
	defer gw.Close()
	h := newTierC(gw.URL, "pk_test").wrap(storefront())

	rec := serve(h, httptest.NewRequest("GET", "/nope.html", nil))
	if rec.Code != 404 {
		t.Errorf("status = %d, want 404", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "ld+json") {
		t.Error("published a Product node on an error page")
	}
}

func TestViewIsCachedPerPath(t *testing.T) {
	var hits int64
	gw := fakeGateway(t, &hits)
	defer gw.Close()
	h := newTierC(gw.URL, "pk_test").wrap(storefront())

	for i := 0; i < 3; i++ {
		serve(h, httptest.NewRequest("GET", "/product.html?handle=green-tea", nil))
	}
	if n := atomic.LoadInt64(&hits); n != 1 {
		t.Errorf("%d gateway calls for 3 identical requests — this runs on every page load", n)
	}

	serve(h, httptest.NewRequest("GET", "/product.html?handle=other", nil))
	if n := atomic.LoadInt64(&hits); n != 2 {
		t.Errorf("%d calls — a different product must not reuse another's markup", n)
	}
}

func TestLLMsTxtIsProxied(t *testing.T) {
	var hits int64
	gw := fakeGateway(t, &hits)
	defer gw.Close()
	tc := newTierC(gw.URL, "pk_test")

	rec := serve(http.HandlerFunc(tc.handleLLMs), httptest.NewRequest("GET", "/llms.txt", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "# Test Store") {
		t.Errorf("status %d body %q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Errorf("content-type %q — a type the browser offers to download is worse than an unrendered heading", ct)
	}
}

func TestLLMsTxtIs404WhenGatewayIsDown(t *testing.T) {
	tc := newTierC("http://127.0.0.1:1", "pk_test")
	rec := serve(http.HandlerFunc(tc.handleLLMs), httptest.NewRequest("GET", "/llms.txt", nil))
	// A 404 tells a model the file does not exist and it moves on to the page,
	// which works. A 502 tells it the site is broken, which is not true.
	if rec.Code != 404 {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}
