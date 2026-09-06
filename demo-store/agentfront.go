package main

// Tier C — the optional middleware, as a merchant would actually write it.
//
// Tiers A and B make the store TRANSACTABLE: one redirect or one file at
// /.well-known/ucp, and any agent that speaks the protocol can search, cart,
// checkout and pay. This tier adds nothing to that. It adds LEGIBILITY, for the
// other kind of caller — Claude or ChatGPT handed a product URL by a person,
// fetching the page like a browser, with no idea UCP exists:
//
//   - JSON-LD Product/Offer injected before </head>
//   - /llms.txt
//   - <link rel="ucp"> and a Link: header
//   - content negotiation: the same URL answers with data when asked
//
// THE MERCHANT'S HALF IS DELIBERATELY STUPID, AND THAT IS THE DESIGN.
//
// Nothing here knows what a product is, what an offer is worth, or what UCP
// looks like. It sends the gateway a path and injects whatever comes back. It
// has to be that way: the live offers are in an approval ledger on the gateway,
// the policies come from the catalogue feed the gateway reads, and the payment
// handler depends on Razorpay configuration the store has never seen. A
// middleware that built any of that locally would be a SECOND PLACE prices and
// offers come from, and two places means they can eventually disagree.
//
// THE PROPERTY THAT MATTERS MOST: this cannot take the storefront down.
//
// Every gateway call here is bounded, cached, and on failure the page is served
// exactly as it would have been without this file. A shop that goes dark because
// its agent-legibility middleware could not reach a third party has traded a
// real business for a machine-readable one. Kill the gateway and the store keeps
// selling to humans; it just stops being easy for a model to read.

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// What the gateway hands back for one path. See app/lib/agentview.server.ts.
type agentView struct {
	Page   string          `json:"page"`
	Head   string          `json:"head"`
	JSONLD string          `json:"jsonld"`
	Link   string          `json:"link"`
	JSON   json.RawMessage `json:"json"`
	MaxAge int             `json:"max_age"`
}

type viewEntry struct {
	view    agentView
	expires time.Time
}

type tierC struct {
	base string // gateway base URL
	site string // our site key

	mu    sync.Mutex
	cache map[string]viewEntry

	client *http.Client
}

func newTierC(base, site string) *tierC {
	return &tierC{
		base:  strings.TrimSuffix(base, "/"),
		site:  site,
		cache: map[string]viewEntry{},
		// Short. This runs in front of a page a human is waiting for, so a slow
		// gateway must cost a fraction of a second and then be ignored — never
		// hold the request open until someone gives up on the shop.
		client: &http.Client{Timeout: 2500 * time.Millisecond},
	}
}

// Bounded so a crawler walking an infinite URL space cannot turn the cache into
// a memory leak. Dropping the whole map is crude and correct: it costs one
// gateway round trip per live page and cannot grow without limit.
const viewCacheMax = 512

func (t *tierC) fetchView(pathAndQuery, origin string) (agentView, bool) {
	key := origin + "\x00" + pathAndQuery

	t.mu.Lock()
	if e, ok := t.cache[key]; ok && time.Now().Before(e.expires) {
		t.mu.Unlock()
		return e.view, true
	}
	t.mu.Unlock()

	u := t.base + "/ucp/" + url.PathEscape(t.site) + "/agentview" +
		"?path=" + url.QueryEscape(pathAndQuery) +
		"&origin=" + url.QueryEscape(origin)

	res, err := t.client.Get(u)
	if err != nil {
		log.Printf("  tier C: agentview unavailable (%v) — page served unchanged", err)
		return agentView{}, false
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		log.Printf("  tier C: agentview returned %d — page served unchanged", res.StatusCode)
		return agentView{}, false
	}

	var v agentView
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&v); err != nil {
		log.Printf("  tier C: agentview undecodable (%v) — page served unchanged", err)
		return agentView{}, false
	}

	ttl := time.Duration(v.MaxAge) * time.Second
	if ttl <= 0 {
		ttl = time.Minute
	}
	t.mu.Lock()
	if len(t.cache) >= viewCacheMax {
		t.cache = map[string]viewEntry{}
	}
	t.cache[key] = viewEntry{view: v, expires: time.Now().Add(ttl)}
	t.mu.Unlock()

	return v, true
}

// The origin an agent reached us on, which is the origin every URL we publish
// has to be written in. Reading the forwarded headers matters the moment the
// store is behind a tunnel or a CDN: build the JSON-LD from the internal address
// and every link in it points somewhere only the server can reach.
func originOf(r *http.Request) string {
	scheme := "http"
	if f := r.Header.Get("X-Forwarded-Proto"); f != "" {
		scheme = f
	} else if r.TLS != nil {
		scheme = "https"
	}
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	return scheme + "://" + host
}

/*
Does this caller want the machine view?

Two ways in, and the second is the one that matters.

`Accept: application/json` is the correct mechanism and it is USELESS to the
audience this tier exists for: a model browsing the web calls a fetch tool with a
URL and no way to set a header. So `?format=json` is the discoverable half of the
same switch — it is what /llms.txt tells the model to append, because a URL is
the only thing it can control.

The Accept check is deliberately strict about `application/json` appearing ahead
of `text/html`. A browser sends `text/html,application/xhtml+xml,...` and must
never be handed JSON; some clients send `*​/*` and mean "whatever you have",
which is the page.
*/
func wantsJSON(r *http.Request) bool {
	if r.URL.Query().Get("format") == "json" {
		return true
	}
	a := strings.ToLower(r.Header.Get("Accept"))
	if !strings.Contains(a, "application/json") {
		return false
	}
	if strings.Contains(a, "text/html") {
		return false
	}
	return true
}

/*
A ResponseWriter that buffers only what it might rewrite.

We cannot know whether a response is HTML until the handler has set its headers,
and it sets them on the way to writing the body. So the decision is made at the
first write: an HTML 200 is buffered so a script tag can go into it, and
EVERYTHING ELSE — assets, JSON, redirects, 404s — switches to streaming straight
through and is never held in memory.

That switch is not an optimisation, it is a correctness requirement. An earlier
draft buffered every response and stopped buffering past a size cap, which meant
a 6 MB image was served as its first 4 MB. Silent truncation of a file that
already left the building is the worst possible failure for a middleware whose
entire justification is that it is optional.

The same switch fires if a page turns out to be bigger than the cap mid-stream:
flush what we have, stream the rest, and give up on rewriting it.
*/
type capture struct {
	w       http.ResponseWriter
	status  int
	buf     bytes.Buffer
	decided bool
	pass    bool
}

// An HTML page big enough to hit this is not one we should be holding in memory
// to add a script tag to.
const captureMax = 4 << 20 // 4 MB

// The real header map, so the wrapped handler's headers are the ones that ship
// and there is nothing to copy across afterwards.
func (c *capture) Header() http.Header { return c.w.Header() }

func (c *capture) WriteHeader(s int) {
	if c.status == 0 {
		c.status = s
	}
}

func (c *capture) Write(b []byte) (int, error) {
	if c.status == 0 {
		c.status = http.StatusOK
	}
	if !c.decided {
		c.decided = true
		ct := strings.ToLower(c.w.Header().Get("Content-Type"))
		if c.status != http.StatusOK || !strings.HasPrefix(ct, "text/html") {
			c.pass = true
			c.w.WriteHeader(c.status)
		}
	}
	if c.pass {
		return c.w.Write(b)
	}
	if c.buf.Len()+len(b) > captureMax {
		c.pass = true
		c.w.WriteHeader(c.status)
		if _, err := c.w.Write(c.buf.Bytes()); err != nil {
			return 0, err
		}
		c.buf.Reset()
		return c.w.Write(b)
	}
	return c.buf.Write(b)
}

func (t *tierC) wrap(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only GET and HEAD. A POST that produced HTML is a form result, not a
		// page an agent should be told it can re-fetch as data.
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			h.ServeHTTP(w, r)
			return
		}

		rec := &capture{w: w}
		h.ServeHTTP(rec, r)

		// Already streamed: an asset, a JSON API, a redirect, a 404. Note the
		// decision was made on what the store ACTUALLY produced, never on what
		// the URL looked like — guessing from the path gets /cart wrong, or
		// /about, and does it silently.
		if rec.pass {
			return
		}

		// The handler wrote no body at all: a 304, or a HEAD served by the file
		// server. Nothing to rewrite, and the status still has to go out.
		if !rec.decided {
			if rec.status == 0 {
				rec.status = http.StatusOK
			}
			w.WriteHeader(rec.status)
			return
		}

		page := rec.buf.Bytes()
		serve := func(body []byte) {
			w.Header().Del("Content-Length") // the body may have changed length
			w.WriteHeader(rec.status)
			if r.Method != http.MethodHead {
				_, _ = w.Write(body)
			}
		}

		view, ok := t.fetchView(r.URL.RequestURI(), originOf(r))

		// The gateway is unreachable. Serve the page unchanged. This is the
		// failure mode the whole file is arranged around.
		if !ok {
			serve(page)
			return
		}

		// Without this a shared cache stores one representation of the URL and
		// serves it to everyone — JSON to a browser, or a page to an agent that
		// asked for data. The same URL now has two answers; say so.
		w.Header().Add("Vary", "Accept")
		if view.Link != "" {
			w.Header().Add("Link", view.Link)
		}

		if wantsJSON(r) && len(view.JSON) > 0 {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			serve(view.JSON)
			return
		}

		serve(inject(page, view))
	})
}

/*
Insert before </head>, and leave existing structured data alone.

A merchant who already publishes JSON-LD gets the <link> and nothing else. Two
Product nodes on one page is not a richer page — it is an ambiguous one, and
search engines and models both resolve the ambiguity by picking one, which means
the merchant's own markup might silently lose to ours. Their markup wins; we are
the optional tier.

No </head> means no injection. Rewriting HTML that does not have the shape we
expected is how middleware corrupts a page.
*/
func inject(page []byte, v agentView) []byte {
	frag := v.Head
	if bytes.Contains(bytes.ToLower(page), []byte("application/ld+json")) {
		frag = strings.TrimPrefix(v.Head, v.JSONLD)
	}
	if frag == "" {
		return page
	}

	i := bytes.Index(bytes.ToLower(page), []byte("</head>"))
	if i < 0 {
		return page
	}
	out := make([]byte, 0, len(page)+len(frag)+1)
	out = append(out, page[:i]...)
	out = append(out, []byte("\n"+frag+"\n")...)
	out = append(out, page[i:]...)
	return out
}

/*
/llms.txt, proxied.

It has to be on THIS origin. A model handed monsoonmarket.example guesses
monsoonmarket.example/llms.txt and nowhere else — the same reason discovery cannot
live on the gateway. The content is generated where the offers and the catalogue
are, and this end just forwards it.

Proxied rather than redirected because we are already running code here, and one
fewer hop for a client whose whole interaction with this store may be two
fetches. A redirect would also work; that measurement was taken on the well-known
path and there is no reason a text file behaves differently.
*/
func (t *tierC) handleLLMs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	u := t.base + "/ucp/" + url.PathEscape(t.site) + "/llms.txt" +
		"?origin=" + url.QueryEscape(originOf(r))

	res, err := t.client.Get(u)
	if err != nil || res.StatusCode != http.StatusOK {
		if err == nil {
			err = &httpStatusError{code: res.StatusCode}
			res.Body.Close()
		}
		// 404 rather than 502. A model that gets a 404 here concludes the file
		// does not exist and moves on to the page, which is a working outcome;
		// a 502 tells it the site is broken, which is not true.
		log.Printf("  tier C: llms.txt unavailable (%v)", err)
		http.NotFound(w, r)
		return
	}
	defer res.Body.Close()

	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=600")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(body)
}
