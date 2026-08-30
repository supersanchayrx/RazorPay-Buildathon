import { loadConfig, isFixtureMode } from './config.js';
import { api } from './api.js';
import { formatPaise } from './money.js';
import { startCheckout } from './checkout.js';
import {
  el, clear, definitionList, errorEnvelope, jsonViewer,
  notImplementedState, networkErrorState, renderQrCode, mountFixturesBadge,
} from './render.js';

const SKU = 'chai-001';
const INDICATIVE_PAISE = 24900;
const requestId = `store-${Math.random().toString(36).slice(2, 10)}`;

let currentConfig = null;
let currentOrder = null;

function renderBlockingPanel(result) {
  const mount = document.getElementById('blocking-panel-mount');
  const detail = result.kind === 'not_implemented'
    ? 'Add GET /api/config on the backend to boot the Store.'
    : (result.message || 'The backend could not be reached.');
  mount.appendChild(el('div', { class: 'blocking-panel' }, [
    el('h1', null, 'The backend is unreachable'),
    el('p', null, detail),
  ]));
}

function mountLiveBanner() {
  const banner = el('div', { class: 'store-live-banner' }, 'Live mode — this button charges a real payment method.');
  document.body.insertBefore(banner, document.body.firstChild);
}

async function ensureOrder() {
  if (currentOrder) return { kind: 'ok', data: currentOrder };
  const result = await api.createOrder(SKU, 1);
  if (result.kind === 'ok') {
    currentOrder = result.data;
    document.getElementById('product-price-amount').textContent = formatPaise(currentOrder.amount);
    document.getElementById('product-price-note').textContent = `Order ${currentOrder.order_id} — confirmed by the backend`;
  }
  return result;
}

function renderResultPanel(node) {
  const mount = document.getElementById('result-panel-mount');
  clear(mount);
  if (node) mount.appendChild(node);
}

function pendingPanel() {
  return el('div', { class: 'result-panel' }, [
    el('h3', null, 'Verifying payment…'),
    el('p', { class: 'muted', style: 'font-size:0.85rem;' }, 'Checking the signature with the backend before confirming anything.'),
  ]);
}

function verifiedPanel(payment, verified, raw) {
  const children = [el('h3', null, verified ? 'Payment verified' : 'Verification failed')];
  if (!verified) {
    children.push(el('p', { style: 'font-size:0.85rem; margin-bottom:8px;' },
      'Razorpay reported success, but the backend could not verify the signature. Treat this as unpaid.'));
  }
  children.push(definitionList([
    ['Payment ID', payment.id],
    ['Order ID', currentOrder ? currentOrder.order_id : '—'],
    ['Method', payment.method],
    ['Status', payment.status],
  ]));
  children.push(el('details', { class: 'disclosure' }, [
    el('summary', null, 'Raw payment JSON'),
    jsonViewer(raw),
  ]));
  return el('div', { class: `result-panel${verified ? '' : ' result-panel--failed'}` }, children);
}

function failedPanel(error) {
  return el('div', { class: 'result-panel result-panel--failed' }, [
    el('h3', null, 'Payment failed'),
    errorEnvelope(error),
  ]);
}

function abandonedPanel() {
  return el('div', { class: 'result-panel result-panel--abandoned' }, [
    el('h3', null, 'Checkout abandoned'),
    el('p', { style: 'font-size:0.85rem;' }, 'You closed the checkout before it resolved. Nothing was charged.'),
  ]);
}

function loadFailurePanel(err) {
  return el('div', { class: 'result-panel result-panel--failed' }, [
    el('h3', null, "Checkout couldn't load"),
    el('p', { style: 'font-size:0.85rem; margin-bottom:12px;' }, String((err && err.message) || err)),
    el('p', { class: 'checkout-fallback-note' }, 'Try the payment link fallback below instead.'),
  ]);
}

async function onBuyClick() {
  const buyBtn = document.getElementById('buy-btn');
  buyBtn.disabled = true;
  const orderResult = await ensureOrder();
  if (orderResult.kind !== 'ok') {
    buyBtn.disabled = false;
    if (orderResult.kind === 'not_implemented') {
      renderResultPanel(notImplementedState('POST /api/orders'));
    } else if (orderResult.kind === 'api_error') {
      renderResultPanel(el('div', { class: 'result-panel result-panel--failed' },
        [el('h3', null, 'Could not create an order'), errorEnvelope(orderResult.error)]));
    } else {
      renderResultPanel(networkErrorState(orderResult.message));
    }
    return;
  }

  const container = document.getElementById('checkout-mount');
  startCheckout({
    container,
    order: currentOrder,
    config: currentConfig,
    requestId,
    fixtureMode: isFixtureMode(),
    callbacks: {
      onSuccess: async (response) => {
        renderResultPanel(pendingPanel());
        const verifyResult = await api.verifyPayment({
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_signature: response.razorpay_signature,
        });
        buyBtn.disabled = false;
        if (verifyResult.kind === 'ok') {
          renderResultPanel(verifiedPanel(verifyResult.data.payment, verifyResult.data.verified, verifyResult.data.raw));
        } else if (verifyResult.kind === 'not_implemented') {
          renderResultPanel(notImplementedState('POST /api/payments/verify'));
        } else if (verifyResult.kind === 'api_error') {
          renderResultPanel(el('div', { class: 'result-panel result-panel--failed' },
            [el('h3', null, 'Verification request failed'), errorEnvelope(verifyResult.error)]));
        } else {
          renderResultPanel(networkErrorState(verifyResult.message));
        }
      },
      onFailure: (error) => {
        buyBtn.disabled = false;
        renderResultPanel(failedPanel(error));
      },
      onDismiss: () => {
        buyBtn.disabled = false;
        renderResultPanel(abandonedPanel());
      },
      onLoadError: (err) => {
        buyBtn.disabled = false;
        renderResultPanel(loadFailurePanel(err));
      },
    },
  });
}

async function onPaymentLinkClick() {
  const btn = document.getElementById('payment-link-btn');
  btn.disabled = true;
  const mount = document.getElementById('payment-link-mount');
  clear(mount);

  const orderResult = await ensureOrder();
  const amount = orderResult.kind === 'ok' ? orderResult.data.amount : INDICATIVE_PAISE;
  const description = orderResult.kind === 'ok' ? `Fallback for ${orderResult.data.order_id}` : 'Fallback for indicative order';

  const result = await api.createPaymentLink(amount, description);
  btn.disabled = false;

  if (result.kind === 'not_implemented') {
    mount.appendChild(notImplementedState('POST /api/payment-links'));
    return;
  }
  if (result.kind === 'api_error') {
    mount.appendChild(el('div', { class: 'result-panel result-panel--failed' },
      [el('h3', null, 'Could not create a payment link'), errorEnvelope(result.error)]));
    return;
  }
  if (result.kind === 'network_error') {
    mount.appendChild(networkErrorState(result.message));
    return;
  }

  const { short_url } = result.data;
  const panel = el('div', { class: 'payment-link-panel' });
  panel.appendChild(el('p', { style: 'font-size:0.85rem; margin-bottom:8px;' },
    'Scan or copy this link to finish payment on another device.'));
  const canvas = document.createElement('canvas');
  const ok = renderQrCode(canvas, short_url);
  if (ok) {
    panel.appendChild(canvas);
  } else {
    panel.appendChild(el('p', { class: 'muted', style: 'font-size:0.8rem;' },
      'Link too long to render as a QR code — use the copyable link below.'));
  }
  const urlRow = el('div', { class: 'payment-link-url' }, [
    el('input', { type: 'text', readonly: true, value: short_url, 'aria-label': 'Payment link URL', onclick: (e) => e.target.select() }),
    el('button', {
      type: 'button',
      class: 'btn btn-fallback',
      style: 'width:auto;',
      onclick: async () => {
        try { await navigator.clipboard.writeText(short_url); } catch (e) { /* clipboard unavailable */ }
      },
    }, 'Copy link'),
  ]);
  panel.appendChild(urlRow);
  mount.appendChild(panel);
}

function wireHelperDismiss() {
  document.getElementById('helper-dismiss').addEventListener('click', () => {
    document.getElementById('helper-panel').remove();
  });
}

async function init() {
  if (isFixtureMode()) mountFixturesBadge();
  document.getElementById('product-price-amount').textContent = formatPaise(INDICATIVE_PAISE);

  const configResult = await loadConfig();
  if (configResult.kind !== 'ok') {
    renderBlockingPanel(configResult);
    return;
  }
  currentConfig = configResult.data;
  if (currentConfig.mode === 'live') mountLiveBanner();

  document.getElementById('store-main').hidden = false;
  document.getElementById('buy-btn').addEventListener('click', onBuyClick);
  document.getElementById('payment-link-btn').addEventListener('click', onPaymentLinkClick);
  wireHelperDismiss();
}

init();
