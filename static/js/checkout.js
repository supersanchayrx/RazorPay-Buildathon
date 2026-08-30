import { el, clear } from './render.js';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let scriptPromise = null;
let checkoutOpen = false;

function loadRazorpayScript() {
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load checkout.razorpay.com/v1/checkout.js'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function isCheckoutOpen() {
  return checkoutOpen;
}

function randSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

function renderSimulatedCheckout(container, order, callbacks) {
  clear(container);
  const panel = el('div', { class: 'simulated-checkout' }, [
    el('h3', null, 'Simulated checkout — fixtures mode'),
    el('p', { class: 'muted', style: 'margin-bottom: 12px; font-size: 0.85rem;' },
      'No real Razorpay Checkout is opened while fixtures are active. Pick an outcome to exercise.'),
    el('div', { class: 'simulated-checkout__actions' }, [
      el('button', {
        type: 'button',
        onclick: () => callbacks.onSuccess({
          razorpay_payment_id: `pay_FIXTURE${randSuffix()}`,
          razorpay_order_id: order.order_id,
          razorpay_signature: `fixturesig${randSuffix()}`,
        }),
      }, 'Simulate success'),
      el('button', {
        type: 'button',
        onclick: () => callbacks.onSuccess({
          razorpay_payment_id: 'pay_FIXTUREBADSIG001',
          razorpay_order_id: order.order_id,
          razorpay_signature: `fixturesig${randSuffix()}`,
        }),
      }, 'Simulate success (bad signature)'),
      el('button', {
        type: 'button',
        onclick: () => callbacks.onFailure({
          code: 'BAD_REQUEST_ERROR',
          description: 'The payment was declined by the bank.',
          source: 'customer',
          step: 'payment_authentication',
          reason: 'payment_declined',
          metadata: { order_id: order.order_id, payment_id: `pay_FIXTUREfail${randSuffix()}` },
        }),
      }, 'Simulate payment failure'),
      el('button', { type: 'button', onclick: () => callbacks.onDismiss() }, 'Simulate abandon'),
    ]),
  ]);
  container.appendChild(panel);
}

export function startCheckout({ container, order, config, requestId, fixtureMode, callbacks }) {
  if (checkoutOpen) return;
  checkoutOpen = true;

  if (fixtureMode) {
    renderSimulatedCheckout(container, order, {
      onSuccess: (response) => { checkoutOpen = false; clear(container); callbacks.onSuccess(response); },
      onFailure: (error) => { checkoutOpen = false; clear(container); callbacks.onFailure(error); },
      onDismiss: () => { checkoutOpen = false; clear(container); callbacks.onDismiss(); },
    });
    return;
  }

  loadRazorpayScript()
    .then(() => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--store-accent').trim() || '#1F7A4D';
      const options = {
        key: config.key_id,
        amount: order.amount,
        currency: order.currency,
        name: config.merchant_name,
        description: `Order ${order.order_id}`,
        order_id: order.order_id,
        prefill: { name: '', email: '', contact: '' },
        notes: { internal_request_id: requestId },
        theme: { color: accent },
        handler: (response) => {
          checkoutOpen = false;
          callbacks.onSuccess(response);
        },
        modal: {
          ondismiss: () => {
            checkoutOpen = false;
            callbacks.onDismiss();
          },
        },
      };
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (resp) => {
        checkoutOpen = false;
        callbacks.onFailure(resp.error);
      });
      rzp.open();
    })
    .catch((err) => {
      checkoutOpen = false;
      callbacks.onLoadError(err);
    });
}
