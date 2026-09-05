package main

// The merchant's entire UCP integration.
//
// This is the file a real merchant writes. Everything else — the thirteen
// Shopping methods, carts, checkouts, stock holds, payment — lives in the
// gateway. All the store has to do is make one well-known path return the
// gateway's discovery document, and shopper agents can transact with it.
//
// WHY IT MUST BE ON THE MERCHANT'S ORIGIN, AND CANNOT BE ON OURS:
//
// An agent told to shop at nilgiripost.example fetches
// nilgiripost.example/.well-known/ucp and nowhere else. There is no registry to
// be listed in and no directory to join — the merchant's own domain is the
// authority on who may transact on their behalf. That is a good property, not
// an inconvenience: it means the merchant grants agent access by adding this
// handler and revokes it by deleting it, with no account to close and nobody to
// ask. Every Shopify store already has the equivalent, served by Shopify.
//
// Proxy rather than redirect. A 302 works with most clients, but the ones that
// do not follow cross-origin redirects on a well-known path fail invisibly, and
// the merchant would be debugging someone else's HTTP client. Fetching and
// echoing is fifteen lines and always works.

import (
	"io"
	"log"
	"net/http"
	"sync"
	"time"
)

type ucpProxy struct {
	// Where the gateway serves this store's discovery document.
	upstream string

	mu       sync.Mutex
	cached   []byte
	cachedAt time.Time
}

// A short cache so an agent burst does not become a request storm against the
// gateway, but short enough that turning on payments shows up in discovery
// while the merchant is still watching the screen.
const ucpCacheTTL = 60 * time.Second

func (u *ucpProxy) handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	u.mu.Lock()
	fresh := u.cached != nil && time.Since(u.cachedAt) < ucpCacheTTL
	body := u.cached
	u.mu.Unlock()

	if !fresh {
		fetched, err := u.fetch()
		if err != nil {
			// Serving a stale document beats serving none: an agent that gets a
			// 502 here concludes the store does not speak UCP at all, which is
			// a much worse outcome than a discovery document a minute old.
			if body == nil {
				log.Printf("  ucp discovery unavailable: %v", err)
				http.Error(w, `{"error":"discovery unavailable"}`, http.StatusBadGateway)
				return
			}
			log.Printf("  ucp discovery refresh failed, serving cached: %v", err)
		} else {
			body = fetched
			u.mu.Lock()
			u.cached, u.cachedAt = fetched, time.Now()
			u.mu.Unlock()
		}
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=60")
	// Agents running in a browser need this; agents running on a server do not
	// care. It costs nothing to be reachable by both.
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(body)
}

func (u *ucpProxy) fetch() ([]byte, error) {
	// Bounded. A discovery fetch that hangs would hang the agent asking for it,
	// and a slow answer here is indistinguishable to them from a broken store.
	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequest(http.MethodGet, u.upstream, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, &httpStatusError{code: res.StatusCode}
	}
	// Capped: this is a small JSON document, and an unbounded read from an
	// upstream is how a proxy becomes a memory exhaustion bug.
	return io.ReadAll(io.LimitReader(res.Body, 256*1024))
}

type httpStatusError struct{ code int }

func (e *httpStatusError) Error() string { return http.StatusText(e.code) }
