import { api } from './api.js';
import { latestResultsByProbe } from './ledger.js';

const state = {
  registry: [],
  registryStatus: 'idle', // idle | ok | not_implemented | error
  results: [],
  resultsStatus: 'idle',
  running: false,
  currentlyRunning: null,
};

const listeners = new Set();
function notify() {
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

export async function loadRegistry() {
  const result = await api.getProbes();
  if (result.kind === 'ok') {
    state.registry = result.data.probes || [];
    state.registryStatus = 'ok';
  } else if (result.kind === 'not_implemented') {
    state.registryStatus = 'not_implemented';
  } else {
    state.registryStatus = 'error';
  }
  notify();
  return result;
}

export async function loadResults() {
  const result = await api.getProbeResults();
  if (result.kind === 'ok') {
    state.results = result.data.results || [];
    state.resultsStatus = 'ok';
  } else if (result.kind === 'not_implemented') {
    state.resultsStatus = 'not_implemented';
  } else {
    state.resultsStatus = 'error';
  }
  notify();
  return result;
}

export function groupByClaim(registry) {
  const groups = new Map();
  for (const p of registry) {
    if (!groups.has(p.claim_id)) groups.set(p.claim_id, []);
    groups.get(p.claim_id).push(p);
  }
  return groups;
}

export function unmetRequirements(probe) {
  const latest = latestResultsByProbe(state.results);
  return (probe.requires || []).filter((reqId) => {
    const r = latest.get(reqId);
    return !r || r.verdict !== 'reachable';
  });
}

export async function runProbes(probeIds, { registryById } = {}) {
  state.running = true;
  notify();
  const skipped = [];
  for (const id of probeIds) {
    const probe = registryById ? registryById.get(id) : null;
    if (probe) {
      const unmet = unmetRequirements(probe);
      if (unmet.length) {
        skipped.push({ id, unmet });
        continue;
      }
    }
    state.currentlyRunning = id;
    notify();
    const result = await api.runProbes([id]);
    if (result.kind === 'ok') {
      state.results = [...(result.data.results || []), ...state.results];
      notify();
    } else {
      state.currentlyRunning = null;
      state.running = false;
      notify();
      return { ok: false, stoppedAt: id, result, skipped };
    }
  }
  state.currentlyRunning = null;
  state.running = false;
  notify();
  return { ok: true, skipped };
}
