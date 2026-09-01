package bench

import (
	"encoding/json"
	"strings"

	"claimsBench/types"
)

// errorEnvelope mirrors the JSON Razorpay returns on a failed call:
//
//	{"error":{"code":"BAD_REQUEST_ERROR","description":"...","reason":"..."}}
type errorEnvelope struct {
	Error struct {
		Code        string `json:"code"`
		Description string `json:"description"`
		Reason      string `json:"reason"`
		Source      string `json:"source"`
		Step        string `json:"step"`
		Field       string `json:"field"`
	} `json:"error"`

	// Message carries gateway-level errors, which arrive with no error object
	// at all: {"message":"no Route matched with those values"}.
	Message string `json:"message"`
}

// gatewayMiss is what Razorpay's edge returns for an address it does not
// recognise at all. It is distinguishable from an application-level refusal,
// and the difference matters enormously: this one means the probe has the
// wrong URL, so it is a defect in the bench rather than a finding about
// Razorpay.
const gatewayMiss = "no route matched"

// gatedPhrases mark a refusal that is about entitlement — the endpoint exists
// and works, this account just isn't allowed to use it. That is the single most
// interesting outcome this tool can report, and Razorpay usually expresses it
// as a 400, not a 403, which is why the body has to be read.
var gatedPhrases = []string{
	"not enabled",
	"not activated",
	"not permitted",
	"no permission",
	"not have access",
	"not authorised",
	"not authorized",
	"merchant is not",
	"contact razorpay support",
	"raise a request",
	"feature is not",
}

// deprecatedPhrases mark a surface that is gone or was never public, as opposed
// to one being withheld.
var deprecatedPhrases = []string{
	"deprecated",
	"discontinued",
	"no longer",
	"not supported",
	"unsupported",
	"invalid url",
	// Razorpay sometimes returns a 404-in-a-400's clothing: status 400 with a
	// body saying the URL itself does not exist. Observed live on /iins/{iin}.
	"url was not found",
	"not found on the server",
}

// ClassifyResponse turns an HTTP status and response body into a Verdict, plus
// the human-readable description Razorpay supplied (empty when there was none).
//
// It takes an int and a []byte rather than an *http.Response on purpose: this
// keeps the bench package free of any network dependency, so the judgment
// rules stay testable offline with hand-written inputs.
func ClassifyResponse(status int, body []byte) (types.Verdict, string) {
	desc := errorDescription(body)
	haystack := strings.ToLower(desc)

	// Checked before anything else, including the 404 rule. An unrecognised
	// address must never be reported as a finding — that would let a typo in a
	// probe masquerade as a discovery about Razorpay.
	if strings.Contains(haystack, gatewayMiss) {
		return types.ErrorOut, "the gateway does not recognise this address at all, so the probe URL is wrong: " + desc
	}

	switch {
	// The call worked. The surface exists and this account may use it.
	case status >= 200 && status < 300:
		return types.Reachable, desc

	// Our own credentials were rejected. This says nothing about the claim
	// under test — it means the bench is misconfigured.
	case status == 401:
		return types.ErrorOut, desc

	// Transport-ish failures: retry later, no evidence either way.
	case status == 408, status == 429, status >= 500:
		return types.ErrorOut, desc

	// The surface itself is absent. NOTE: a 404 from a fetch-by-id probe
	// (P2, P6) means "that id doesn't exist", not "endpoint is gone" — those
	// probes need to override this.
	case status == 404, status == 405:
		return types.Deprecated, desc
	}

	// Below here the status alone is ambiguous (overwhelmingly a 400), so the
	// description decides. Deprecated is checked first: "not supported" should
	// not be swallowed by the looser gated phrases.
	if containsAny(haystack, deprecatedPhrases) {
		return types.Deprecated, desc
	}
	if containsAny(haystack, gatedPhrases) {
		return types.Gated, desc
	}

	// A bare 403 with nothing quotable is still a refusal on entitlement
	// grounds — that is what the status means.
	if status == 403 {
		return types.Gated, desc
	}

	// A 400 we can't read is usually our own malformed payload, but it can also
	// be a soft gate. Refuse to guess.
	return types.Unknown, desc
}

// errorDescription pulls the description out of a Razorpay error envelope.
// A body that isn't JSON, or is JSON without an error object, yields "".
func errorDescription(body []byte) string {
	var envelope errorEnvelope

	if err := json.Unmarshal(body, &envelope); err != nil {
		return ""
	}

	if envelope.Error.Description != "" {
		return envelope.Error.Description
	}

	// Falls back to the gateway's bare message, which has no error object.
	return envelope.Message
}

func containsAny(haystack string, needles []string) bool {
	for _, n := range needles {
		if strings.Contains(haystack, n) {
			return true
		}
	}

	return false
}
