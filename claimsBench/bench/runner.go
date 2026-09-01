package bench

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"claimsBench/types"
)

// RunOptions controls how a batch of probes is executed.
type RunOptions struct {
	// AllowDestructive must be true before any probe that creates objects in
	// the account will run. Off by default so a careless invocation is inert.
	AllowDestructive bool

	// InitialState seeds placeholder values before any probe has run. Used for
	// the key id, which one endpoint takes as a query parameter rather than in
	// an auth header.
	InitialState State
}

// RunProbes executes probes in slice order, threading captured ids from earlier
// probes into later ones, and returns one Result per probe.
func RunProbes(probes []Probe, c Caller, opts RunOptions) []Result {
	state := State{}
	for k, v := range opts.InitialState {
		state[k] = v
	}

	verdicts := make(map[string]types.Verdict)

	var out []Result

	for _, p := range probes {
		r := RunProbe(p, c, state, verdicts, opts)
		verdicts[p.ID] = r.Verdict
		out = append(out, r)
	}

	return out
}

// RunProbe executes a single probe. It always returns a Result, never an error:
// a probe that could not run is itself a finding, recorded as such.
//
// It mutates state when the probe captures ids, and reads verdicts to check
// prerequisites.
func RunProbe(p Probe, c Caller, state State, verdicts map[string]types.Verdict, opts RunOptions) Result {
	res := Result{
		ProbeID: p.ID,
		RanAt:   time.Now(),
	}

	if p.Destructive && !opts.AllowDestructive {
		return skip(res, "probe is destructive and destructive runs are not enabled")
	}

	for _, req := range p.Requires {
		v, ran := verdicts[req]
		if !ran {
			return skip(res, fmt.Sprintf("prerequisite %s has not run", req))
		}
		if v != types.Reachable {
			return skip(res, fmt.Sprintf("prerequisite %s came back %s", req, v))
		}
	}

	path, err := fillPath(p.Path, state)
	if err != nil {
		return skip(res, err.Error())
	}

	var payload any
	if p.Body != nil {
		payload = p.Body(state)
	}

	var (
		status int
		raw    []byte
	)

	switch p.Method {
	case "GET":
		status, raw, err = c.Get(path)
	case "POST":
		status, raw, err = c.Post(path, payload)
	default:
		return skip(res, fmt.Sprintf("unsupported method %q", p.Method))
	}

	// A transport error means no reply arrived, so there is nothing to judge.
	if err != nil {
		res.Verdict = types.ErrorOut
		res.ErrorDescription = err.Error()
		res.Notes = fmt.Sprintf("%s %s -> no response", p.Method, path)

		return res
	}

	verdict, desc := ClassifyResponse(status, raw)

	if verdict == types.Deprecated && status == 404 && p.NotFoundIsError {
		verdict = types.ErrorOut
		desc = "404 on a fetch-by-id: the resource did not exist, which is not evidence the endpoint is gone"
	}

	// A 200 is not the same as the feature working. If the response dropped
	// fields the probe was testing for, the API accepted the request and
	// ignored the interesting part of it.
	if verdict == types.Reachable && len(p.MustEcho) > 0 {
		if missing := missingFields(raw, p.MustEcho); len(missing) > 0 {
			verdict = types.Deprecated
			desc = fmt.Sprintf(
				"accepted with %d but the response has no %s — the request shape was allowed, the feature was not honoured",
				status, strings.Join(missing, ", "))
		}
	}

	res.Verdict = verdict
	res.Notes = fmt.Sprintf("%s %s -> %d", p.Method, path, status)

	if status < 200 || status >= 300 {
		res.ErrorDescription = desc
	}

	if verdict == types.Reachable {
		captureInto(state, p.Capture, raw)
	}

	return res
}

// skip records a probe that never reached the network. The verdict is error
// rather than gated or unknown: the reason is on our side, so it is not
// evidence about Razorpay.
func skip(res Result, reason string) Result {
	res.Verdict = types.ErrorOut
	res.ErrorDescription = "skipped: " + reason

	return res
}

// fillPath replaces every {placeholder} in path with the matching State value,
// and fails loudly if one is missing rather than sending a request with a
// literal "{order_id}" in the URL.
func fillPath(path string, state State) (string, error) {
	out := path

	for {
		open := strings.Index(out, "{")
		if open < 0 {
			return out, nil
		}

		end := strings.Index(out[open:], "}")
		if end < 0 {
			return "", fmt.Errorf("unterminated placeholder in path %q", path)
		}
		end += open

		key := out[open+1 : end]

		val, ok := state[key]
		if !ok || val == "" {
			return "", fmt.Errorf("no value captured for %q, needed by path %q", key, path)
		}

		out = out[:open] + val + out[end+1:]
	}
}

// missingFields returns those of paths that are absent, null, or empty in the
// JSON body. Paths are dotted, e.g. "token.max_amount".
func missingFields(body []byte, paths []string) []string {
	var parsed map[string]any

	if err := json.Unmarshal(body, &parsed); err != nil {
		// An unparsable body means nothing echoed back, so everything is
		// missing — better to over-report than to pass a probe by accident.
		return paths
	}

	var missing []string

	for _, path := range paths {
		if !hasField(parsed, strings.Split(path, ".")) {
			missing = append(missing, path)
		}
	}

	return missing
}

func hasField(node map[string]any, parts []string) bool {
	if len(parts) == 0 {
		return false
	}

	val, ok := node[parts[0]]
	if !ok || val == nil {
		return false
	}

	if len(parts) == 1 {
		// Present but empty counts as missing: an echoed "" or {} tells us the
		// value did not survive.
		switch v := val.(type) {
		case string:
			return v != ""
		case map[string]any:
			return len(v) > 0
		case []any:
			return len(v) > 0
		default:
			return true
		}
	}

	child, ok := val.(map[string]any)
	if !ok {
		return false
	}

	return hasField(child, parts[1:])
}

// captureInto stores response fields into state for later probes. A field that
// is absent, or not a string, is skipped silently — the probe that needs it
// will fail with a clear message when it tries to use it.
func captureInto(state State, capture map[string]string, body []byte) {
	if len(capture) == 0 {
		return
	}

	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return
	}

	for field, key := range capture {
		// First writer wins, so that a Capture listing two candidate response
		// fields for one key is not at the mercy of map iteration order.
		if _, exists := state[key]; exists {
			continue
		}

		if s, ok := parsed[field].(string); ok && s != "" {
			state[key] = s
		}
	}
}
