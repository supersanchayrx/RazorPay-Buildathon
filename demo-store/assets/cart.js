// Cart and checkout for the demo storefront.
//
// THE CART CANNOT HOLD A PRICE.
//
// Every line here is {handle, sku, qty} and nothing more. There is no field to
// put a price in, so there is no number for a tampered client to send and no
// number for the server to be tempted to trust. Every total shown to the
// shopper is fetched from Monsoon Market's own server, which reads it from the
// catalogue. Checkout works before CHAPMAN is installed; CHAPMAN only receives
// optional recovery events after its embed is added.
//
// That is not caution about our own code — it is the oldest bug in
// e-commerce, and the insecure version is the one that is easier to write and
// looks identical when you test it honestly.
(function () {
  var KEY = "np_cart_v1";

  // Checkout belongs to this merchant storefront. The Chapman tag, when the
  // merchant adds one later, is used only for optional recovery beacons.
  var tag = document.querySelector('script[src*="/embed.js"]');
  var CHAPMAN_BASE = tag ? tag.src.replace(/\/embed\.js.*$/, "") : "";
  var SITE = tag ? tag.getAttribute("data-site") : "";

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }
  function write(items) {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch (e) {}
    paintCount();
    capture(items);
  }

  /* ---------- basket capture: the merchant's half of recovery ----------
   *
   * Tell the gateway what is in the basket, so a basket that is never checked
   * out can be recovered later. Three things this deliberately does NOT do:
   *
   *   - it does not send a price. Every line is {handle, sku, qty}, the same
   *     shape the checkout uses, so there is no number here for the server to
   *     be tempted to trust.
   *   - it does not send a phone number or an email. Who this is comes from
   *     the signed session token the merchant already puts on the page; how to
   *     reach them is looked up server-to-server from the merchant's own
   *     records. A page cannot nominate somebody else's handset.
   *   - it does not block or warn. A shop whose cart flickers because a
   *     background beacon was slow has been made worse by a feature the
   *     shopper cannot see, so every failure here is swallowed.
   *
   * REF is this browser's own handle for its basket. The gateway hashes it
   * with the site key before storing, so the id in their files is not a value
   * this page can also read.
   */
  var REF_KEY = "np_cart_ref_v1";

  function ref() {
    try {
      var v = localStorage.getItem(REF_KEY);
      if (v) return v;
      v = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
      localStorage.setItem(REF_KEY, v);
      return v;
    } catch (e) {
      return "";
    }
  }

  var captureTimer = null;

  function beacon(op, lines) {
    var r = ref();
    if (!CHAPMAN_BASE || !SITE || !r) return;
    var payload = { site: SITE, ref: r, op: op, lines: lines || [] };
    if (window.CHAPMAN_SESSION) payload.session = window.CHAPMAN_SESSION;
    try {
      fetch(CHAPMAN_BASE + "/embed/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  // Debounced, because a shopper nudging a quantity from 1 to 4 is one basket
  // and not four. The last state within the window is the one that matters.
  function capture(items) {
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = setTimeout(function () {
      beacon("capture", items);
    }, 800);
  }
  function count() {
    return read().reduce(function (n, l) {
      return n + l.qty;
    }, 0);
  }

  function add(handle, sku, qty) {
    var items = read();
    var hit = items.filter(function (l) {
      return l.handle === handle && l.sku === sku;
    })[0];
    if (hit) hit.qty += qty || 1;
    else items.push({ handle: handle, sku: sku, qty: qty || 1 });
    write(items);
    open();
  }

  function setQty(handle, sku, qty) {
    var items = read()
      .map(function (l) {
        if (l.handle === handle && l.sku === sku) l.qty = qty;
        return l;
      })
      .filter(function (l) {
        return l.qty > 0;
      });
    write(items);
    refresh();
  }

  function post(op, extra) {
    var payload = { op: op, items: read() };
    for (var k in extra || {}) payload[k] = extra[k];
    return fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (j) {
        return { status: r.status, body: j };
      });
    });
  }

  /* ---------- UI ---------- */

  var panel, body, btn, badge;

  function build() {
    btn = document.createElement("button");
    btn.className = "np-cart-btn";
    btn.type = "button";
    btn.innerHTML = 'Cart <span class="np-badge">0</span>';
    btn.addEventListener("click", open);
    document.body.appendChild(btn);
    badge = btn.querySelector(".np-badge");

    panel = document.createElement("div");
    panel.className = "np-cart";
    panel.hidden = true;
    panel.innerHTML =
      '<div class="np-cart-head"><b>Your cart</b>' +
      '<button type="button" class="np-x" aria-label="Close">×</button></div>' +
      '<div class="np-cart-body"></div>';
    document.body.appendChild(panel);
    body = panel.querySelector(".np-cart-body");
    panel.querySelector(".np-x").addEventListener("click", function () {
      panel.hidden = true;
    });
    paintCount();
  }

  function paintCount() {
    if (badge) badge.textContent = String(count());
    if (btn) btn.dataset.empty = count() === 0 ? "1" : "0";
  }

  function open() {
    if (!panel) return;
    panel.hidden = false;
    refresh();
  }

  function money(n) {
    return "₹" + Number(n).toLocaleString("en-IN");
  }

  function refresh() {
    if (read().length === 0) {
      body.innerHTML = '<p class="np-empty">Nothing in the cart yet.</p>';
      return;
    }
    body.innerHTML = '<p class="np-empty">Pricing…</p>';

    post("quote").then(function (res) {
      if (!res.body.ok) {
        // Problems come back per line and in plain language, including the real
        // remaining stock — the same grounded number the assistant is allowed
        // to quote.
        body.innerHTML =
          '<div class="np-problems">' +
          (res.body.problems || [{ message: res.body.error || "Could not price the cart." }])
            .map(function (p) {
              return "<p>" + p.message + "</p>";
            })
            .join("") +
          "</div>" +
          '<button type="button" class="np-clear">Clear cart</button>';
        body.querySelector(".np-clear").addEventListener("click", function () {
          write([]);
          refresh();
        });
        return;
      }

      var q = res.body.quote;
      body.innerHTML =
        '<table class="np-lines">' +
        q.lines
          .map(function (l) {
            return (
              "<tr><td>" +
              l.title +
              '<span class="np-var">' +
              l.variantTitle +
              "</span></td>" +
              '<td class="np-qty">' +
              '<button type="button" data-h="' + l.handle + '" data-s="' + l.sku + '" data-q="' + (l.qty - 1) + '">−</button>' +
              "<span>" + l.qty + "</span>" +
              '<button type="button" data-h="' + l.handle + '" data-s="' + l.sku + '" data-q="' + (l.qty + 1) + '">+</button>' +
              "</td>" +
              '<td class="np-amt">' + money(l.lineTotal) + "</td></tr>"
            );
          })
          .join("") +
        "</table>" +
        '<div class="np-tot"><span>Subtotal</span><span>' + money(q.subtotal) + "</span></div>" +
        '<div class="np-tot"><span>Shipping</span><span>' +
        (q.shipping === 0 ? "Free" : money(q.shipping)) +
        "</span></div>" +
        '<div class="np-tot np-grand"><span>Total</span><span>' + money(q.total) + "</span></div>" +
        '<button type="button" class="np-pay">Pay ' + money(q.total) + "</button>" +
        '<p class="np-note">Priced by the server from the live catalogue. Test mode — no real money moves.</p>';

      [].forEach.call(body.querySelectorAll(".np-qty button"), function (b) {
        b.addEventListener("click", function () {
          setQty(b.dataset.h, b.dataset.s, Number(b.dataset.q));
        });
      });
      body.querySelector(".np-pay").addEventListener("click", pay);
    });
  }

  function pay() {
    var payBtn = body.querySelector(".np-pay");
    payBtn.disabled = true;
    payBtn.textContent = "Preparing…";

    // The server re-prices from the catalogue here and ignores anything the
    // page is holding, so the amount Razorpay is asked for is never one this
    // browser chose.
    post("start").then(function (res) {
      if (!res.body.ok) {
        body.innerHTML = "";
        var problem = document.createElement("div");
        problem.className = "np-problems";
        var message = document.createElement("p");
        message.textContent = res.body.error || "Could not start test checkout.";
        problem.appendChild(message);
        body.appendChild(problem);
        var retry = document.createElement("button");
        retry.type = "button";
        retry.className = "np-clear";
        retry.textContent = "Back to cart";
        retry.addEventListener("click", refresh);
        body.appendChild(retry);
        return;
      }
      var d = res.body;
      var rz = new window.Razorpay({
        key: d.keyId,
        order_id: d.orderId,
        amount: d.amount,
        currency: d.currency,
        name: "Monsoon Market",
        description: d.quote.lines.length + " item(s)",
        prefill: window.NP_CUSTOMER ? { name: window.NP_CUSTOMER } : {},
        theme: { color: "#1f4037" },
        handler: function (r) {
          // Success here means the BROWSER thinks it paid. Nothing is treated
          // as bought until the server has verified the signature and read the
          // payment back from Razorpay.
          body.innerHTML = '<p class="np-empty">Confirming…</p>';
          post("confirm", {
            razorpay_order_id: r.razorpay_order_id,
            razorpay_payment_id: r.razorpay_payment_id,
            razorpay_signature: r.razorpay_signature
          }).then(function (c) {
            if (c.body.ok) {
              // Tell the gateway before the basket is cleared, so recovery
              // never chases somebody for a thing already in their hallway.
              beacon("recovered", []);
              write([]);
              body.innerHTML =
                '<div class="np-done"><b>Payment confirmed</b>' +
                "<p>" + money(c.body.amount) + " · " + c.body.status + "</p>" +
                '<p class="np-note">' + c.body.paymentId + "</p>" +
                '<p class="np-note">Verified server-side against Razorpay, not taken from this page.</p></div>';
            } else {
              body.innerHTML =
                '<div class="np-problems"><p>' +
                (c.body.error || "That payment could not be verified.") +
                "</p></div>";
            }
          });
        },
        modal: {
          ondismiss: function () {
            refresh();
          }
        }
      });
      rz.on("payment.failed", function (e) {
        body.innerHTML =
          '<div class="np-problems"><p>Payment failed: ' +
          (e.error && e.error.description ? e.error.description : "unknown reason") +
          "</p></div>";
      });
      rz.open();
    });
  }

  /* ---------- wire the product page ---------- */

  function wireBuyButton() {
    document.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".buy") : null;
      if (!b || b.disabled) return;
      var handle = new URLSearchParams(location.search).get("handle");
      var pressed = document.querySelector('.variant[aria-pressed="true"]');
      var sku = pressed ? pressed.dataset.sku : null;
      if (handle) add(handle, sku || undefined, 1);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      build();
      wireBuyButton();
      restore();
    });
  } else {
    build();
    wireBuyButton();
    restore();
  }

  /* ---------- restore: the other end of a recovery message ----------
   *
   * A recovery message can now point at a basket rather than at a product
   * page. `/restore` on the merchant's own origin asks the gateway what was in
   * it, hands back {handle, sku, qty} — never a price — and this puts it back.
   *
   * Merging rather than replacing: somebody who has started a new basket since
   * should not have it wiped by following a link about an old one.
   */
  function restore() {
    var m = /[?&]restore=([^&]+)/.exec(window.location.search);
    if (!m) return;
    fetch("/restore/" + encodeURIComponent(m[1]), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.lines || !j.lines.length) return;
        var items = read();
        j.lines.forEach(function (l) {
          var hit = items.filter(function (x) {
            return x.handle === l.handle && x.sku === l.sku;
          })[0];
          if (hit) hit.qty = Math.max(hit.qty, l.qty);
          else items.push({ handle: l.handle, sku: l.sku, qty: l.qty });
        });
        write(items);
        open();
      })
      .catch(function () {});
  }

  window.NP_CART = { add: add, open: open, read: read, clear: function () { write([]); } };
})();
