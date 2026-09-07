package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func checkoutFixture(t *testing.T) (*checkout, string) {
	t.Helper()
	dir := t.TempDir()
	catalog := `{
  "shop":{"currency":"INR"},
  "products":[{"handle":"tea","title":"Tea","variants":[
    {"title":"100 g","price":480,"sku":"TEA-100","inStock":true,"inventory":4}
  ]}]
}`
	if err := os.WriteFile(filepath.Join(dir, "catalog.json"), []byte(catalog), 0o600); err != nil {
		t.Fatal(err)
	}
	s := &store{byCustomer: map[string][]order{}, byEmail: map[string]customer{}}
	c := &checkout{
		catalogPath: filepath.Join(dir, "catalog.json"),
		ordersPath:  filepath.Join(dir, "orders.jsonl"),
		pendingPath: filepath.Join(dir, "pending.json"),
		keyID:       "rzp_test_public",
		keySecret:   "test-secret",
		client:      http.DefaultClient,
		shop:        s,
		pending:     map[string]pendingPayment{},
		settled:     map[string]bool{},
	}
	return c, dir
}

func TestMerchantCheckoutWorksWithoutChapman(t *testing.T) {
	c, dir := checkoutFixture(t)

	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, secret, ok := r.BasicAuth()
		if !ok || id != c.keyID || secret != c.keySecret {
			t.Error("Razorpay request did not use the merchant's server-side credentials")
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/orders":
			var body struct {
				Amount int64 `json:"amount"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.Amount != 54000 {
				t.Errorf("Razorpay amount = %d, want 54000 paise", body.Amount)
			}
			writeJSON(w, http.StatusOK, map[string]any{"id": "order_test", "amount": body.Amount, "currency": "INR"})
		case r.Method == http.MethodGet && r.URL.Path == "/payments/pay_test":
			writeJSON(w, http.StatusOK, razorpayPayment{ID: "pay_test", OrderID: "order_test", Amount: 54000, Currency: "INR", Status: "captured", Method: "card"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer api.Close()
	c.apiBase = api.URL
	c.client = api.Client()

	start := httptest.NewRequest(http.MethodPost, "/api/checkout", strings.NewReader(`{"op":"start","items":[{"handle":"tea","sku":"TEA-100","qty":1}]}`))
	start.Header.Set("Content-Type", "application/json")
	started := httptest.NewRecorder()
	c.handle(started, start)
	if started.Code != http.StatusOK || !strings.Contains(started.Body.String(), `"orderId":"order_test"`) {
		t.Fatalf("start = %d %s", started.Code, started.Body.String())
	}

	mac := hmac.New(sha256.New, []byte(c.keySecret))
	_, _ = mac.Write([]byte("order_test|pay_test"))
	signature := hex.EncodeToString(mac.Sum(nil))
	confirmBody := `{"op":"confirm","razorpay_order_id":"order_test","razorpay_payment_id":"pay_test","razorpay_signature":"` + signature + `"}`
	confirmed := httptest.NewRecorder()
	confirm := httptest.NewRequest(http.MethodPost, "/api/checkout", strings.NewReader(confirmBody))
	confirm.Header.Set("Content-Type", "application/json")
	c.handle(confirmed, confirm)
	if confirmed.Code != http.StatusOK || !strings.Contains(confirmed.Body.String(), `"ok":true`) {
		t.Fatalf("confirm = %d %s", confirmed.Code, confirmed.Body.String())
	}
	recorded, err := os.ReadFile(filepath.Join(dir, "orders.jsonl"))
	if err != nil || !strings.Contains(string(recorded), `"synthetic":false`) {
		t.Fatalf("confirmed merchant order was not recorded: %v %s", err, recorded)
	}
}

func TestCheckoutNeverTrustsBrowserPrice(t *testing.T) {
	c, _ := checkoutFixture(t)
	req := httptest.NewRequest(http.MethodPost, "/api/checkout", strings.NewReader(`{"op":"quote","items":[{"handle":"tea","sku":"TEA-100","qty":1,"price":1}]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c.handle(rec, req)
	body, _ := io.ReadAll(rec.Body)
	if rec.Code != http.StatusOK || !strings.Contains(string(body), `"total":540`) || strings.Contains(string(body), `"total":1`) {
		t.Fatalf("server did not price from its catalogue: %d %s", rec.Code, body)
	}
}

func TestWebhookIsAbsentUntilMerchantSetsSecret(t *testing.T) {
	c, _ := checkoutFixture(t)
	rec := httptest.NewRecorder()
	c.handleWebhook(rec, httptest.NewRequest(http.MethodPost, "/api/razorpay/webhook", strings.NewReader(`{}`)))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("webhook without a configured secret = %d, want 404", rec.Code)
	}
}
