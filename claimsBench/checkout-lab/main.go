// Command checkout-lab serves a browser harness for the questions the CLI
// cannot answer: what the Razorpay checkout modal actually does.
//
// The API and the modal are different systems that disagree — an order can be
// created, stored and labelled as a Magic Checkout order while the modal
// ignores every bit of it. Nothing server-side reports that. The only way to
// find out is to open the thing and watch.
//
// It mints a fresh order per run because an order is single use: a paid order
// makes checkout show "Uh! oh! Something went wrong", which is easy to
// misread as the feature failing.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"time"

	"claimsBench/razorpay"

	_ "embed"

	"github.com/joho/godotenv"
)

//go:embed index.html
var indexHTML []byte

const (
	orderAmount = 50000 // paise, INR 500.00
	shutdownMsg = "checkout-lab listening on http://127.0.0.1%s\n"
)

// orderRequest is what the page asks for. Magic decides whether the order
// carries line_items, which is what makes it a one-click-checkout order
// server-side. Everything else about the scenario is a checkout.js option and
// never reaches this program.
type orderRequest struct {
	Magic bool   `json:"magic"`
	Label string `json:"label"`
}

type orderResponse struct {
	OrderID string `json:"order_id"`
	KeyID   string `json:"key_id"`
	Magic   bool   `json:"magic"`
	Raw     any    `json:"raw"`
}

type server struct {
	client *razorpay.Client
}

func main() {
	addr := flag.String("addr", ":8899", "listen address")
	flag.Parse()

	_ = godotenv.Load("../.env")

	client, err := razorpay.NewClient()
	if err != nil {
		log.Fatalf("razorpay: %v", err)
	}

	s := &server{client: client}

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/api/order", s.handleOrder)
	mux.HandleFunc("/api/inspect", s.handleInspect)

	fmt.Printf(shutdownMsg, *addr)
	fmt.Printf("key id: %s\n", client.KeyID())

	srv := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("listen: %v", err)
	}
}

func (s *server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// The page must not be cached: it is edited constantly while probing, and a
	// stale copy would silently test the previous version.
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(indexHTML)
}

func (s *server) handleOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var req orderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("bad request body: %v", err), http.StatusBadRequest)
		return
	}

	status, body, err := s.client.Post("/orders", buildOrder(req))
	if err != nil {
		http.Error(w, fmt.Sprintf("razorpay unreachable: %v", err), http.StatusBadGateway)
		return
	}

	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		http.Error(w, fmt.Sprintf("undecodable response: %v", err), http.StatusBadGateway)
		return
	}

	if status < 200 || status >= 300 {
		// Hand the whole envelope back rather than a summary: the reason a
		// mandate or 1cc order is refused is the finding, not an inconvenience.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(raw)

		return
	}

	id, _ := raw["id"].(string)

	log.Printf("created %s (magic=%v, label=%q)", id, req.Magic, req.Label)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(orderResponse{
		OrderID: id,
		KeyID:   s.client.KeyID(),
		Magic:   req.Magic,
		Raw:     raw,
	})
}

// handleInspect closes the loop in the browser: after a payment, show what the
// three surfaces say about the same order. They disagree, and the disagreement
// is the finding — the Orders API renders order accounting only, while the
// checkout preferences document is where line_items and mandate tokens appear.
func (s *server) handleInspect(w http.ResponseWriter, r *http.Request) {
	orderID := r.URL.Query().Get("order_id")
	if orderID == "" {
		http.Error(w, "order_id required", http.StatusBadRequest)
		return
	}

	out := map[string]any{}

	for label, path := range map[string]string{
		"order":       "/orders/" + orderID,
		"payments":    "/orders/" + orderID + "/payments",
		"preferences": "/preferences?key_id=" + s.client.KeyID() + "&order_id=" + orderID,
	} {
		status, body, err := s.client.Get(path)
		if err != nil {
			out[label] = map[string]any{"transport_error": err.Error()}
			continue
		}

		var raw any
		if err := json.Unmarshal(body, &raw); err != nil {
			out[label] = map[string]any{"status": status, "undecodable": string(body)}
			continue
		}

		// The preferences document is 56KB of account-wide capability data and
		// only its order block is about this order. Everything else would bury
		// the answer.
		if label == "preferences" {
			if m, ok := raw.(map[string]any); ok {
				raw = map[string]any{"order": m["order"]}
			}
		}

		out[label] = map[string]any{"status": status, "body": raw}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

// buildOrder returns the order payload. line_items plus line_items_total is
// what makes Razorpay treat an order as one-click-checkout; without them, the
// one_click_checkout option in the browser has nothing to act on.
func buildOrder(req orderRequest) map[string]any {
	label := req.Label
	if label == "" {
		label = "lab"
	}

	order := map[string]any{
		"amount":   orderAmount,
		"currency": "INR",
		"receipt":  "lab-" + label,
		// notes round-trip reliably, unlike most optional fields, so they are
		// the only dependable way to tag which scenario made an order.
		"notes": map[string]any{
			"scenario": label,
			"magic":    fmt.Sprintf("%v", req.Magic),
		},
	}

	if req.Magic {
		order["line_items_total"] = orderAmount
		order["line_items"] = []map[string]any{{
			"sku": "LAB-1", "variant_id": "v1",
			"name": "Lab Widget", "description": "checkout-lab probe item",
			"price": orderAmount, "offer_price": orderAmount, "tax_amount": 0,
			"quantity":    1,
			"weight":      100,
			"product_url": "https://example.com/p/1",
			"image_url":   "https://example.com/p/1.png",
		}}
	}

	return order
}
