import { loadConfig, isFixtureMode } from './config.js';
import { api } from './api.js';
import * as probesModule from './probes.js';
import { CLAIMS, buildLedger, latestResultsByProbe } from './ledger.js';
import {
  el, clear, verdictChip, claimStateChip, definitionList, errorEnvelope,
  jsonViewer, emptyState, notImplementedState, networkErrorState, mountFixturesBadge,
} from './render.js';
import { exportMarkdown, exportJson } from './export.js';

let currentConfig = null;
const ledgerRowEls = new Map();
const expandedIds = new Set();

function mountLiveBanner() {
  const banner = el('div', { class: 'live-banner' }, 'Live mode — every probe here reaches production Razorpay.');
  document.body.insertBefore(banner, document.body.firstChild);
}

function renderBlockingPanel(result) {
  const mount = document.getElementById('blocking-panel-mount');
  const detail = result.kind === 'not_implemented'
    ? 'Add GET /api/config on the backend to boot the Bench.'
    : (result.message || 'The backend could not be reached.');
  mount.appendChild(el('div', { class: 'blocking-panel' }, [
    el('h1', null, 'The backend is unreachable'),
    el('p', { class: 'mono muted' }, detail),
  ]));
}

function initLedger() {
  const container = document.getElementById('ledger');
  clear(container);
  for (const claim of CLAIMS) {
    const chip = claimStateChip('UNTESTED');
    const row = el('tr', { class: 'ledger-row ledger-row--untested' }, [
      el('td', { class: 'ledger-row__id mono' }, claim.id),
      el('td', { class: 'ledger-row__text' }, claim.text),
      el('td', null, chip),
      el('td', { class: 'ledger-row__probes' }, `Fed by ${claim.probeIds.join(', ')}`),
    ]);
    container.appendChild(row);
    ledgerRowEls.set(claim.id, { row, chip });
  }
}

function updateLedger(results) {
  const rows = buildLedger(results);
  for (const { claim, state } of rows) {
    const refs = ledgerRowEls.get(claim.id);
    if (!refs) continue;
    const newRowClass = `ledger-row ledger-row--${state.toLowerCase()}`;
    if (refs.row.className !== newRowClass) refs.row.className = newRowClass;
    const newChip = claimStateChip(state);
    if (refs.chip.className !== newChip.className) {
      refs.chip.className = newChip.className;
      refs.chip.textContent = newChip.textContent;
    }
  }
}

function buildIinLookup() {
  const wrap = el('div', { class: 'iin-lookup' });
  wrap.appendChild(el('div', { class: 'probe-detail__label' }, 'Look up an IIN'));
  const input = el('input', { type: 'text', inputmode: 'numeric', maxlength: '6', value: '411111', 'aria-label': 'Six-digit IIN' });
  const resultMount = el('div');
  const form = el('form', {
    class: 'iin-lookup__form',
    onsubmit: async (e) => {
      e.preventDefault();
      clear(resultMount);
      resultMount.appendChild(el('p', { class: 'muted mono', style: 'font-size:0.8rem;' }, 'Looking up…'));
      const value = input.value.trim();
      const result = await api.getIin(value);
      clear(resultMount);
      if (result.kind === 'ok') {
        resultMount.appendChild(definitionList([
          ['Network', result.data.network],
          ['Type', result.data.type],
          ['Issuer', result.data.issuer_name],
          ['International', String(result.data.international)],
          ['Recurring available', result.data.recurring ? String(result.data.recurring.available) : '—'],
          ['Auth types', (result.data.authentication_types || []).map((a) => a.type).join(', ')],
        ]));
        resultMount.appendChild(jsonViewer(result.data.raw));
      } else if (result.kind === 'not_implemented') {
        resultMount.appendChild(notImplementedState(`GET /api/iin/${value}`));
      } else if (result.kind === 'api_error') {
        resultMount.appendChild(errorEnvelope(result.error));
      } else {
        resultMount.appendChild(networkErrorState(result.message));
      }
    },
  }, [input, el('button', { type: 'submit', class: 'run-btn' }, 'Look up')]);
  wrap.appendChild(form);
  wrap.appendChild(resultMount);
  return wrap;
}

function buildProbeDetail(probe, result) {
  const wrap = el('div');
  wrap.appendChild(el('p', { class: 'probe-detail__question' }, probe.question));
  const grid = el('div', { class: 'probe-detail__grid' });

  const left = el('div');
  left.appendChild(el('div', { class: 'probe-detail__label' }, 'Request'));
  if (result) {
    left.appendChild(definitionList([['Method', result.request.method], ['Path', result.request.path]]));
    left.appendChild(jsonViewer(result.request.body ?? 'null'));
  } else {
    left.appendChild(el('p', { class: 'muted' }, 'This probe has not run yet.'));
  }

  const right = el('div');
  if (result) {
    right.appendChild(el('div', { class: 'probe-detail__label' }, 'Finding'));
    right.appendChild(result.razorpay_error
      ? errorEnvelope(result.razorpay_error)
      : el('p', { class: 'muted' }, 'The call succeeded with no error envelope.'));
    right.appendChild(el('div', { class: 'probe-detail__label', style: 'margin-top:16px;' }, 'Raw response'));
    right.appendChild(jsonViewer(result.response ? result.response.body : ''));
    if (result.notes) right.appendChild(el('p', { class: 'muted', style: 'margin-top:8px; font-size:0.8rem;' }, result.notes));
  }

  grid.appendChild(left);
  grid.appendChild(right);
  wrap.appendChild(grid);

  if (probe.razorpay_call.includes('/iins/')) {
    wrap.appendChild(buildIinLookup());
  }

  return wrap;
}

function appendProbeRows(tbody, probe, result) {
  const unmet = probesModule.unmetRequirements(probe);
  const verdict = result ? result.verdict : null;
  const rowClass = ['probe-row', verdict ? `probe-row--${verdict}` : '', unmet.length ? 'probe-row--disabled' : '']
    .filter(Boolean).join(' ');

  const expandBtn = el('button', {
    class: 'expand-btn mono',
    type: 'button',
    'aria-expanded': expandedIds.has(probe.id) ? 'true' : 'false',
    'aria-controls': `detail-${probe.id}`,
    onclick: () => {
      if (expandedIds.has(probe.id)) expandedIds.delete(probe.id); else expandedIds.add(probe.id);
      renderProbeGroups();
    },
  }, probe.id);

  const runBtn = el('button', {
    class: 'run-btn',
    type: 'button',
    disabled: unmet.length > 0 || probesModule.getState().running,
    onclick: () => runSingle(probe.id),
  }, 'Run probe');

  const tr = el('tr', { class: rowClass, 'data-verdict': verdict || 'unrun', 'data-probe-id': probe.id }, [
    el('td', null, expandBtn),
    el('td', null, probe.title),
    el('td', { class: 'probe-call' }, probe.razorpay_call),
    el('td', { class: 'probe-expectation' }, probe.expectation),
    el('td', null, verdict ? verdictChip(verdict) : el('span', { class: 'muted mono', style: 'font-size:0.75rem;' }, 'Not run')),
    el('td', { class: 'mono', style: 'font-size:0.8rem;' }, result && result.response ? String(result.response.http_status) : '—'),
    el('td', { class: 'probe-duration' }, result ? `${result.duration_ms} ms` : '—'),
    el('td', null, [
      runBtn,
      unmet.length ? el('div', { class: 'probe-destructive' }, `Requires ${unmet.join(', ')}`) : null,
    ]),
  ]);
  tbody.appendChild(tr);

  const expanded = expandedIds.has(probe.id);
  const detailTr = el('tr', { class: 'probe-detail', id: `detail-${probe.id}`, hidden: !expanded });
  const detailTd = el('td', { colspan: '8' });
  if (expanded) detailTd.appendChild(buildProbeDetail(probe, result));
  detailTr.appendChild(detailTd);
  tbody.appendChild(detailTr);
}

function applyFilter() {
  const val = document.getElementById('verdict-filter').value;
  const rows = document.querySelectorAll('#probe-groups tr.probe-row');
  rows.forEach((row) => {
    const v = row.getAttribute('data-verdict');
    const show = !val || v === val;
    row.hidden = !show;
    const detail = document.getElementById(`detail-${row.dataset.probeId}`);
    if (detail && !show) detail.hidden = true;
  });
  document.querySelectorAll('.probe-group').forEach((group) => {
    const anyVisible = [...group.querySelectorAll('tr.probe-row')].some((r) => !r.hidden);
    group.hidden = !anyVisible;
  });
}

function renderProbeGroups() {
  const container = document.getElementById('probe-groups');
  clear(container);
  const { registry, results, registryStatus } = probesModule.getState();

  if (registryStatus === 'not_implemented') {
    container.appendChild(notImplementedState('GET /api/probes'));
    return;
  }
  if (registryStatus === 'error') {
    container.appendChild(networkErrorState('The probe registry could not be loaded.'));
    return;
  }
  if (!registry.length) {
    container.appendChild(emptyState('No probes have run. Start with P1 to confirm the account works at all.'));
    return;
  }

  const latest = latestResultsByProbe(results);
  const groups = probesModule.groupByClaim(registry);
  for (const claim of CLAIMS) {
    const probesForClaim = groups.get(claim.id) || [];
    if (!probesForClaim.length) continue;
    const groupWrap = el('div', { class: 'probe-group' });
    groupWrap.appendChild(el('div', { class: 'probe-group__title' }, `${claim.id} — ${claim.text}`));
    const table = el('table', { class: 'probe-table' });
    const thead = el('thead', null, el('tr', null, [
      el('th', { scope: 'col', 'aria-label': 'Probe ID / expand' }, ''),
      el('th', { scope: 'col' }, 'Title'),
      el('th', { scope: 'col' }, 'Razorpay call'),
      el('th', { scope: 'col' }, 'Predicted'),
      el('th', { scope: 'col' }, 'Verdict'),
      el('th', { scope: 'col' }, 'Status'),
      el('th', { scope: 'col' }, 'Duration'),
      el('th', { scope: 'col' }, 'Run'),
    ]));
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const probe of probesForClaim) appendProbeRows(tbody, probe, latest.get(probe.id));
    table.appendChild(tbody);
    groupWrap.appendChild(table);
    container.appendChild(groupWrap);
  }
  applyFilter();
}

async function runSingle(id) {
  const { registry } = probesModule.getState();
  const registryById = new Map(registry.map((p) => [p.id, p]));
  await probesModule.runProbes([id], { registryById });
}

async function runAll() {
  const { registry } = probesModule.getState();
  const registryById = new Map(registry.map((p) => [p.id, p]));
  await probesModule.runProbes(registry.map((p) => p.id), { registryById });
}

async function runUnrun() {
  const { registry, results } = probesModule.getState();
  const latest = latestResultsByProbe(results);
  const unrun = registry.filter((p) => !latest.has(p.id)).map((p) => p.id);
  const registryById = new Map(registry.map((p) => [p.id, p]));
  await probesModule.runProbes(unrun, { registryById });
}

let eventsCursor = 0;
let allEvents = [];
let pollTimer = null;

function renderEventLog() {
  const container = document.getElementById('event-log');
  clear(container);
  if (!allEvents.length) {
    container.appendChild(emptyState('No webhook events received yet.'));
    return;
  }
  for (const evt of allEvents) {
    const row = el('div', { class: 'event-row' }, [
      el('div', { class: 'event-row__type' }, evt.event),
      el('div', { class: 'event-row__time mono' }, new Date(evt.received_at * 1000).toLocaleString()),
      el('div', { class: `sig-indicator ${evt.signature_valid ? 'sig-indicator--valid' : 'sig-indicator--invalid'}` },
        evt.signature_valid ? 'Signature valid' : 'Signature invalid'),
    ]);
    const details = el('details', { class: 'disclosure' }, [
      el('summary', null, 'Raw event'),
      jsonViewer(evt.raw),
    ]);
    const wrap = el('div', null, [row, details]);
    container.appendChild(wrap);
  }
}

async function pollEvents() {
  const result = await api.getEvents(eventsCursor);
  if (result.kind === 'not_implemented') {
    document.getElementById('event-log-section').hidden = true;
    stopPolling();
    return;
  }
  if (result.kind === 'ok') {
    const { events, server_time } = result.data;
    if (events && events.length) {
      allEvents = [...events, ...allEvents];
      renderEventLog();
    }
    eventsCursor = server_time || eventsCursor;
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollEvents, 4000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function initEvents() {
  await pollEvents();
  if (!document.getElementById('event-log-section').hidden) {
    renderEventLog();
    if (!document.hidden) startPolling();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopPolling();
      else startPolling();
    });
  }
}

function wireExport() {
  const mdBtn = document.getElementById('export-md-btn');
  const jsonBtn = document.getElementById('export-json-btn');
  const note = document.getElementById('export-disabled-note');
  if (isFixtureMode()) {
    mdBtn.disabled = true;
    jsonBtn.disabled = true;
    note.hidden = false;
    note.textContent = 'Export is disabled while fixtures are active.';
    return;
  }
  mdBtn.addEventListener('click', () => {
    const { registry, results } = probesModule.getState();
    exportMarkdown({ mode: currentConfig.mode, ledgerRows: buildLedger(results), registry, results });
  });
  jsonBtn.addEventListener('click', () => {
    exportJson({ results: probesModule.getState().results });
  });
}

function wireProbeControls() {
  document.getElementById('run-all-btn').addEventListener('click', runAll);
  document.getElementById('run-unrun-btn').addEventListener('click', runUnrun);
  document.getElementById('verdict-filter').addEventListener('change', applyFilter);
}

async function init() {
  if (isFixtureMode()) mountFixturesBadge();

  const configResult = await loadConfig();
  if (configResult.kind !== 'ok') {
    renderBlockingPanel(configResult);
    return;
  }
  currentConfig = configResult.data;
  if (currentConfig.mode === 'live') mountLiveBanner();

  document.getElementById('bench-main').hidden = false;
  initLedger();
  wireProbeControls();
  wireExport();

  probesModule.subscribe((state) => {
    updateLedger(state.results);
    renderProbeGroups();
    const runAllBtn = document.getElementById('run-all-btn');
    const runUnrunBtn = document.getElementById('run-unrun-btn');
    runAllBtn.disabled = state.running;
    runUnrunBtn.disabled = state.running;
    const progress = document.getElementById('run-progress');
    progress.textContent = state.running && state.currentlyRunning ? `Running ${state.currentlyRunning}…` : '';
  });

  await Promise.all([probesModule.loadRegistry(), probesModule.loadResults()]);
  await initEvents();
}

init();
