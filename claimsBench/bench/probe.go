package bench

//import "fmt"

import "claimsBench/types"

type Probe struct {
	ID           string
	Purpose      string
	Claim        string
	RazorpayCall string
	Expected     types.Verdict
	Requires     []string
	Destructive  bool
}
