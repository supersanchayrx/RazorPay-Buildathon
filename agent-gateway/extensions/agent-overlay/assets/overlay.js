(function () {
  var root = document.getElementById("agent-gateway-root");
  if (!root) return;

  var proxy = root.dataset.proxy || "/apps/agent";
  var customerId = root.dataset.customerId || null;
  var history = [];

  root.innerHTML =
    '<div class="agw-panel" data-open="0">' +
      '<div class="agw-head">Store assistant</div>' +
      '<div class="agw-log"></div>' +
      '<form class="agw-form"><input type="text" placeholder="Ask something…" autocomplete="off"><button type="submit">Send</button></form>' +
    "</div>" +
    '<button class="agw-btn" aria-label="Open store assistant">💬</button>';

  var panel = root.querySelector(".agw-panel");
  var log   = root.querySelector(".agw-log");
  var form  = root.querySelector(".agw-form");
  var input = root.querySelector(".agw-form input");
  var send  = root.querySelector(".agw-form button");

  function say(who, text, gates) {
    var el = document.createElement("div");
    el.className = "agw-msg";
    el.dataset.who = who;
    el.textContent = text;
    if (gates && gates.length) {
      var tag = document.createElement("span");
      tag.className = "agw-gate";
      tag.textContent = "bounded: " + gates.join(", ");
      el.appendChild(tag);
    }
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  root.querySelector(".agw-btn").addEventListener("click", function () {
    var open = panel.dataset.open === "1" ? "0" : "1";
    panel.dataset.open = open;
    if (open === "1") {
      if (!log.childElementCount) say("agent", root.dataset.greeting || "Hi.");
      input.focus();
    }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    say("user", text);
    input.value = "";
    send.disabled = true;

    fetch(proxy + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, customerId: customerId, history: history })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.body && res.body.error ? res.body.error : "request failed");
        say("agent", res.body.reply, res.body.bounded ? res.body.gates : null);
        history.push({ role: "user", content: text });
        history.push({ role: "assistant", content: res.body.reply });
        if (history.length > 12) history = history.slice(-12);
      })
      .catch(function (err) { say("error", String(err.message || err)); })
      .finally(function () { send.disabled = false; input.focus(); });
  });
})();
