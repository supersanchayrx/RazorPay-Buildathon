// Cart and checkout for the demo storefront.
//
// THE CART CANNOT HOLD A PRICE.
//
// Every line here is {handle, sku, qty} and nothing more. There is no field to
// put a price in, so there is no number for a tampered client to send and no
// number for the server to be tempted to trust. Every total shown to the
// shopper is fetched from CHAPMAN, which reads it from the catalogue.
//
// That is not caution about our own code — it is the oldest bug in
// e-commerce, and the insecure version is the one that is easier to write and
// looks identical when you test it honestly.
(function () {
  var KEY = "np_cart_v1";

  // The gateway URL is already on the page: the embed tag points at it. Reading
  // it back beats a second copy that can drift.
  var tag = document.querySelector('script[src*="/embed.js"]');
  var BASE = tag ? tag.src.replace(/\/embed\.js.*$/, "") : "";
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
    var payload = { site: SITE, op: op, items: read() };
    if (window.CHAPMAN_SESSION) payload.session = window.CHAPMAN_SESSION;
    for (var k in extra || {}) payload[k] = extra[k];
    return fetch(BASE + "/embed/checkout", {
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
        payBtn.disabled = false;
        refresh();
        return;
      }
      var d = res.body;
      var rz = new window.Razorpay({
        key: d.keyId,
        order_id: d.orderId,
        amount: d.amount,
        currency: d.currency,
        name: "Nilgiri Post",
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
    });
  } else {
    build();
    wireBuyButton();
  }

  window.NP_CART = { add: add, open: open, read: read, clear: function () { write([]); } };
})();
