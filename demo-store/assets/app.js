/*
 * Nilgiri Post — demo storefront.
 *
 * Deliberately plain: no framework, no build step. catalog.json is the single
 * source of truth, so when the agent gateway reads this store it reads the
 * same file the pages render from. Nothing is duplicated for the agent.
 */
(function () {
  var money = function (n, cur) {
    return (cur === "INR" ? "₹" : "") + Number(n).toLocaleString("en-IN");
  };

  function load() {
    return fetch("/catalog.json").then(function (r) {
      if (!r.ok) throw new Error("catalog.json failed to load (" + r.status + ")");
      return r.json();
    });
  }

  function priceRange(p, cur) {
    var prices = p.variants.map(function (v) { return v.price; });
    var lo = Math.min.apply(null, prices);
    var hi = Math.max.apply(null, prices);
    return lo === hi ? money(lo, cur) : money(lo, cur) + " – " + money(hi, cur);
  }

  function totalStock(p) {
    return p.variants.reduce(function (a, v) { return a + (v.inventory || 0); }, 0);
  }

  function stockFlag(p) {
    var total = totalStock(p);
    if (total === 0) return '<span class="flag out">Out of stock</span>';
    if (total <= 5) return '<span class="flag low">Only ' + total + " left</span>";
    return "";
  }

  /* ---------------- index ---------------- */

  function renderIndex(data) {
    var grid = document.getElementById("grid");
    var filters = document.getElementById("filters");
    if (!grid) return;

    var types = ["All"].concat(
      data.products
        .map(function (p) { return p.type; })
        .filter(function (t, i, a) { return a.indexOf(t) === i; })
    );

    var active = "All";

    function paint() {
      var list = data.products.filter(function (p) {
        return active === "All" || p.type === active;
      });
      grid.innerHTML = list
        .map(function (p) {
          return (
            '<a class="card" href="/product.html?handle=' + p.handle + '">' +
            '<img src="' + p.image + '" alt="' + p.title + '" loading="lazy">' +
            '<div class="body">' +
            "<h3>" + p.title + "</h3>" +
            '<div class="type">' + p.type + "</div>" +
            '<div class="price">' + priceRange(p, data.shop.currency) +
            " " + stockFlag(p) + "</div>" +
            "</div></a>"
          );
        })
        .join("");
    }

    filters.innerHTML = types
      .map(function (t) {
        return '<button class="chip" aria-pressed="' + (t === active) + '" data-type="' + t + '">' + t + "</button>";
      })
      .join("");

    filters.addEventListener("click", function (e) {
      var btn = e.target.closest(".chip");
      if (!btn) return;
      active = btn.dataset.type;
      [].forEach.call(filters.querySelectorAll(".chip"), function (c) {
        c.setAttribute("aria-pressed", String(c.dataset.type === active));
      });
      paint();
    });

    paint();
  }

  /* ---------------- product ---------------- */

  function renderProduct(data) {
    var root = document.getElementById("product");
    if (!root) return;

    var handle = new URLSearchParams(location.search).get("handle");
    var p = data.products.filter(function (x) { return x.handle === handle; })[0];

    if (!p) {
      root.innerHTML = '<p>No such product. <a href="/">Back to the shop</a>.</p>';
      return;
    }

    document.title = p.title + " — " + data.shop.name;
    var cur = data.shop.currency;
    var selected = p.variants.filter(function (v) { return v.inStock; })[0] || p.variants[0];

    function paint() {
      root.innerHTML =
        '<div><img src="' + p.image + '" alt="' + p.title + '"></div>' +
        "<div>" +
        "<h1>" + p.title + "</h1>" +
        '<div class="meta">' + p.type + " · " + p.vendor + " · " + p.tags.join(", ") + "</div>" +
        '<p class="desc">' + p.description + "</p>" +
        '<div class="price-lg">' + money(selected.price, cur) + "</div>" +
        '<div class="variants">' +
        p.variants
          .map(function (v, i) {
            return (
              '<button class="variant" data-i="' + i + '" data-sku="' + v.sku + '"' +
              ' aria-pressed="' + (v.sku === selected.sku) + '"' +
              (v.inStock ? "" : " disabled") + ">" +
              '<span class="v-title">' + v.title + "</span>" +
              '<span class="v-stock">' +
              (v.inStock ? v.inventory + " in stock" : "out of stock") +
              "</span>" +
              '<span class="v-price">' + money(v.price, cur) + "</span>" +
              "</button>"
            );
          })
          .join("") +
        "</div>" +
        '<button class="buy"' + (selected.inStock ? "" : " disabled") + ">" +
        (selected.inStock ? "Add to cart — " + money(selected.price, cur) : "Out of stock") +
        "</button>" +
        '<div class="policy">' +
        "<h4>Shipping</h4><p>" + data.shop.policies.shipping + "</p>" +
        "<h4>Returns</h4><p>" + data.shop.policies.returns + "</p>" +
        "</div></div>";

      [].forEach.call(root.querySelectorAll(".variant"), function (btn) {
        btn.addEventListener("click", function () {
          selected = p.variants[Number(btn.dataset.i)];
          paint();
        });
      });
    }

    paint();
  }

  load()
    .then(function (data) {
      renderIndex(data);
      renderProduct(data);
    })
    .catch(function (err) {
      var el = document.getElementById("grid") || document.getElementById("product");
      if (el) el.innerHTML = '<p style="color:#8a1c1c">' + err.message + "</p>";
    });
})();
