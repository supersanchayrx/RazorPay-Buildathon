const FIXTURE_CONFIG = {
  key_id: 'FIXTURE_KEY_ID',
  mode: 'test',
  currency: 'INR',
  merchant_name: 'Ordinary Goods Co.',
  backend_version: 'fixtures-0.0.0',
};

const FIXTURE_ORDER = {
  order_id: 'order_FiXTUREp1a1',
  amount: 24900,
  currency: 'INR',
  receipt: 'rcpt_fixture_0001',
  status: 'created',
};

const PROBES = [
  {
    id: 'P1',
    title: 'Create a standard order',
    claim_id: 'C1',
    razorpay_call: 'POST /v1/orders',
    question: 'Can a plain test-mode account create a standard order through the API?',
    expectation: 'reachable',
    requires: [],
    destructive: true,
  },
  {
    id: 'P2',
    title: 'Fetch the order back by ID',
    claim_id: 'C1',
    razorpay_call: 'GET /v1/orders/{id}',
    question: 'Does the order created by P1 read back cleanly, confirming the create-then-read cycle works?',
    expectation: 'reachable',
    requires: ['P1'],
    destructive: false,
  },
  {
    id: 'P3',
    title: 'Create a customer',
    claim_id: 'C2',
    razorpay_call: 'POST /v1/customers',
    question: 'Can the account create a customer object to attach a mandate token to?',
    expectation: 'reachable',
    requires: [],
    destructive: true,
  },
  {
    id: 'P4',
    title: 'Mandate order with token object',
    claim_id: 'C2',
    razorpay_call: 'POST /v1/orders',
    question: 'Is the Reserve Pay substitute — an order carrying a token object (max_amount, expire_at, frequency) — reachable on a plain test account?',
    expectation: 'gated',
    requires: ['P3'],
    destructive: true,
  },
  {
    id: 'P5',
    title: 'Create a UPI payment server-to-server',
    claim_id: 'C3',
    razorpay_call: 'POST /v1/payments/create/upi',
    question: 'Can the account create a UPI payment directly from the server, without a PCI-DSS-scoped checkout surface?',
    expectation: 'unknown',
    requires: [],
    destructive: true,
  },
  {
    id: 'P6',
    title: 'Confirm the server-to-server UPI payment',
    claim_id: 'C3',
    razorpay_call: 'GET /v1/payments/{id}',
    question: 'Does the payment created by P5 reach a confirmable state?',
    expectation: 'unknown',
    requires: ['P5'],
    destructive: false,
  },
  {
    id: 'P7',
    title: 'IIN lookup',
    claim_id: 'C4',
    razorpay_call: 'GET /v1/iins/{iin}',
    question: 'Does the IIN lookup return usable pre-flight authentication data for a card BIN?',
    expectation: 'reachable',
    requires: [],
    destructive: false,
  },
  {
    id: 'P8',
    title: 'Create a payment link',
    claim_id: 'C5',
    razorpay_call: 'POST /v1/payment_links',
    question: 'Can the account generate a Payment Link as a fallback when direct checkout is not viable?',
    expectation: 'reachable',
    requires: [],
    destructive: true,
  },
  {
    id: 'P10',
    title: 'UPI Reserve Pay',
    claim_id: 'C6',
    razorpay_call: 'POST /v1/payments/create/upi',
    question: 'Is there any self-serve surface for UPI Reserve Pay on a plain test account?',
    expectation: 'deprecated',
    requires: [],
    destructive: true,
  },
];

function resultTemplate(id) {
  switch (id) {
    case 'P1':
      return {
        probe_id: 'P1',
        duration_ms: 380,
        request: {
          method: 'POST',
          path: '/v1/orders',
          body: JSON.stringify({ amount: 24900, currency: 'INR', receipt: 'rcpt_bench_p1' }),
        },
        response: {
          http_status: 200,
          body: JSON.stringify({
            id: 'order_FiXTUREp1a1', entity: 'order', amount: 24900, currency: 'INR',
            receipt: 'rcpt_bench_p1', status: 'created', attempts: 0, created_at: 1730291800,
          }),
        },
        razorpay_error: null,
        verdict: 'reachable',
        notes: null,
      };
    case 'P2':
      return {
        probe_id: 'P2',
        duration_ms: 210,
        request: { method: 'GET', path: '/v1/orders/order_FiXTUREp1a1', body: null },
        response: {
          http_status: 200,
          body: JSON.stringify({
            id: 'order_FiXTUREp1a1', entity: 'order', amount: 24900, currency: 'INR',
            status: 'created', attempts: 0, created_at: 1730291800,
          }),
        },
        razorpay_error: null,
        verdict: 'reachable',
        notes: null,
      };
    case 'P3':
      return {
        probe_id: 'P3',
        duration_ms: 340,
        request: {
          method: 'POST',
          path: '/v1/customers',
          body: JSON.stringify({ name: 'Bench Test Customer', email: 'bench.customer@example.com' }),
        },
        response: {
          http_status: 200,
          body: JSON.stringify({
            id: 'cust_FiXTUREc001', entity: 'customer', name: 'Bench Test Customer',
            email: 'bench.customer@example.com', contact: null, created_at: 1730291805,
          }),
        },
        razorpay_error: null,
        verdict: 'reachable',
        notes: null,
      };
    case 'P4':
      return {
        probe_id: 'P4',
        duration_ms: 412,
        request: {
          method: 'POST',
          path: '/v1/orders',
          body: JSON.stringify({
            amount: 100, currency: 'INR', customer_id: 'cust_FiXTUREc001', method: 'upi',
            token: { max_amount: 50000, expire_at: 1732969800, frequency: 'monthly' },
          }),
        },
        response: {
          http_status: 400,
          body: JSON.stringify({
            error: {
              code: 'BAD_REQUEST_ERROR',
              description: 'Recurring payments are not enabled for this merchant',
              source: 'business', step: 'payment_initiation', reason: 'input_validation_failed',
            },
          }),
        },
        razorpay_error: {
          code: 'BAD_REQUEST_ERROR',
          description: 'Recurring payments are not enabled for this merchant',
          source: 'business', step: 'payment_initiation', reason: 'input_validation_failed',
        },
        verdict: 'gated',
        notes: null,
      };
    case 'P5':
      return {
        probe_id: 'P5',
        duration_ms: 5040,
        request: {
          method: 'POST',
          path: '/v1/payments/create/upi',
          body: JSON.stringify({ amount: 100, currency: 'INR', email: 'bench.customer@example.com', contact: '9999999999', vpa: 'success@razorpay' }),
        },
        response: {
          http_status: 500,
          body: JSON.stringify({
            error: {
              code: 'SERVER_ERROR',
              description: 'Something went wrong. We are looking into it as we speak. In case of any payment related queries, please reach out to us at settlements@razorpay.com',
              source: null, step: null, reason: null,
            },
          }),
        },
        razorpay_error: {
          code: 'SERVER_ERROR',
          description: 'Something went wrong. We are looking into it as we speak. In case of any payment related queries, please reach out to us at settlements@razorpay.com',
          source: null, step: null, reason: null,
        },
        verdict: 'error',
        notes: 'Timed out waiting on the gateway; treated as inconclusive rather than gated.',
      };
    case 'P6':
      return {
        probe_id: 'P6',
        duration_ms: 190,
        request: { method: 'GET', path: '/v1/payments/pay_FiXTUREp6a1', body: null },
        response: {
          http_status: 200,
          body: JSON.stringify({ id: 'pay_FiXTUREp6a1', entity: 'payment', status: 'captured', method: 'upi', amount: 100 }),
        },
        razorpay_error: null,
        verdict: 'reachable',
        notes: null,
      };
    case 'P7':
      return {
        probe_id: 'P7',
        duration_ms: 165,
        request: { method: 'GET', path: '/v1/iins/411111', body: null },
        response: {
          http_status: 200,
          body: JSON.stringify({
            iin: '411111', network: 'Visa', type: 'credit', issuer_name: 'HDFC Bank Ltd',
            international: false, recurring: { available: true },
            authentication_types: [{ type: '3ds' }, { type: 'otp' }],
          }),
        },
        razorpay_error: null,
        verdict: 'reachable',
        notes: null,
      };
    case 'P8':
      return {
        probe_id: 'P8',
        duration_ms: 298,
        request: {
          method: 'POST',
          path: '/v1/payment_links',
          body: JSON.stringify({ amount: 24900, description: 'Fallback for order_FiXTUREp1a1' }),
        },
        response: {
          http_status: 200,
          body: JSON.stringify({
            id: 'plink_FiXTUREl001', entity: 'payment_link', short_url: 'https://rzp.io/i/fixtureLink',
            status: 'created', amount: 24900, currency: 'INR',
          }),
        },
        razorpay_error: null,
        verdict: 'reachable',
        notes: null,
      };
    case 'P10':
      return {
        probe_id: 'P10',
        duration_ms: 224,
        request: {
          method: 'POST',
          path: '/v1/payments/create/upi',
          body: JSON.stringify({ amount: 100, currency: 'INR', flow: 'reserve' }),
        },
        response: {
          http_status: 404,
          body: JSON.stringify({
            error: { code: 'BAD_REQUEST_ERROR', description: 'The api you are trying to access does not exist', source: 'business', step: null, reason: null },
          }),
        },
        razorpay_error: {
          code: 'BAD_REQUEST_ERROR', description: 'The api you are trying to access does not exist', source: 'business', step: null, reason: null,
        },
        verdict: 'deprecated',
        notes: null,
      };
    default:
      return null;
  }
}

const now = Date.now();
function isoAt(offsetMinutesAgo) {
  return new Date(now - offsetMinutesAgo * 60000).toISOString();
}

const resultsLog = [
  { ...resultTemplate('P10'), ran_at: isoAt(2) },
  { ...resultTemplate('P8'), ran_at: isoAt(5) },
  { ...resultTemplate('P7'), ran_at: isoAt(9) },
  { ...resultTemplate('P5'), ran_at: isoAt(14) },
  { ...resultTemplate('P4'), ran_at: isoAt(20) },
  { ...resultTemplate('P3'), ran_at: isoAt(21) },
  { ...resultTemplate('P2'), ran_at: isoAt(30) },
  { ...resultTemplate('P1'), ran_at: isoAt(31) },
];

const IIN_TABLE = {
  '411111': {
    iin: '411111', network: 'Visa', type: 'credit', issuer_name: 'HDFC Bank Ltd',
    international: false, recurring: { available: true },
    authentication_types: [{ type: '3ds' }, { type: 'otp' }],
  },
  '607384': {
    iin: '607384', network: 'RuPay', type: 'debit', issuer_name: 'State Bank of India',
    international: false, recurring: { available: false },
    authentication_types: [{ type: 'otp' }],
  },
};

function jsonRaw(value) {
  return JSON.stringify(value);
}

export function fixtureHandle(method, path, body) {
  const [routePath] = path.split('?');

  if (method === 'GET' && routePath === '/api/config') {
    return { kind: 'ok', status: 200, data: FIXTURE_CONFIG, raw: jsonRaw(FIXTURE_CONFIG) };
  }

  if (method === 'POST' && routePath === '/api/orders') {
    return { kind: 'ok', status: 200, data: FIXTURE_ORDER, raw: jsonRaw(FIXTURE_ORDER) };
  }

  if (method === 'POST' && routePath === '/api/payments/verify') {
    const verified = body && body.razorpay_payment_id !== 'pay_FIXTUREBADSIG001';
    const payment = {
      id: body ? body.razorpay_payment_id : 'pay_FIXTURE00000001',
      amount: 24900,
      currency: 'INR',
      status: verified ? 'captured' : 'failed',
      method: 'upi',
      vpa: 'success@razorpay',
      created_at: Math.floor(Date.now() / 1000),
    };
    const data = { verified, payment, raw: jsonRaw(payment) };
    return { kind: 'ok', status: 200, data, raw: jsonRaw(data) };
  }

  if (method === 'GET' && routePath === '/api/probes') {
    const data = { probes: PROBES };
    return { kind: 'ok', status: 200, data, raw: jsonRaw(data) };
  }

  if (method === 'POST' && routePath === '/api/probes/run') {
    const ids = (body && body.probe_ids) || [];
    const runAt = new Date().toISOString();
    const results = ids.map((id) => ({ ...resultTemplate(id), ran_at: runAt })).filter(Boolean);
    results.forEach((r) => resultsLog.unshift(r));
    const data = { results };
    return { kind: 'ok', status: 200, data, raw: jsonRaw(data) };
  }

  if (method === 'GET' && routePath === '/api/probes/results') {
    const data = { results: resultsLog };
    return { kind: 'ok', status: 200, data, raw: jsonRaw(data) };
  }

  if (method === 'POST' && routePath === '/api/payment-links') {
    return { kind: 'not_implemented', path: routePath };
  }

  if (method === 'GET' && routePath.startsWith('/api/iin/')) {
    const iin = routePath.slice('/api/iin/'.length);
    const found = IIN_TABLE[iin];
    if (!found) {
      const errorBody = {
        error: { code: 'BAD_REQUEST_ERROR', description: 'IIN not found', source: 'business', step: null, reason: null },
      };
      return { kind: 'api_error', status: 400, error: errorBody.error, raw: jsonRaw(errorBody) };
    }
    const data = { ...found, raw: jsonRaw(found) };
    return { kind: 'ok', status: 200, data, raw: jsonRaw(data) };
  }

  if (method === 'GET' && routePath === '/api/events') {
    const data = { events: [], server_time: Math.floor(Date.now() / 1000) };
    return { kind: 'ok', status: 200, data, raw: jsonRaw(data) };
  }

  return { kind: 'not_implemented', path: routePath };
}
