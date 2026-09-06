// Nilgiri Post — demo storefront server.
//
// A custom (non-Shopify) merchant site, used to develop the tier-3 integration
// path. Deliberately dumb: static files, no templating, no database. The store
// exists to be integrated with, not to be impressive.
//
//	go run ./demo-store          -> http://127.0.0.1:4000
//	go run ./demo-store -addr :5000
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func rootDir() string {
	// Resolve relative to this file so the server works from any working dir.
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		return "."
	}
	return filepath.Dir(thisFile)
}

// noCache keeps the browser from serving a stale catalog.json or app.js while
// we are iterating. Wrong for production, right for a dev harness.
func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, must-revalidate")
		h.ServeHTTP(w, r)
	})
}

// logging so we can see what an agent actually requested, which is the whole
// point of pointing one at this store later.
func logging(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ua := r.UserAgent()
		if len(ua) > 60 {
			ua = ua[:60] + "…"
		}
		signed := ""
		if r.Header.Get("Signature") != "" {
			signed = "  [signed]"
		}
		log.Printf("%-6s %-38s %s%s", r.Method, r.URL.Path, ua, signed)
		h.ServeHTTP(w, r)
	})
}

func main() {
	addr := flag.String("addr", "127.0.0.1:4000", "listen address")
	agent := flag.String("agent", "http://localhost:3000", "agent gateway base URL")
	ordersPath := flag.String("orders", filepath.Join(rootDir(), "..", "agent-gateway", "data", "orders.jsonl"),
		"order history the merchant would normally read from their own database")
	secret := flag.String("secret", "dev-secret-nilgiripost-do-not-ship",
		"shared secret with the agent gateway; signs session tokens and the order feed")
	site := flag.String("site", "pk_nilgiripost_dev", "site key this store is registered under")
	flag.Parse()

	dir := rootDir()
	fs := http.FileServer(http.Dir(dir))

	shop, err := loadOrders(*ordersPath, *secret, *site)
	if err != nil {
		log.Printf("  order history unavailable (%v) — sign-in and order lookup are off", err)
		shop = &store{byCustomer: map[string][]order{}, byEmail: map[string]customer{}, secret: *secret, site: *site}
	}

	// The merchant's entire agent-readable integration: one well-known path,
	// proxied from the gateway. See ucp.go.
	ucp := &ucpProxy{upstream: strings.TrimSuffix(*agent, "/") + "/ucp/" + *site + "/profile"}

	// The merchant's half of basket recovery: the ask page and the restore
	// endpoint, both served from THIS domain and forwarded. See recovery.go.
	rec := &recoveryProxy{base: strings.TrimSuffix(*agent, "/"), site: *site}

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/ucp", ucp.handle)
	mux.HandleFunc("/recover/", rec.handleRecover)
	mux.HandleFunc("/restore/", rec.handleRestore)
	mux.HandleFunc("/api/orders", shop.handleOrders)
	mux.HandleFunc("/login", shop.handleLogin)
	mux.HandleFunc("/logout", shop.handleLogout)
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Bare /product should still resolve to the product page.
		if r.URL.Path == "/product" {
			r.URL.Path = "/product.html"
		}
		if strings.HasSuffix(r.URL.Path, ".json") {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
		}
		// Rewrite the AGENT_BASE placeholder in HTML so the gateway port can
		// move without editing the pages. Dev convenience only — a real
		// merchant pastes the gateway URL into the tag once.
		if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html") {
			name := r.URL.Path
			if name == "/" {
				name = "/index.html"
			}
			b, err := os.ReadFile(filepath.Join(dir, filepath.Clean(name)))
			if err == nil {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				html := strings.ReplaceAll(string(b), "AGENT_BASE", *agent)
				// The merchant's half of order access: a signed-in shopper gets
				// a short-lived token on the page, and a signed-out one gets
				// nothing at all. Two lines of integration on their side.
				html = strings.ReplaceAll(html, "<!--CHAPMAN_SESSION-->", shop.sessionScript(r))
				html = strings.ReplaceAll(html, "<!--ACCOUNTS-->", accountsBlock(shop, r))
				w.Write([]byte(html))
				return
			}
		}
		fs.ServeHTTP(w, r)
	}))

	log.Printf("Nilgiri Post demo store serving %s", dir)
	log.Printf("  agent gateway: %s", *agent)
	log.Printf("  recovery: /recover/<token> and /restore/<token> proxied to the gateway")
	log.Printf("  -> http://%s", *addr)
	if err := http.ListenAndServe(*addr, logging(noCache(mux))); err != nil {
		log.Fatal(err)
	}
}
