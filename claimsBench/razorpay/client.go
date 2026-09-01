package razorpay

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// Client talks to the Razorpay REST API. Credentials are unexported so that
// nothing outside this package can read the key secret.
type Client struct {
	keyID     string
	keySecret string
	baseURL   string
	http      *http.Client
}

// NewClient reads credentials from the environment. It never reads a .env file
// itself — loading that is the job of main().
func NewClient() (*Client, error) {
	keyID := os.Getenv("RAZORPAY_TEST_API_KEY_ID")
	keySecret := os.Getenv("RAZORPAY_TEST_API_KEY_SECRET")

	if keyID == "" {
		return nil, errors.New("RAZORPAY_TEST_API_KEY_ID is not set")
	}
	if keySecret == "" {
		return nil, errors.New("RAZORPAY_TEST_API_KEY_SECRET is not set")
	}

	return &Client{
		keyID:     keyID,
		keySecret: keySecret,
		baseURL:   "https://api.razorpay.com/v1",
		http:      &http.Client{Timeout: 15 * time.Second},
	}, nil
}

// KeyID returns the public half of the credentials. The key id is publishable —
// it is handed to browsers during checkout — which is why it has a getter and
// the secret deliberately does not.
func (c *Client) KeyID() string {
	return c.keyID
}

// BaseURL returns the API root, so callers can report the exact URL they hit
// rather than the one they assume they hit.
func (c *Client) BaseURL() string {
	return c.baseURL
}

// Get issues a GET against path (e.g. "/orders?count=1") and returns the HTTP
// status, the raw response body, and an error.
//
// A non-2xx status is NOT an error: for this tool the status code is the
// finding. The error return is reserved for "no reply arrived at all" —
// timeout, DNS failure, connection refused.
func (c *Client) Get(path string) (int, []byte, error) {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return 0, nil, err
	}

	return c.do(req)
}

// Post issues a POST against path, JSON-encoding payload as the request body.
// Pass a nil payload to send no body at all.
func (c *Client) Post(path string, payload any) (int, []byte, error) {
	var body io.Reader

	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return 0, nil, fmt.Errorf("encoding request body: %w", err)
		}
		body = bytes.NewReader(encoded)
	}

	req, err := http.NewRequest(http.MethodPost, c.baseURL+path, body)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	return c.do(req)
}

// do authenticates and sends an already-built request. Get and Post both funnel
// through here so auth, sending and body reading exist in exactly one place.
func (c *Client) do(req *http.Request) (int, []byte, error) {
	req.SetBasicAuth(c.keyID, c.keySecret)

	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, fmt.Errorf("reading response body: %w", err)
	}

	return resp.StatusCode, body, nil
}
