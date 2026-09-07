// Monsoon Market — demo storefront server.
//
// A custom (non-Shopify) merchant site, used to develop the tier-3 integration
// path. Deliberately small: static files, a merchant-owned Razorpay checkout,
// no templating and no database. The store exists to be integrated with, not
// to be impressive.
//
//	go run ./demo-store          -> http://127.0.0.1:4000
//	go run ./demo-store -addr :5000
//	go run ./demo-store -chapman=false   the shop before any of this existed
//
// Every flag also reads an environment variable, because the container form of
// this store is configured by compose and a `command:` line long enough to hold
// six flags is a line nobody reads.
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
	//
	// This is a source path baked in at compile time, so it is right when the
	// store is `go run`, and wrong inside a container where the source is not
	// present. Hence -dir, which the image sets.
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		return "."
	}
	return filepath.Dir(thisFile)
}

// envOr lets compose configure the store without a command line.
func envOr(name, def string) string {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		return v
	}
	return def
}

func envBool(name string, def bool) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(name))) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return def
}

// secretEnvFor mirrors `secretEnvFor` in agent-gateway/scripts/init-lib.mjs.
//
// The two must agree. The gateway generates its signing secret under this name
// at first boot; this store reads it back to sign the order feed with. A
// mismatch is not a crash — it is an order feed the gateway rejects as
// unsigned, which surfaces as "the assistant does not know about my orders".
func secretEnvFor(siteKey string) string {
	k := strings.TrimPrefix(siteKey, "pk_")
	var b strings.Builder
	for _, r := range k {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	return "SITE_SECRET_" + strings.ToUpper(b.String())
}

// readSecretFromEnvFile pulls one variable out of an env-style file.
//
// The container case: the gateway generates its site secret at first boot and
// writes it into the data volume, which is mounted here read-only. Without this
// the two halves of the demo would need a secret agreed in advance, which means
// a bootstrap step before `docker compose up`, which means the demo is no
// longer one command.
func readSecretFromEnvFile(path, name string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		eq := strings.Index(line, "=")
		if eq < 1 || strings.TrimSpace(line[:eq]) != name {
			continue
		}
		v := strings.TrimSpace(line[eq+1:])
		v = strings.Trim(v, `"'`)
		if v != "" {
			return v
		}
	}
	return ""
}

// noCache keeps the browser from serving a stale catalog.json or app.js while
// we are iterating. Wrong for production, right for a dev harness — and it is
// also what makes pasting the embed tag into index.html show up on the next
// refresh with no restart and no rebuild.
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
	addr := flag.String("addr", envOr("STORE_ADDR", "127.0.0.1:4000"), "listen address")

	// TWO gateway URLs, and the difference only shows up in a container.
	//
	// -agent is what the BROWSER must reach. It is substituted into the pages,
	// so it has to be an address the person looking at the shop can resolve:
	// http://localhost:3000, or https://chapman.myshop.example.
	//
	// -upstream is what THIS PROCESS must reach for the three server-side
	// proxies — discovery, recovery, the tier C view. On one machine they are
	// the same string. Across a compose network they are not: the browser says
	// localhost:3000 and this container says gateway:3000, and using either for
	// both breaks one half with a connection error that names neither.
	agent := flag.String("agent", envOr("AGENT_BASE_URL", "http://localhost:3000"),
		"agent gateway base URL, as the SHOPPER'S BROWSER reaches it")
	upstream := flag.String("upstream", envOr("AGENT_UPSTREAM_URL", ""),
		"agent gateway base URL, as THIS SERVER reaches it (default: same as -agent)")

	dir := flag.String("dir", envOr("STORE_DIR", rootDir()), "directory of storefront files to serve")
	ordersPath := flag.String("orders", envOr("ORDERS_PATH", ""),
		"order history the merchant would normally read from their own database (default: ../agent-gateway/data/orders.jsonl)")
	secret := flag.String("secret", envOr("SITE_SECRET", ""),
		"shared secret with the agent gateway; signs session tokens and the order feed")
	secretFile := flag.String("secret-file", envOr("SITE_SECRET_FILE", ""),
		"read the shared secret from this env-style file, when -secret is not given")
	site := flag.String("site", envOr("SITE_KEY", "pk_monsoon_market"), "site key this store is registered under")
	tierCOn := flag.Bool("tierc", envBool("TIER_C", true),
		"serve the optional agent-legibility layer: JSON-LD, /llms.txt, Link header, ?format=json")

	// The master switch, and the reason it exists.
	//
	// -chapman=false is this shop BEFORE the integration: no discovery document,
	// no recovery routes, no order feed, no legibility layer. It is not a
	// simulation of that state, it is that state — the handlers are never
	// registered, so `curl /.well-known/ucp` returns a real 404 from a real
	// mux, not a 404 we decided to write.
	//
	// It exists because "here is what changes when you install this" is a claim,
	// and a claim you can turn off and on in one restart is a demonstration.
	chapmanOn := flag.Bool("chapman", envBool("CHAPMAN", true),
		"serve the CHAPMAN integration at all: discovery, recovery, the order feed, tier C")
	flag.Parse()

	root := *dir
	if *ordersPath == "" {
		*ordersPath = filepath.Join(root, "..", "agent-gateway", "data", "orders.jsonl")
	}
	if *upstream == "" {
		*upstream = *agent
	}
	base := strings.TrimSuffix(*agent, "/")
	up := strings.TrimSuffix(*upstream, "/")

	// The secret, in order of trust: told to us outright, then read from the
	// file the gateway generated, then the throwaway that lets a fresh clone
	// run with no setup. The gateway refuses that last one in production, so if
	// we are still using it against a production gateway, nothing will verify —
	// which is why it says so on startup rather than at the first signed request.
	secretSource := "-secret"
	if *secret == "" && *secretFile != "" {
		if v := readSecretFromEnvFile(*secretFile, secretEnvFor(*site)); v != "" {
			*secret = v
			secretSource = *secretFile
		}
	}
	if *secret == "" {
		*secret = "dev-secret-monsoonmarket-do-not-ship"
		secretSource = "development fallback"
	}

	fs := http.FileServer(http.Dir(root))

	shop, err := loadOrders(*ordersPath, *secret, *site)
	if err != nil {
		log.Printf("  order history unavailable (%v) — sign-in and order lookup are off", err)
		shop = &store{byCustomer: map[string][]order{}, byEmail: map[string]customer{}, secret: *secret, site: *site}
	}
	payments := newCheckout(root, shop)

	// The merchant's entire agent-readable integration: one well-known path,
	// proxied from the gateway. See ucp.go.
	ucp := &ucpProxy{upstream: up + "/ucp/" + *site + "/profile"}

	// The merchant's half of basket recovery: the ask page and the restore
	// endpoint, both served from THIS domain and forwarded. See recovery.go.
	rec := &recoveryProxy{base: up, site: *site}

	// Tier C: the optional legibility layer. See agentfront.go. Flagged off-able
	// because "does the store still work without it?" has to be a thing anyone
	// can check in one restart, not a thing we assert.
	tc := newTierC(up, *site)

	tierC := *tierCOn && *chapmanOn

	mux := http.NewServeMux()
	if *chapmanOn {
		mux.HandleFunc("/.well-known/ucp", ucp.handle)
		mux.HandleFunc("/recover/", rec.handleRecover)
		mux.HandleFunc("/restore/", rec.handleRestore)
		mux.HandleFunc("/api/orders", shop.handleOrders)
	}
	if tierC {
		mux.HandleFunc("/llms.txt", tc.handleLLMs)
	}
	// The shop's own accounts, which are the shop's and not ours. They stay
	// registered either way: a storefront with no sign-in is a different shop,
	// not the same shop without CHAPMAN.
	mux.HandleFunc("/login", shop.handleLogin)
	mux.HandleFunc("/logout", shop.handleLogout)
	// The merchant's own Razorpay integration. This is intentionally outside
	// the Chapman switch: a fresh store can transact before Chapman knows it
	// exists. Only test credentials are supplied by the demo Compose profile.
	mux.HandleFunc("/api/checkout", payments.handle)
	mux.HandleFunc("/api/razorpay/webhook", payments.handleWebhook)
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
			b, err := os.ReadFile(filepath.Join(root, filepath.Clean(name)))
			if err == nil {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				html := strings.ReplaceAll(string(b), "AGENT_BASE", base)
				// The merchant's half of order access: a signed-in shopper gets
				// a short-lived token on the page, and a signed-out one gets
				// nothing at all. Two lines of integration on their side.
				session := ""
				if *chapmanOn {
					session = shop.sessionScript(r)
				}
				html = strings.ReplaceAll(html, "<!--CHAPMAN_SESSION-->", session)
				html = strings.ReplaceAll(html, "<!--ACCOUNTS-->", accountsBlock(shop, r))
				w.Write([]byte(html))
				return
			}
		}
		fs.ServeHTTP(w, r)
	}))

	// The whole storefront, then Tier C wrapped around it — which is exactly
	// how a merchant installs this: one line, at the outermost layer, where it
	// can see the HTML on the way out.
	var handler http.Handler = mux
	if tierC {
		handler = tc.wrap(handler)
	}

	log.Printf("Monsoon Market demo store serving %s", root)
	if payments.keyID != "" && payments.keySecret != "" {
		log.Printf("  Razorpay test checkout: ready (merchant-owned)")
	} else {
		log.Printf("  Razorpay test checkout: keys missing; cart can price but Pay explains what to add")
	}
	if payments.webhookSecret != "" {
		log.Printf("  Razorpay webhook: /api/razorpay/webhook (requires a public store URL)")
	}
	if *chapmanOn {
		log.Printf("  agent gateway: %s  (browser)", base)
		if up != base {
			log.Printf("  agent gateway: %s  (this server)", up)
		}
		log.Printf("  site key: %s, secret from %s", *site, secretSource)
		log.Printf("  recovery: /recover/<token> and /restore/<token> proxied to the gateway")
		if tierC {
			log.Printf("  tier C: JSON-LD injected, /llms.txt served, ?format=json honoured")
		} else {
			log.Printf("  tier C: OFF (-tierc=false) — the store is still fully transactable")
		}
	} else {
		log.Printf("  CHAPMAN: OFF (-chapman=false)")
		log.Printf("    /.well-known/ucp, /recover/, /restore/, /api/orders and tier C are unregistered.")
		log.Printf("    Catalogue, accounts and merchant-owned Razorpay checkout still work.")
	}
	log.Printf("  -> http://%s", *addr)
	if err := http.ListenAndServe(*addr, logging(noCache(handler))); err != nil {
		log.Fatal(err)
	}
}
