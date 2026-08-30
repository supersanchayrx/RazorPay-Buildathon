import { fixtureHandle } from './fixtures.js';

export function isFixtureMode() {
  return new URLSearchParams(location.search).get('fixtures') === '1';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method, path, body) {
  if (isFixtureMode()) {
    await delay(200 + Math.random() * 400);
    return fixtureHandle(method, path, body);
  }

  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    return { kind: 'network_error', message: networkErr.message };
  }

  if (res.status === 404) {
    return { kind: 'not_implemented', path };
  }

  let raw = '';
  let json = null;
  try {
    raw = await res.text();
    json = raw ? JSON.parse(raw) : null;
  } catch (parseErr) {
    return { kind: 'network_error', message: 'The backend returned a response that could not be parsed as JSON.', raw };
  }

  if (!res.ok) {
    return { kind: 'api_error', status: res.status, error: json && json.error ? json.error : null, raw };
  }

  return { kind: 'ok', status: res.status, data: json, raw };
}

export const api = {
  getConfig: () => request('GET', '/api/config'),
  createOrder: (sku, quantity) => request('POST', '/api/orders', { sku, quantity }),
  verifyPayment: (payload) => request('POST', '/api/payments/verify', payload),
  getProbes: () => request('GET', '/api/probes'),
  runProbes: (probeIds) => request('POST', '/api/probes/run', { probe_ids: probeIds }),
  getProbeResults: () => request('GET', '/api/probes/results'),
  createPaymentLink: (amount, description) => request('POST', '/api/payment-links', { amount, description }),
  getIin: (iin) => request('GET', `/api/iin/${iin}`),
  getEvents: (since) => request('GET', `/api/events?since=${since}`),
};
