package bench

import (
	"fmt"
	"time"

	"claimsBench/types"
)

// Fixed test-account details. These are deliberately obvious placeholders so
// anything they create is recognisable in the Razorpay dashboard.
const (
	probeAmount  = 50000 // paise, i.e. INR 500.00
	probeName    = "Bench Probe"
	probeEmail   = "bench.probe@example.com"
	probeContact = "9123456780"
)

// Probes is the registry, in run order. Order matters: probes that capture ids
// must precede the probes that consume them.
var Probes = []Probe{
	{
		ID:          "P1",
		Purpose:     "Create a standard order",
		ClaimID:     "C1",
		Method:      "POST",
		Path:        "/orders",
		Expected:    types.Reachable,
		Destructive: true,
		Capture:     map[string]string{"id": "order_id"},
		Body: func(s State) any {
			return map[string]any{
				"amount":   probeAmount,
				"currency": "INR",
				"receipt":  "bench-p1",
			}
		},
	},
	{
		ID:              "P2",
		Purpose:         "Fetch the order back by ID",
		ClaimID:         "C1",
		Method:          "GET",
		Path:            "/orders/{order_id}",
		Expected:        types.Reachable,
		Requires:        []string{"P1"},
		NotFoundIsError: true,
	},
	{
		ID:          "P3",
		Purpose:     "Create a customer",
		ClaimID:     "C2",
		Method:      "POST",
		Path:        "/customers",
		Expected:    types.Reachable,
		Destructive: true,
		Capture:     map[string]string{"id": "customer_id"},
		Body: func(s State) any {
			return map[string]any{
				"name":    probeName,
				"email":   probeEmail,
				"contact": probeContact,
				// "0" means "return the existing customer instead of erroring"
				// so re-running the bench is not a hard failure.
				"fail_existing": "0",
			}
		},
	},
	{
		ID:          "P4",
		Purpose:     "Mandate order with token object (max_amount, expire_at, frequency)",
		ClaimID:     "C2",
		Method:      "POST",
		Path:        "/orders",
		Expected:    types.Gated,
		Requires:    []string{"P3"},
		Destructive: true,
		Capture:     map[string]string{"id": "mandate_order_id"},
		Body: func(s State) any {
			return map[string]any{
				// Not 0: Razorpay rejects a zero-amount order outright with
				// "Order amount less than minimum amount allowed", which never
				// reaches the mandate logic we are actually probing.
				"amount":      probeAmount,
				"currency":    "INR",
				"method":      "upi",
				"customer_id": s["customer_id"],
				"receipt":     "bench-p4",
				"token": map[string]any{
					"max_amount": 1000000,
					"expire_at":  time.Now().AddDate(0, 6, 0).Unix(),
					"frequency":  "monthly",
				},
			}
		},
	},
	{
		ID:          "P5",
		Purpose:     "Create a UPI payment server-to-server",
		ClaimID:     "C3",
		Method:      "POST",
		Path:        "/payments/create/upi",
		Expected:    types.Unknown,
		Requires:    []string{"P1"},
		Destructive: true,
		Capture: map[string]string{
			"razorpay_payment_id": "payment_id",
			"id":                  "payment_id",
		},
		Body: func(s State) any {
			return map[string]any{
				"amount":   probeAmount,
				"currency": "INR",
				"order_id": s["order_id"],
				"email":    probeEmail,
				"contact":  probeContact,
				"method":   "upi",
				"upi": map[string]any{
					"flow": "collect",
					"vpa":  "success@razorpay",
				},
			}
		},
	},
	{
		ID:              "P6",
		Purpose:         "Confirm the s2s UPI payment",
		ClaimID:         "C3",
		Method:          "GET",
		Path:            "/payments/{payment_id}",
		Expected:        types.Unknown,
		Requires:        []string{"P5"},
		NotFoundIsError: true,
	},
	{
		ID:       "P7",
		Purpose:  "IIN lookup for pre-flight auth data",
		ClaimID:  "C4",
		Method:   "GET",
		Path:     "/iins/411111",
		Expected: types.Reachable,
	},
	{
		ID:          "P8",
		Purpose:     "Create a payment link",
		ClaimID:     "C5",
		Method:      "POST",
		Path:        "/payment_links",
		Expected:    types.Reachable,
		Destructive: true,
		Body: func(s State) any {
			return map[string]any{
				"amount":      probeAmount,
				"currency":    "INR",
				"description": "Bench probe P8",
				"customer": map[string]any{
					"name":    probeName,
					"email":   probeEmail,
					"contact": probeContact,
				},
				// Notifications off: a probe must not send mail or SMS to
				// anyone, least of all on every run.
				"notify": map[string]any{
					"sms":   false,
					"email": false,
				},
				"reminder_enable": false,
			}
		},
	},
	{
		ID:          "P10",
		Purpose:     "UPI Reserve Pay",
		ClaimID:     "C6",
		Method:      "POST",
		Path:        "/payments/create/upi",
		Expected:    types.Deprecated,
		Requires:    []string{"P1"},
		Destructive: true,
		Body: func(s State) any {
			return map[string]any{
				"amount":   probeAmount,
				"currency": "INR",
				"order_id": s["order_id"],
				"email":    probeEmail,
				"contact":  probeContact,
				"method":   "upi",
				"upi": map[string]any{
					"flow": "reserve_pay",
				},
			}
		},
	},
	{
		ID:      "P13",
		Purpose: "Fetch the mandate order back and check the token fields survived",
		ClaimID: "C2",
		Method:  "GET",
		Path:    "/orders/{mandate_order_id}",
		// Reachable only if the mandate fields are still attached. A 200 whose
		// body has quietly lost them means Razorpay accepted the request and
		// ignored the part we were testing, which is the whole point of P4.
		Expected:        types.Reachable,
		Requires:        []string{"P4"},
		NotFoundIsError: true,
		MustEcho: []string{
			"token.max_amount",
			"token.expire_at",
			"token.frequency",
		},
	},
	{
		ID:      "P14",
		Purpose: "Ask which payment methods are enabled for this account",
		ClaimID: "C7",
		Method:  "GET",
		// Takes the key id as a query parameter rather than in an auth header.
		// The key id is publishable, so this leaks nothing.
		// No MustEcho here: the exact response shape is unconfirmed, and a wrong
		// guess would report a working endpoint as broken. Inspect the body
		// with "bench-cli get /methods?key_id={key_id}" first.
		Path:     "/methods?key_id={key_id}",
		Expected: types.Reachable,
	},
}

// ProbeByID returns the probe with the given ID.
func ProbeByID(id string) (Probe, bool) {
	for _, p := range Probes {
		if p.ID == id {
			return p, true
		}
	}

	return Probe{}, false
}

// SelectProbes resolves a list of probe IDs into probes to run, pulling in any
// prerequisites they depend on. An empty list means "all of them".
//
// The result is always in registry order, never in the order the caller typed
// the IDs, because a probe that captures an id must run before the probe that
// consumes it.
func SelectProbes(ids []string) ([]Probe, error) {
	if len(ids) == 0 {
		return Probes, nil
	}

	wanted := make(map[string]bool)

	// Declared before it is assigned so the function body can refer to itself.
	// A plain "add := func(...)" cannot: the name does not exist yet inside its
	// own definition.
	var add func(id string) error

	add = func(id string) error {
		if wanted[id] {
			return nil
		}

		p, ok := ProbeByID(id)
		if !ok {
			return fmt.Errorf("unknown probe %q", id)
		}

		wanted[id] = true

		for _, req := range p.Requires {
			if err := add(req); err != nil {
				return err
			}
		}

		return nil
	}

	for _, id := range ids {
		if err := add(id); err != nil {
			return nil, err
		}
	}

	var out []Probe

	for _, p := range Probes {
		if wanted[p.ID] {
			out = append(out, p)
		}
	}

	return out, nil
}
