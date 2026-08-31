package types

type Verdict string

const (
	Reachable  Verdict = "reachable"
	Gated      Verdict = "gated"
	Deprecated Verdict = "deprecated"
	ErrorOut   Verdict = "error"
	Unknown    Verdict = "unknown"
)
