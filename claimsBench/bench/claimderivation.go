package bench

import (
	"claimsBench/types"
)

func DeriveClaimState(results []Result) types.ClaimState {

	if len(results) == 0 {
		//fmt.Println("UNTESTED ALL")

		return types.Untested
	}

	allPassed := true

	for _, r := range results {
		if r.Verdict == types.Deprecated {
			//allPassed =false
			return types.Refuted
		}
	}
	for _, r := range results {
		if r.Verdict == types.Gated {
			//allPassed =false
			return types.Blocked
		}
	}

	for _, r := range results {
		if r.Verdict != types.Reachable {
			allPassed = false
			break
		}
	}

	if !allPassed {
		return types.Untested
	}

	return types.Supported
}
