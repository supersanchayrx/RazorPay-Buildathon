package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func emptyDemoStore() *store {
	return &store{
		byCustomer: map[string][]order{},
		byEmail:    map[string]customer{},
		secret:     "test-secret",
		site:       "pk_monsoon_market",
	}
}

func TestFreshDemoAcceptsAnyValidEmail(t *testing.T) {
	s := emptyDemoStore()
	form := url.Values{"email": {"fresh.tester@example.com"}}
	req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()

	s.handleLogin(rec, req)

	if rec.Code != http.StatusSeeOther || rec.Header().Get("Location") != "/account.html" {
		t.Fatalf("login = %d location %q", rec.Code, rec.Header().Get("Location"))
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != sessionCookie || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("unexpected session cookie: %#v", cookies)
	}

	pageReq := httptest.NewRequest(http.MethodGet, "/account.html", nil)
	pageReq.AddCookie(cookies[0])
	page := accountsBlock(s, pageReq)
	if !strings.Contains(page, "Signed in as") || !strings.Contains(page, "fresh.tester@example.com") {
		t.Fatalf("created account is not signed in: %s", page)
	}
	if !strings.Contains(page, "No orders on this account") {
		t.Fatalf("fresh account should honestly have no orders: %s", page)
	}
}

func TestFreshAccountPageDoesNotPromiseMissingSuggestions(t *testing.T) {
	s := emptyDemoStore()
	req := httptest.NewRequest(http.MethodGet, "/account.html", nil)
	page := accountsBlock(s, req)

	if !strings.Contains(page, "enter any valid email") {
		t.Fatalf("fresh page does not explain passwordless account creation: %s", page)
	}
	if strings.Contains(page, "Try one of these") || strings.Contains(page, `<ul class="accounts"></ul>`) {
		t.Fatalf("fresh page advertises an empty suggestion list: %s", page)
	}
}

func TestInvalidDemoEmailShowsAnActionableError(t *testing.T) {
	s := emptyDemoStore()
	form := url.Values{"email": {"not-an-email"}}
	req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()

	s.handleLogin(rec, req)

	if rec.Code != http.StatusSeeOther || rec.Header().Get("Location") != "/account.html?error=invalid" {
		t.Fatalf("invalid login = %d location %q", rec.Code, rec.Header().Get("Location"))
	}
	pageReq := httptest.NewRequest(http.MethodGet, rec.Header().Get("Location"), nil)
	if page := accountsBlock(s, pageReq); !strings.Contains(page, "Enter a valid email address") {
		t.Fatalf("invalid email error is not rendered: %s", page)
	}
}
