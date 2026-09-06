// Accounts and orders for the demo storefront.
//
// This is the MERCHANT's half of the order-access integration, and it exists to
// prove the shape is actually implementable by someone who is not us. CHAPMAN
// gets no database credentials and no direct access to anything: the merchant
// runs two small pieces of code, and that is the entire integration.
//
//	1. mint a session token when a shopper signs in, and put it on the page
//	2. answer a signed request for one customer's orders
//
// The sign-in here has no password because this is a fixture, not a shop. The
// token minting and the feed signature are the real thing.
package main

import (
	"bufio"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

type orderLine struct {
	Handle    string  `json:"handle"`
	Title     string  `json:"title"`
	Qty       int     `json:"qty"`
	UnitPrice float64 `json:"unitPrice"`
	LineTotal float64 `json:"lineTotal"`
}

type order struct {
	ID       string      `json:"id"`
	PlacedAt string      `json:"placedAt"`
	Status   string      `json:"status"`
	Total    float64     `json:"total"`
	Currency string      `json:"currency"`
	Lines    []orderLine `json:"lines"`
	Payment  struct {
		Method string `json:"method"`
		Status string `json:"status"`
	} `json:"payment"`
	Customer  string `json:"customer"`
	Synthetic bool   `json:"synthetic"`
}

type customer struct {
	ID    string
	Email string
	// Kept because CHAPMAN's recovery agent needs a way to reach somebody, and
	// asking the SHOPPER'S BROWSER for a phone number would let any page
	// nominate any handset. The merchant holds it; the merchant serves it, over
	// the same signed request that serves their orders.
	Phone string
	Name  string
}

type store struct {
	byCustomer map[string][]order
	byEmail    map[string]customer
	secret     string
	site       string
}

// loadOrders reads the seeded history. A real merchant would query their own
// database here; the shape of what leaves this function is the only thing
// CHAPMAN ever sees.
func loadOrders(path, secret, site string) (*store, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	s := &store{
		byCustomer: map[string][]order{},
		byEmail:    map[string]customer{},
		secret:     secret,
		site:       site,
	}

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var raw struct {
			ID       string      `json:"id"`
			TS       string      `json:"ts"`
			Status   string      `json:"status"`
			Total    float64     `json:"total"`
			Currency string      `json:"currency"`
			Lines    []orderLine `json:"lines"`
			Payment  struct {
				Method string `json:"method"`
				Status string `json:"status"`
			} `json:"payment"`
			Customer struct {
				ID    string `json:"id"`
				Email string `json:"email"`
				Phone string `json:"phone"`
			} `json:"customer"`
			Synthetic bool `json:"synthetic"`
		}
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}
		o := order{
			ID: raw.ID, PlacedAt: raw.TS, Status: raw.Status, Total: raw.Total,
			Currency: raw.Currency, Lines: raw.Lines, Customer: raw.Customer.ID,
			Synthetic: raw.Synthetic,
		}
		o.Payment.Method = raw.Payment.Method
		o.Payment.Status = raw.Payment.Status
		s.byCustomer[raw.Customer.ID] = append(s.byCustomer[raw.Customer.ID], o)

		if _, seen := s.byEmail[raw.Customer.Email]; !seen {
			name := strings.SplitN(raw.Customer.Email, "@", 2)[0]
			s.byEmail[strings.ToLower(raw.Customer.Email)] = customer{
				ID: raw.Customer.ID, Email: raw.Customer.Email, Phone: raw.Customer.Phone,
				Name: titleCase(strings.TrimRight(name, "0123456789")),
			}
		}
	}
	for k := range s.byCustomer {
		rows := s.byCustomer[k]
		sort.Slice(rows, func(i, j int) bool { return rows[i].PlacedAt > rows[j].PlacedAt })
		s.byCustomer[k] = rows
	}
	return s, sc.Err()
}

/* ---------- token minting: piece one of the integration ---------- */

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// strings.Title is deprecated and Unicode-wrong; these are ASCII fixture names.
func titleCase(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func hmacB64(secret, msg string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(msg))
	return b64(m.Sum(nil))
}

// mintSession produces the token CHAPMAN will verify. Short-lived, bound to one
// site, and it names the merchant's own customer id rather than an email —
// an email is guessable, and this token is a bearer credential.
func (s *store) mintSession(customerID string) string {
	payload, _ := json.Marshal(map[string]any{
		"site": s.site,
		"sub":  customerID,
		"exp":  time.Now().Add(15 * time.Minute).Unix(),
	})
	body := b64(payload)
	return "v1." + body + "." + hmacB64(s.secret, body)
}

/* ---------- the order feed: piece two ---------- */

// verifyRequest checks that a request for a customer's orders really came from
// CHAPMAN. Without this the feed is an open endpoint that hands every customer
// to anyone who guesses the URL — the same failure as trusting a typed email,
// moved one hop away where it is easier to miss.
func (s *store) verifyRequest(r *http.Request, sub string) error {
	ts := r.Header.Get("X-Chapman-Timestamp")
	sig := r.Header.Get("X-Chapman-Signature")
	if ts == "" || sig == "" {
		return fmt.Errorf("unsigned request")
	}
	n, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return fmt.Errorf("bad timestamp")
	}
	// A narrow window, so a captured request cannot be replayed tomorrow.
	if d := time.Since(time.Unix(n, 0)); d > 5*time.Minute || d < -5*time.Minute {
		return fmt.Errorf("stale timestamp")
	}
	want := hmacB64(s.secret, ts+"."+sub)
	if !hmac.Equal([]byte(sig), []byte(want)) {
		return fmt.Errorf("bad signature")
	}
	return nil
}

func (s *store) handleOrders(w http.ResponseWriter, r *http.Request) {
	sub := r.URL.Query().Get("customer")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if sub == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "customer is required"})
		return
	}
	if err := s.verifyRequest(r, sub); err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	// Only ever this customer's rows. The merchant scopes the query; CHAPMAN
	// re-checks on arrival. Two independent checks, because a leak here would
	// be a leak of the merchant's customers by the merchant's own code.
	rows := s.byCustomer[sub]
	if rows == nil {
		rows = []order{}
	}

	// How to reach this person, alongside what they bought.
	//
	// This is the merchant deciding to expose contact details for their own
	// customer, over a request they have already authenticated. It is the only
	// route by which CHAPMAN ever learns a phone number: the storefront's
	// basket beacon proves WHO somebody is with a signed token and is never
	// asked WHERE to reach them, because a page that could answer that could
	// point an outbound call at a stranger.
	//
	// A merchant who does not want outreach simply omits this object, and every
	// basket is then suppressed as `no_channel` with that reason shown.
	out := map[string]any{"orders": rows}
	if c, ok := s.byID(sub); ok {
		out["customer"] = map[string]string{"id": c.ID, "email": c.Email, "phone": c.Phone}
	}
	json.NewEncoder(w).Encode(out)
}

/* ---------- sign-in (a fixture, not a real login) ---------- */

const sessionCookie = "np_customer"

func (s *store) handleLogin(w http.ResponseWriter, r *http.Request) {
	email := strings.ToLower(strings.TrimSpace(r.FormValue("email")))
	c, ok := s.byEmail[email]
	if !ok {
		http.Redirect(w, r, "/account.html?error=1", http.StatusSeeOther)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: c.ID, Path: "/", HttpOnly: true, MaxAge: 3600,
	})
	http.Redirect(w, r, "/account.html", http.StatusSeeOther)
}

func (s *store) handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// byID looks a customer up by the merchant's own id.
func (s *store) byID(id string) (customer, bool) {
	for _, c := range s.byEmail {
		if c.ID == id {
			return c, true
		}
	}
	return customer{}, false
}

// current returns the signed-in customer, if any.
func (s *store) current(r *http.Request) (customer, bool) {
	ck, err := r.Cookie(sessionCookie)
	if err != nil || ck.Value == "" {
		return customer{}, false
	}
	for _, c := range s.byEmail {
		if c.ID == ck.Value {
			return c, true
		}
	}
	return customer{}, false
}

// sessionScript is injected into every page. Signed out, it defines nothing and
// the widget behaves exactly as it always has.
func (s *store) sessionScript(r *http.Request) string {
	c, ok := s.current(r)
	if !ok {
		return ""
	}
	return fmt.Sprintf(
		`<script>window.CHAPMAN_SESSION=%q;window.NP_CUSTOMER=%q;</script>`,
		s.mintSession(c.ID), c.Name,
	)
}

// accountsBlock renders the sign-in fixture. Nothing here is part of the
// CHAPMAN integration — a real merchant already has a login — it exists so the
// signed-in and signed-out paths can both be demonstrated.
func accountsBlock(s *store, r *http.Request) string {
	c, ok := s.current(r)
	if !ok {
		var b strings.Builder
		b.WriteString(`<form method="post" action="/login" class="signin">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" placeholder="you@example.com" required>
      <button type="submit">Sign in</button>
    </form>
    <p class="hint">No password — this is a demo shop. Try one of these accounts:</p>
    <ul class="accounts">`)
		for _, a := range s.someEmails(4) {
			fmt.Fprintf(&b, `<li><a href="#" onclick="document.getElementById('email').value='%s';return false;">%s</a> <span>%d orders</span></li>`,
				a.Email, a.Email, len(s.byCustomer[a.ID]))
		}
		b.WriteString(`</ul>`)
		return b.String()
	}

	var b strings.Builder
	fmt.Fprintf(&b, `<p class="signedin">Signed in as <b>%s</b> · <a href="/logout">Sign out</a></p>`, c.Email)
	rows := s.byCustomer[c.ID]
	if len(rows) == 0 {
		b.WriteString(`<p class="hint">No orders on this account.</p>`)
		return b.String()
	}
	b.WriteString(`<table class="orders"><thead><tr><th>Order</th><th>Placed</th><th>Total</th><th>Status</th><th>Items</th></tr></thead><tbody>`)
	for i, o := range rows {
		if i >= 6 {
			break
		}
		items := make([]string, 0, len(o.Lines))
		for _, l := range o.Lines {
			items = append(items, fmt.Sprintf("%d× %s", l.Qty, l.Title))
		}
		fmt.Fprintf(&b, `<tr><td>%s</td><td>%s</td><td>₹%.0f</td><td>%s</td><td>%s</td></tr>`,
			o.ID, o.PlacedAt[:10], o.Total, o.Status, strings.Join(items, ", "))
	}
	b.WriteString(`</tbody></table>
    <p class="hint">Now open the assistant and ask <b>“where's my order?”</b> — it will know, because this page handed it a signed token. Sign out and ask again: it will decline.</p>`)
	return b.String()
}

// someEmails gives the sign-in page a few real addresses to offer, since the
// fixture's customers are synthetic and nobody could guess them.
func (s *store) someEmails(n int) []customer {
	out := make([]customer, 0, len(s.byEmail))
	for _, c := range s.byEmail {
		if len(s.byCustomer[c.ID]) >= 3 {
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool { return len(s.byCustomer[out[i].ID]) > len(s.byCustomer[out[j].ID]) })
	if len(out) > n {
		out = out[:n]
	}
	return out
}
