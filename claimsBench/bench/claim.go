package bench

type Claim struct {
	ID       string
	Text     string
	ProbeIDs []string
}

var Claims = []Claim{
	{
		ID:       "C1",
		Text:     "A plain test account can create standard orders and complete checkout",
		ProbeIDs: []string{"P1", "P2"},
	},
	{
		ID:       "C2",
		Text:     "The Orders API mandate token (max_amount, expire_at, frequency) is reachable self-serve",
		ProbeIDs: []string{"P4", "P13"},
	},
	{
		ID:       "C3",
		Text:     "Server-to-server UPI payment creation is usable without PCI-DSS",
		ProbeIDs: []string{"P5", "P6"},
	},
	{
		ID:       "C4",
		Text:     "The IIN lookup returns usable pre-flight auth data (recurring, authentication_types)",
		ProbeIDs: []string{"P7"},
	},
	{
		ID:       "C5",
		Text:     "Payment Links work as an agent fallback",
		ProbeIDs: []string{"P8"},
	},
	{
		ID:       "C6",
		Text:     "UPI Reserve Pay is reachable self-serve",
		ProbeIDs: []string{"P10"},
	},
	{
		ID:       "C7",
		Text:     "An account's enabled payment methods are discoverable self-serve",
		ProbeIDs: []string{"P14"},
	},
}

func ResultsForClaim(c Claim, latest map[string]Result) []Result {
	var out []Result

	for _, probeID := range c.ProbeIDs {
		r, ok := latest[probeID]
		if !ok {
			continue
		}
		out = append(out, r)
	}

	return out
}
