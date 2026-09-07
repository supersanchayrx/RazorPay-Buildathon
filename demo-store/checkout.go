package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// checkout is deliberately owned by the merchant storefront, not Chapman.
// Monsoon Market therefore remains a normal Razorpay test merchant before a
// tester registers or installs any Chapman feature.
type checkout struct {
	catalogPath   string
	ordersPath    string
	pendingPath   string
	keyID         string
	keySecret     string
	webhookSecret string
	apiBase       string
	client        *http.Client
	shop          *store

	mu      sync.Mutex
	pending map[string]pendingPayment
	settled map[string]bool
}

type cartRequest struct {
	Op                string     `json:"op"`
	Items             []cartItem `json:"items"`
	RazorpayOrderID   string     `json:"razorpay_order_id"`
	RazorpayPaymentID string     `json:"razorpay_payment_id"`
	RazorpaySignature string     `json:"razorpay_signature"`
}

type cartItem struct {
	Handle string `json:"handle"`
	SKU    string `json:"sku"`
	Qty    int    `json:"qty"`
}

type catalogFile struct {
	Shop struct {
		Currency string `json:"currency"`
	} `json:"shop"`
	Products []struct {
		Handle   string `json:"handle"`
		Title    string `json:"title"`
		Variants []struct {
			Title     string  `json:"title"`
			Price     float64 `json:"price"`
			SKU       string  `json:"sku"`
			InStock   bool    `json:"inStock"`
			Inventory int     `json:"inventory"`
		} `json:"variants"`
	} `json:"products"`
}

type merchantQuoteLine struct {
	Handle       string  `json:"handle"`
	Title        string  `json:"title"`
	SKU          string  `json:"sku"`
	VariantTitle string  `json:"variantTitle"`
	Qty          int     `json:"qty"`
	UnitPrice    float64 `json:"unitPrice"`
	LineTotal    float64 `json:"lineTotal"`
}

type merchantQuote struct {
	Lines       []merchantQuoteLine `json:"lines"`
	Subtotal    float64             `json:"subtotal"`
	Offers      []any               `json:"offers"`
	Discount    float64             `json:"discount"`
	Shipping    float64             `json:"shipping"`
	Total       float64             `json:"total"`
	Currency    string              `json:"currency"`
	ExpiresAt   string              `json:"expiresAt"`
	Fingerprint string              `json:"fingerprint"`
}

type pendingPayment struct {
	OrderID   string        `json:"orderId"`
	CreatedAt string        `json:"createdAt"`
	Quote     merchantQuote `json:"quote"`
	Customer  *customer     `json:"customer,omitempty"`
}

type razorpayPayment struct {
	ID       string `json:"id"`
	OrderID  string `json:"order_id"`
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
	Status   string `json:"status"`
	Method   string `json:"method"`
}

func newCheckout(root string, shop *store) *checkout {
	dataDir := envOr("STORE_DATA_DIR", filepath.Join(os.TempDir(), "monsoon-market"))
	c := &checkout{
		catalogPath:   filepath.Join(root, "catalog.json"),
		ordersPath:    filepath.Join(dataDir, "orders.jsonl"),
		pendingPath:   filepath.Join(dataDir, "pending.json"),
		keyID:         firstEnv("RAZORPAY_KEY_ID", "RAZORPAY_TEST_API_KEY_ID1"),
		keySecret:     firstEnv("RAZORPAY_KEY_SECRET", "RAZORPAY_TEST_API_KEY_SECRET1"),
		webhookSecret: firstEnv("RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_WEBHOOK_SECRET1"),
		apiBase:       "https://api.razorpay.com/v1",
		client:        &http.Client{Timeout: 12 * time.Second},
		shop:          shop,
		pending:       map[string]pendingPayment{},
		settled:       map[string]bool{},
	}
	_ = os.MkdirAll(dataDir, 0o700)
	c.loadPending()
	return c
}

func firstEnv(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (c *checkout) handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "POST only"})
		return
	}
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"ok": false, "error": "Content-Type must be application/json"})
		return
	}
	var req cartRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "expected a JSON body"})
		return
	}

	switch req.Op {
	case "quote":
		quote, problems, err := c.quote(req.Items)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		if len(problems) > 0 {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "problems": problems})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "quote": quote})
	case "start":
		c.start(w, r, req.Items)
	case "confirm":
		c.confirm(w, req)
	default:
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "unknown checkout operation"})
	}
}

func (c *checkout) quote(items []cartItem) (merchantQuote, []map[string]any, error) {
	var catalog catalogFile
	b, err := os.ReadFile(c.catalogPath)
	if err != nil {
		return merchantQuote{}, nil, errors.New("the storefront catalogue is unavailable")
	}
	if err := json.Unmarshal(b, &catalog); err != nil {
		return merchantQuote{}, nil, errors.New("the storefront catalogue is invalid")
	}
	if len(items) == 0 || len(items) > 20 {
		return merchantQuote{}, []map[string]any{{"message": "Add between 1 and 20 products."}}, nil
	}

	quote := merchantQuote{Offers: []any{}, Currency: catalog.Shop.Currency}
	if quote.Currency == "" {
		quote.Currency = "INR"
	}
	problems := []map[string]any{}
	for _, requested := range items {
		if requested.Qty < 1 || requested.Qty > 20 {
			problems = append(problems, map[string]any{"handle": requested.Handle, "sku": requested.SKU, "message": "Choose a quantity from 1 to 20."})
			continue
		}
		found := false
		for _, product := range catalog.Products {
			if product.Handle != requested.Handle {
				continue
			}
			for _, variant := range product.Variants {
				if requested.SKU != "" && variant.SKU != requested.SKU {
					continue
				}
				found = true
				if !variant.InStock || variant.Inventory < requested.Qty {
					problems = append(problems, map[string]any{"handle": requested.Handle, "sku": variant.SKU, "available": variant.Inventory, "message": fmt.Sprintf("Only %d of that is available.", variant.Inventory)})
					break
				}
				line := merchantQuoteLine{Handle: product.Handle, Title: product.Title, SKU: variant.SKU, VariantTitle: variant.Title, Qty: requested.Qty, UnitPrice: variant.Price, LineTotal: variant.Price * float64(requested.Qty)}
				quote.Lines = append(quote.Lines, line)
				quote.Subtotal += line.LineTotal
				break
			}
			break
		}
		if !found {
			problems = append(problems, map[string]any{"handle": requested.Handle, "sku": requested.SKU, "message": "That product or variant is no longer available."})
		}
	}
	if len(problems) > 0 {
		return merchantQuote{}, problems, nil
	}
	if quote.Subtotal < 1200 {
		quote.Shipping = 60
	}
	quote.Total = quote.Subtotal + quote.Shipping
	quote.ExpiresAt = time.Now().Add(15 * time.Minute).UTC().Format(time.RFC3339)
	fingerprint := sha256.Sum256([]byte(fmt.Sprintf("%v|%.2f|%s", quote.Lines, quote.Total, quote.Currency)))
	quote.Fingerprint = hex.EncodeToString(fingerprint[:8])
	return quote, nil, nil
}

func (c *checkout) start(w http.ResponseWriter, r *http.Request, items []cartItem) {
	if c.keyID == "" || c.keySecret == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "Razorpay test checkout is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env and recreate the store container."})
		return
	}
	quote, problems, err := c.quote(items)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if len(problems) > 0 {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "problems": problems})
		return
	}

	amount := int64(quote.Total*100 + 0.5)
	payload := map[string]any{
		"amount": amount, "currency": quote.Currency,
		"receipt": "mm_" + quote.Fingerprint + "_" + fmt.Sprint(time.Now().Unix()),
		"notes":   map[string]string{"store": "monsoon_market", "quote": quote.Fingerprint},
	}
	var created struct {
		ID       string `json:"id"`
		Amount   int64  `json:"amount"`
		Currency string `json:"currency"`
	}
	if err := c.razorpay(http.MethodPost, "/orders", payload, &created); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "Razorpay test order creation failed: " + err.Error()})
		return
	}
	if created.ID == "" || created.Amount != amount || created.Currency != quote.Currency {
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "Razorpay returned an order that did not match the quote."})
		return
	}

	pending := pendingPayment{OrderID: created.ID, CreatedAt: time.Now().UTC().Format(time.RFC3339), Quote: quote}
	if shopper, ok := c.shop.current(r); ok {
		pending.Customer = &shopper
	}
	c.mu.Lock()
	c.pending[created.ID] = pending
	c.savePendingLocked()
	c.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "keyId": c.keyID, "orderId": created.ID, "amount": created.Amount, "currency": created.Currency, "quote": quote})
}

func (c *checkout) confirm(w http.ResponseWriter, req cartRequest) {
	if req.RazorpayOrderID == "" || req.RazorpayPaymentID == "" || req.RazorpaySignature == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Razorpay payment details are incomplete."})
		return
	}
	want := hmac.New(sha256.New, []byte(c.keySecret))
	_, _ = want.Write([]byte(req.RazorpayOrderID + "|" + req.RazorpayPaymentID))
	got, err := hex.DecodeString(req.RazorpaySignature)
	if err != nil || !hmac.Equal(got, want.Sum(nil)) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "The Razorpay signature did not verify."})
		return
	}

	var payment razorpayPayment
	if err := c.razorpay(http.MethodGet, "/payments/"+req.RazorpayPaymentID, nil, &payment); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "The payment could not be verified with Razorpay."})
		return
	}
	if payment.ID != req.RazorpayPaymentID || payment.OrderID != req.RazorpayOrderID {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "The payment does not belong to this order."})
		return
	}
	result, err := c.settle(payment)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (c *checkout) handleWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || c.webhookSecret == "" {
		http.NotFound(w, r)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	want := hmac.New(sha256.New, []byte(c.webhookSecret))
	_, _ = want.Write(body)
	got, err := hex.DecodeString(strings.TrimSpace(r.Header.Get("X-Razorpay-Signature")))
	if err != nil || !hmac.Equal(got, want.Sum(nil)) {
		http.Error(w, "bad signature", http.StatusUnauthorized)
		return
	}
	var event struct {
		Event   string `json:"event"`
		Payload struct {
			Payment struct {
				Entity razorpayPayment `json:"entity"`
			} `json:"payment"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		http.Error(w, "bad JSON", http.StatusBadRequest)
		return
	}
	if event.Event == "payment.captured" || event.Event == "order.paid" {
		_, _ = c.settle(event.Payload.Payment.Entity)
	}
	w.WriteHeader(http.StatusOK)
}

func (c *checkout) settle(payment razorpayPayment) (map[string]any, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.settled[payment.ID] {
		return map[string]any{"ok": true, "paymentId": payment.ID, "orderId": payment.OrderID, "status": payment.Status, "alreadyRecorded": true}, nil
	}
	pending, ok := c.pending[payment.OrderID]
	if !ok {
		return nil, errors.New("This store does not have a pending basket for that payment.")
	}
	wantAmount := int64(pending.Quote.Total*100 + 0.5)
	if payment.Amount != wantAmount || payment.Currency != pending.Quote.Currency {
		return nil, errors.New("That payment did not match the order total.")
	}
	if payment.Status != "captured" && payment.Status != "authorized" {
		return nil, fmt.Errorf("Razorpay reports the payment as %s, not paid", payment.Status)
	}

	record := map[string]any{
		"id": "MM-" + strings.TrimPrefix(payment.OrderID, "order_"),
		"ts": time.Now().UTC().Format(time.RFC3339), "status": "confirmed",
		"total": pending.Quote.Total, "currency": pending.Quote.Currency,
		"lines":     pending.Quote.Lines,
		"payment":   map[string]string{"id": payment.ID, "method": payment.Method, "status": payment.Status},
		"synthetic": false,
	}
	if pending.Customer != nil {
		record["customer"] = map[string]string{"id": pending.Customer.ID, "email": pending.Customer.Email, "phone": pending.Customer.Phone}
	}
	b, _ := json.Marshal(record)
	if err := os.MkdirAll(filepath.Dir(c.ordersPath), 0o700); err != nil {
		return nil, errors.New("the merchant order store is unavailable")
	}
	f, err := os.OpenFile(c.ordersPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, errors.New("the merchant order store is unavailable")
	}
	_, writeErr := f.Write(append(b, '\n'))
	closeErr := f.Close()
	if writeErr != nil || closeErr != nil {
		return nil, errors.New("the merchant order could not be recorded")
	}
	c.settled[payment.ID] = true
	delete(c.pending, payment.OrderID)
	c.savePendingLocked()
	return map[string]any{"ok": true, "paymentId": payment.ID, "orderId": payment.OrderID, "orderRef": record["id"], "status": payment.Status, "amount": pending.Quote.Total, "alreadyRecorded": false}, nil
}

func (c *checkout) razorpay(method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, strings.TrimSuffix(c.apiBase, "/")+path, reader)
	if err != nil {
		return errors.New("could not prepare the request")
	}
	req.SetBasicAuth(c.keyID, c.keySecret)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.client.Do(req)
	if err != nil {
		return errors.New("the Razorpay test API could not be reached")
	}
	defer res.Body.Close()
	response, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var failure struct {
			Error struct {
				Description string `json:"description"`
			} `json:"error"`
		}
		_ = json.Unmarshal(response, &failure)
		if failure.Error.Description != "" {
			return errors.New(failure.Error.Description)
		}
		return fmt.Errorf("Razorpay returned HTTP %d", res.StatusCode)
	}
	if out != nil && json.Unmarshal(response, out) != nil {
		return errors.New("Razorpay returned an unreadable response")
	}
	return nil
}

func (c *checkout) loadPending() {
	b, err := os.ReadFile(c.pendingPath)
	if err == nil {
		_ = json.Unmarshal(b, &c.pending)
	}
	if c.pending == nil {
		c.pending = map[string]pendingPayment{}
	}
}

func (c *checkout) savePendingLocked() {
	b, _ := json.MarshalIndent(c.pending, "", "  ")
	tmp := c.pendingPath + ".tmp"
	if os.WriteFile(tmp, append(b, '\n'), 0o600) == nil {
		_ = os.Rename(tmp, c.pendingPath)
	}
}
