export const CLAIMS = [
  {
    id: 'C1',
    text: "A plain test account can create standard orders and complete checkout",
    probeIds: ['P1', 'P2'],
    polarity: 'positive',
  },
  {
    id: 'C2',
    text: "The Orders API mandate token (max_amount, expire_at, frequency) is reachable self-serve",
    probeIds: ['P4'],
    polarity: 'positive',
  },
  {
    id: 'C3',
    text: "Server-to-server UPI payment creation is usable without PCI-DSS",
    probeIds: ['P5', 'P6'],
    polarity: 'positive',
  },
  {
    id: 'C4',
    text: "The IIN lookup returns usable pre-flight auth data (recurring, authentication_types)",
    probeIds: ['P7'],
    polarity: 'positive',
  },
  {
    id: 'C5',
    text: "Payment Links work as an agent fallback",
    probeIds: ['P8'],
    polarity: 'positive',
  },
  {
    id: 'C6',
    text: "UPI Reserve Pay has no self-serve surface",
    probeIds: ['P10'],
    polarity: 'negative',
  },
];

// C6 is a negative claim: the absence of a reachable surface is the supported outcome,
// so 'deprecated' supports it and 'reachable' contradicts it — the inverse of every other claim.
function classify(polarity, verdict) {
  const supportVerdict = polarity === 'negative' ? 'deprecated' : 'reachable';
  const contradictVerdict = polarity === 'negative' ? 'reachable' : 'deprecated';
  if (verdict === supportVerdict) return 'supports';
  if (verdict === contradictVerdict) return 'contradicts';
  if (verdict === 'gated') return 'gates';
  return 'inconclusive';
}

export function deriveClaimState(claim, latestResultByProbeId) {
  const relevant = claim.probeIds
    .map((id) => latestResultByProbeId.get(id))
    .filter(Boolean);

  if (relevant.length === 0) return 'UNTESTED';

  const classes = relevant.map((r) => classify(claim.polarity, r.verdict));

  if (classes.every((c) => c === 'supports')) return 'SUPPORTED';
  if (classes.some((c) => c === 'contradicts')) return 'REFUTED';
  if (classes.some((c) => c === 'gates')) return 'BLOCKED';
  return 'UNTESTED';
}

export function latestResultsByProbe(results) {
  const map = new Map();
  for (const r of results) {
    const existing = map.get(r.probe_id);
    if (!existing || new Date(r.ran_at) > new Date(existing.ran_at)) {
      map.set(r.probe_id, r);
    }
  }
  return map;
}

export function buildLedger(results) {
  const latest = latestResultsByProbe(results);
  return CLAIMS.map((claim) => ({
    claim,
    state: deriveClaimState(claim, latest),
  }));
}
