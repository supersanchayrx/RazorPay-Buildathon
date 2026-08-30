export function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value === false || value === null || value === undefined) continue;
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children || [])) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const VERDICT_LABELS = {
  reachable: 'Reachable',
  gated: 'Gated',
  deprecated: 'Deprecated',
  error: 'Error',
  unknown: 'Unknown',
};

export function verdictChip(verdict) {
  const v = verdict || 'unknown';
  return el('span', { class: `chip chip--${v}` }, VERDICT_LABELS[v] || v);
}

const CLAIM_STATE_LABELS = {
  UNTESTED: 'Untested',
  SUPPORTED: 'Supported',
  REFUTED: 'Refuted',
  BLOCKED: 'Blocked',
};

export function claimStateChip(state) {
  return el('span', { class: `chip chip--claim-${state.toLowerCase()}` }, CLAIM_STATE_LABELS[state] || state);
}

export function definitionList(pairs) {
  const dl = el('dl', { class: 'deflist' });
  for (const [term, value] of pairs) {
    if (value === null || value === undefined || value === '') continue;
    dl.appendChild(el('dt', null, term));
    dl.appendChild(el('dd', null, String(value)));
  }
  return dl;
}

export function errorEnvelope(error) {
  if (!error) return el('p', { class: 'muted' }, 'No structured error was returned.');
  const wrap = el('div', { class: 'error-envelope' });
  wrap.appendChild(el('p', { class: 'error-description' }, error.description || 'No description provided.'));
  wrap.appendChild(definitionList([
    ['code', error.code],
    ['source', error.source],
    ['step', error.step],
    ['reason', error.reason],
  ]));
  if (error.metadata && Object.keys(error.metadata).length) {
    wrap.appendChild(jsonViewer(JSON.stringify(error.metadata)));
  }
  return wrap;
}

const JSON_TOKEN_RE = /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g;

function highlightJson(raw) {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(JSON_TOKEN_RE, (match) => {
    let cls = 'jv-number';
    if (/^"/.test(match)) {
      cls = /:$/.test(match) ? 'jv-key' : 'jv-string';
    } else if (/true|false/.test(match)) {
      cls = 'jv-bool';
    } else if (/null/.test(match)) {
      cls = 'jv-null';
    }
    return `<span class="${cls}">${match}</span>`;
  });
}

function tryPretty(raw) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch (e) {
    return raw;
  }
}

export function jsonViewer(raw) {
  const wrap = el('div', { class: 'json-viewer' });
  const pretty = tryPretty(raw ?? '');
  const pre = el('pre', { class: 'json-viewer__pre' });
  pre.innerHTML = highlightJson(pretty);
  const copyBtn = el('button', {
    class: 'json-viewer__copy',
    type: 'button',
    'aria-label': 'Copy raw response',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(raw ?? '');
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
      } catch (e) {
        copyBtn.textContent = 'Copy failed';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
      }
    },
  }, 'Copy');
  wrap.appendChild(copyBtn);
  wrap.appendChild(pre);
  return wrap;
}

export function mountFixturesBadge() {
  document.body.classList.add('fixtures-active');
  document.body.appendChild(el('div', { class: 'fixtures-badge', role: 'status' }, 'FIXTURES'));
}

export function emptyState(message, actionLabel, onAction) {
  const wrap = el('div', { class: 'empty-state' }, el('p', null, message));
  if (actionLabel && onAction) {
    wrap.appendChild(el('button', { type: 'button', class: 'btn btn--secondary', onclick: onAction }, actionLabel));
  }
  return wrap;
}

export function notImplementedState(routeLabel) {
  return el('div', { class: 'empty-state empty-state--not-implemented' }, [
    el('p', null, `This route isn't implemented on the backend yet.`),
    el('p', { class: 'muted mono' }, `Add ${routeLabel} to enable this.`),
  ]);
}

export function networkErrorState(message) {
  return el('div', { class: 'empty-state empty-state--error' }, [
    el('p', null, 'The backend is unreachable.'),
    el('p', { class: 'muted' }, message || ''),
  ]);
}

function drawQrModule(ctx, x, y, size) {
  ctx.fillRect(x * size, y * size, size, size);
}

export function renderQrCode(canvas, text) {
  const matrix = encodeQr(text);
  if (!matrix) return false;
  const n = matrix.length;
  const scale = Math.max(4, Math.floor(240 / n));
  const quiet = 4;
  const pixels = (n + quiet * 2) * scale;
  canvas.width = pixels;
  canvas.height = pixels;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, pixels, pixels);
  ctx.fillStyle = '#000000';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (matrix[y][x]) drawQrModule(ctx, x + quiet, y + quiet, scale);
    }
  }
  return true;
}

// --- Minimal byte-mode QR Code encoder (versions 1-10, EC level M) ---
// Self-contained: no runtime dependency, per the no-third-party-fetch rule for the payment-link QR.

const QR_EC_BLOCKS_M = {
  1: [1, 16, 10], 2: [1, 28, 16], 3: [1, 44, 26], 4: [2, 32, 18], 5: [2, 43, 24],
  6: [4, 27, 16], 7: [4, 31, 18], 8: [2, 38, 22], 9: [3, 36, 22], 10: [4, 43, 26],
};
// [numBlocksInGroup1, dataCodewordsPerBlockGroup1, ecCodewordsPerBlock] — versions 1-10 are single-group at level M.

const QR_TOTAL_CODEWORDS = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346 };
const QR_ALIGNMENT_COORD = { 2: 18, 3: 22, 4: 26, 5: 30, 6: 34, 7: 22, 8: 24, 9: 26, 10: 28 };

function qrGaloisTables() {
  const exp = new Array(512);
  const log = new Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  return { exp, log };
}
const GF = qrGaloisTables();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF.exp[GF.log[a] + GF.log[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], GF.exp[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const res = data.concat(new Array(ecLen).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      res[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return res.slice(data.length);
}

// Byte-mode character-count indicator is 8 bits for versions 1-9, 16 bits from version 10 up.
function charCountBits(version) {
  return version <= 9 ? 8 : 16;
}

function qrPickVersion(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const [numBlocks, dataPerBlock] = QR_EC_BLOCKS_M[v];
    const capacityBits = numBlocks * dataPerBlock * 8;
    const usedBits = 4 + charCountBits(v) + byteLen * 8;
    if (usedBits <= capacityBits) return v;
  }
  return null;
}

function bitsForByteMode(bytes, version, totalDataCodewords) {
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, charCountBits(version));
  for (const b of bytes) push(b, 8);
  const capacityBits = totalDataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const padBytes = [0xec, 0x11];
  let pi = 0;
  while (bits.length < capacityBits) {
    push(padBytes[pi % 2], 8);
    pi++;
  }
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  return codewords;
}

function buildQrMatrix(version, finalCodewords) {
  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));

  function setFinder(row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        const inRing = r >= -1 && r <= 7 && c >= -1 && c <= 7;
        let dark = false;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) dark = isBorder || isCore;
        matrix[rr][cc] = inRing ? (dark ? 1 : 0) : matrix[rr][cc];
      }
    }
  }
  setFinder(0, 0);
  setFinder(0, size - 7);
  setFinder(size - 7, 0);

  for (let i = 0; i < size; i++) {
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0 ? 1 : 0;
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0 ? 1 : 0;
  }

  const align = QR_ALIGNMENT_COORD[version];
  if (align) {
    const centers = [6, align];
    for (const cy of centers) {
      for (const cx of centers) {
        if ((cy === 6 && cx === 6) || (cy === 6 && cx === size - 7) || (cy === size - 7 && cx === 6)) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
            matrix[cy + r][cx + c] = dark ? 1 : 0;
          }
        }
      }
    }
  }

  matrix[size - 8][8] = 1;

  const dataBits = [];
  for (const byte of finalCodewords) {
    for (let i = 7; i >= 0; i--) dataBits.push((byte >> i) & 1);
  }

  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] !== null) reserved[r][c] = true;
    }
  }
  for (let i = 0; i < 9; i++) { reserved[8][i] = true; reserved[i][8] = true; }
  for (let i = 0; i < 8; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }

  let bitIndex = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (!reserved[row][c]) {
          const bit = bitIndex < dataBits.length ? dataBits[bitIndex] : 0;
          bitIndex++;
          const masked = bit ^ ((row + c) % 2 === 0 ? 1 : 0);
          matrix[row][c] = masked;
        }
      }
    }
    upward = !upward;
  }

  const FORMAT_STRINGS_M = [
    0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
  ];
  const formatBits = FORMAT_STRINGS_M[0];
  const fb = [];
  for (let i = 14; i >= 0; i--) fb.push((formatBits >> i) & 1);
  const p1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  for (let i = 0; i < 15; i++) matrix[p1[i][0]][p1[i][1]] = fb[i];
  const p2 = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ];
  for (let i = 0; i < 15; i++) matrix[p2[i][0]][p2[i][1]] = fb[i];

  return matrix;
}

function encodeQr(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = qrPickVersion(bytes.length);
  if (!version) return null;
  const [numBlocks, dataPerBlock, ecPerBlock] = QR_EC_BLOCKS_M[version];
  const totalData = numBlocks * dataPerBlock;
  const dataCodewords = bitsForByteMode(bytes, version, totalData);

  const blocks = [];
  const ecBlocks = [];
  for (let i = 0; i < numBlocks; i++) {
    const block = dataCodewords.slice(i * dataPerBlock, (i + 1) * dataPerBlock);
    blocks.push(block);
    ecBlocks.push(rsRemainder(block, ecPerBlock));
  }

  const finalCodewords = [];
  for (let i = 0; i < dataPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) finalCodewords.push(blocks[b][i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) finalCodewords.push(ecBlocks[b][i]);
  }

  const matrix = buildQrMatrix(version, finalCodewords);
  return matrix.map((row) => row.map((v) => v === 1));
}
