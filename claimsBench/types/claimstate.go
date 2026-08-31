package types

type ClaimState string

const (
	Untested  ClaimState = "untested"
	Supported ClaimState = "supported"
	Refuted   ClaimState = "refuted"
	Blocked   ClaimState = "blocked"
)
