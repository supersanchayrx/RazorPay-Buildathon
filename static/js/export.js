import { latestResultsByProbe } from './ledger.js';

function download(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCell(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function buildMarkdownReport({ mode, ledgerRows, registry, results }) {
  const latest = latestResultsByProbe(results);
  const lines = [];
  lines.push('# Razorpay agentic-payments bench report');
  lines.push('');
  lines.push(`- Run at: ${new Date().toISOString()}`);
  lines.push(`- Account mode: ${mode}`);
  lines.push('');
  lines.push('## Claim ledger');
  lines.push('');
  lines.push('| Claim | Text | State | Fed by |');
  lines.push('|---|---|---|---|');
  for (const row of ledgerRows) {
    lines.push(`| ${row.claim.id} | ${escapeCell(row.claim.text)} | ${row.state} | ${row.claim.probeIds.join(', ')} |`);
  }
  lines.push('');
  lines.push('## Probes');
  for (const probe of registry) {
    const r = latest.get(probe.id);
    lines.push('');
    lines.push(`### ${probe.id} — ${escapeCell(probe.title)}`);
    lines.push('');
    lines.push(`- Feeds: ${probe.claim_id}`);
    lines.push(`- Razorpay call: \`${probe.razorpay_call}\``);
    lines.push(`- Question: ${probe.question}`);
    lines.push(`- Predicted (expectation): ${probe.expectation}`);
    lines.push(`- Actual verdict: ${r ? r.verdict : 'not yet run'}`);
    if (r) {
      lines.push(`- Ran at: ${r.ran_at}`);
      lines.push(`- HTTP status: ${r.response ? r.response.http_status : 'n/a'}`);
      if (r.razorpay_error && r.razorpay_error.description) {
        lines.push(`- Error description: ${r.razorpay_error.description}`);
      }
      if (r.notes) {
        lines.push(`- Notes: ${r.notes}`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function exportMarkdown(state) {
  download('bench-report.md', buildMarkdownReport(state), 'text/markdown');
}

export function exportJson({ results }) {
  download('bench-results.json', JSON.stringify({ results }, null, 2), 'application/json');
}
