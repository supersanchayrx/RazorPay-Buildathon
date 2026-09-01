package bench

import "claimsBench/types"

// State carries values captured from earlier probes into later ones — an order
// id created by P1, a payment id created by P5. Keys are our own names, not
// Razorpay's.
type State map[string]string

// Caller is the slice of an HTTP client that the runner needs. razorpay.Client
// satisfies it without knowing this interface exists, which is what keeps the
// bench package free of any network import: the concrete client is passed in,
// never reached for.
type Caller interface {
	Get(path string) (int, []byte, error)
	Post(path string, payload any) (int, []byte, error)
}

// Probe is one experiment against the Razorpay API: a single HTTP call whose
// outcome is evidence for or against a Claim.
type Probe struct {
	ID      string
	Purpose string
	ClaimID string

	// Method is "GET" or "POST" as a plain string, deliberately not
	// http.MethodGet — bench must not depend on net/http.
	Method string

	// Path is appended to the client's base URL. It may contain {placeholders}
	// which are filled from State, e.g. "/orders/{order_id}".
	Path string

	// Body builds the request payload at call time, given the State captured so
	// far. Nil means send no body. It is a function rather than a plain value so
	// a probe can use a live timestamp or an id created moments earlier.
	Body func(s State) any

	// Expected is what we predicted before running. The point of the bench is
	// to find out where this is wrong.
	Expected types.Verdict

	// Requires lists probe IDs that must have come back reachable first.
	Requires []string

	// Destructive marks a probe that creates real objects in the account.
	Destructive bool

	// Capture maps fields of a successful JSON response to State keys, e.g.
	// {"id": "order_id"}.
	Capture map[string]string

	// MustEcho lists JSON fields that a successful response has to actually
	// contain, as dotted paths like "token.max_amount".
	//
	// This guards against a fake success: an API that accepts a request,
	// silently discards the parts it does not support, and returns 200. Without
	// this check a dropped feature is indistinguishable from a working one.
	MustEcho []string

	// NotFoundIsError flags a probe that fetches a resource by id. For those a
	// 404 means "that id doesn't exist", not "this endpoint is gone", so the
	// usual 404 -> deprecated rule would report a falsehood.
	NotFoundIsError bool
}
