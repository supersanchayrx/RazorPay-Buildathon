package main

// The merchant's half of basket recovery: two routes, both proxies.
//
// This is the same idea as ucp.go and for the same reason. A shopper who was on
// nilgiripost.example and is asked why they didn't buy should be answering that
// question on nilgiripost.example — not on a gateway domain they have never
// heard of, which reads like a phishing link and gets closed. So the merchant
// owns the URL and forwards the request; CHAPMAN owns everything behind it.
//
//	/recover/<token>   the page that ASKS. Proxied whole, GET and POST.
//	/restore/<token>   what was in that basket, as {handle, sku, qty}.
//
// THE TOKEN IS UNCHANGED BY MOVING THE URL. It is signed with the shared secret
// and verified by the gateway, so relocating where it is presented relocates no
// trust. This server never inspects it, never stores it, and could not forge
// one — it is a courier.
//
// WHY PROXY RATHER THAN REDIRECT. A 302 works with most clients. The ones that
// do not follow it fail invisibly, and the merchant ends up debugging somebody
// else's HTTP client. Forwarding is a page of code and always works.

import (
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

type recoveryProxy struct {
	// Gateway base, e.g. http://localhost:3000
	base string
	// The site key this store is registered under. It stays on this side: the
	// shopper-facing URL carries only the token, because the merchant's own
	// handler already knows which shop it is.
	site string
}

// A recovery page is a person waiting for a form to submit, so the budget is
// generous compared with discovery — but still bounded, because a hung upstream
// must become an error the shopper can read rather than a spinner forever.
var recoveryClient = &http.Client{
	Timeout: 15 * time.Second,
	// Do not follow redirects: the gateway's own 302s are relative to its
	// origin, and following one here would silently move the shopper off the
	// merchant's domain, which is the exact thing these routes exist to avoid.
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// token pulls the last path segment and refuses anything that is not one.
func token(path, prefix string) (string, bool) {
	rest := strings.TrimPrefix(path, prefix)
	rest = strings.Trim(rest, "/")
	if rest == "" || strings.Contains(rest, "/") {
		return "", false
	}
	return rest, true
}

// handleRecover forwards the ask page, in both directions.
//
// The POST matters as much as the GET: the page's form submits to whatever URL
// the browser is on, which under this proxy is the merchant's. Forwarding only
// the GET would render the question perfectly and throw the answer away — and
// the answer is the entire point of the feature.
func (p *recoveryProxy) handleRecover(w http.ResponseWriter, r *http.Request) {
	tok, ok := token(r.URL.Path, "/recover")
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	upstream := p.base + "/recover/" + p.site + "/" + tok
	if q := r.URL.RawQuery; q != "" {
		upstream += "?" + q
	}

	// Capped: a form post from a page we control is small, and an unbounded
	// read from a client is how a proxy becomes a memory exhaustion bug.
	var body io.Reader
	if r.Method == http.MethodPost {
		body = io.LimitReader(r.Body, 64*1024)
	}

	req, err := http.NewRequest(r.Method, upstream, body)
	if err != nil {
		http.Error(w, "recovery unavailable", http.StatusBadGateway)
		return
	}
	if ct := r.Header.Get("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	req.Header.Set("Accept", r.Header.Get("Accept"))

	res, err := recoveryClient.Do(req)
	if err != nil {
		log.Printf("  recovery page unavailable: %v", err)
		http.Error(w, "This page is temporarily unavailable. Your basket is still here.", http.StatusBadGateway)
		return
	}
	defer res.Body.Close()

	for _, h := range []string{"Content-Type", "Cache-Control"} {
		if v := res.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	// Never cached by anything in between: the URL names one person's basket.
	w.Header().Set("Cache-Control", "no-store, private")
	w.WriteHeader(res.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(res.Body, 2*1024*1024))
}

// handleRestore hands the basket back so the storefront can rebuild it.
//
// What comes back is {handle, sku, qty} and nothing else — no prices. The cart
// on this store cannot hold one, and a restore endpoint that returned totals
// would be the one place a price could sneak into it.
func (p *recoveryProxy) handleRestore(w http.ResponseWriter, r *http.Request) {
	tok, ok := token(r.URL.Path, "/restore")
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	req, err := http.NewRequest(http.MethodGet, p.base+"/restore/"+p.site+"/"+tok, nil)
	if err != nil {
		http.Error(w, `{"error":"restore unavailable"}`, http.StatusBadGateway)
		return
	}
	req.Header.Set("Accept", "application/json")

	res, err := recoveryClient.Do(req)
	if err != nil {
		log.Printf("  basket restore unavailable: %v", err)
		http.Error(w, `{"error":"restore unavailable"}`, http.StatusBadGateway)
		return
	}
	defer res.Body.Close()

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, private")
	w.WriteHeader(res.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(res.Body, 256*1024))
}
