package bench

import (
	"claimsBench/types"
	"time"
)

type Result struct {
	ProbeID          string
	RanAt            time.Time
	Verdict          types.Verdict
	ErrorDescription string
	Notes            string
}

func FetchLatestResults(results []Result) map[string]Result {
	resultsMap := make(map[string]Result)

	for _, r := range results {
		val, existing := resultsMap[r.ProbeID]

		if existing {
			if r.RanAt.After(val.RanAt) {
				resultsMap[r.ProbeID] = r
			}
		} else {
			resultsMap[r.ProbeID] = r
		}
	}

	return resultsMap
}
