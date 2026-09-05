import type { LoaderFunctionArgs } from "react-router";

/**
 * The widget, served from our domain.
 *
 *   <script src="https://agent.example.com/embed.js"
 *           data-site="pk_..." defer></script>
 *
 * The merchant hosts nothing and updates nothing — they paste one tag and we
 * ship changes to every site at once. The script reads its own configuration
 * off that tag, so common tweaks never require a dashboard.
 */

const WIDGET = String.raw`
(function () {
  var tag = document.currentScript;
  if (!tag) return;

  var site     = tag.getAttribute("data-site");
  var greeting = tag.getAttribute("data-greeting") || "Hi — ask me anything about this store.";
  var accent   = tag.getAttribute("data-accent")   || "#17201c";
  var side     = tag.getAttribute("data-position") === "left" ? "left" : "right";
  var api      = new URL(tag.src).origin + "/embed/chat";

  if (!site) { console.error("[agent] missing data-site on the embed tag"); return; }

  var css = document.createElement("style");
  css.textContent = [
    "#agw{position:fixed;" + side + ":20px;bottom:20px;z-index:2147483000;",
      "font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}",
    "#agw .agw-btn{width:54px;height:54px;border-radius:50%;border:0;cursor:pointer;",
      "background:" + accent + ";color:#fff;font-size:21px;box-shadow:0 6px 22px rgba(0,0,0,.26)}",
    "#agw .agw-panel{position:absolute;" + side + ":0;bottom:66px;width:min(370px,calc(100vw - 40px));",
      "height:min(520px,calc(100vh - 140px));display:none;flex-direction:column;background:#fff;color:#17201c;",
      "border:1px solid #e2e6e4;border-radius:14px;box-shadow:0 14px 44px rgba(0,0,0,.2);overflow:hidden}",
    "#agw .agw-panel[data-open=\"1\"]{display:flex}",
    "#agw .agw-head{padding:12px 14px;border-bottom:1px solid #eef1ef;font-weight:600}",
    "#agw .agw-log{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}",
    "#agw .agw-msg{padding:8px 11px;border-radius:10px;max-width:88%;white-space:pre-wrap;word-wrap:break-word}",
    "#agw .agw-msg[data-who=\"user\"]{align-self:flex-end;background:" + accent + ";color:#fff}",
    "#agw .agw-msg[data-who=\"agent\"]{align-self:flex-start;background:#f3f5f4}",
    "#agw .agw-msg[data-who=\"error\"]{align-self:flex-start;background:#fdecec;color:#8a1c1c}",
    "#agw .agw-gate{display:block;margin-top:6px;padding-top:5px;border-top:1px solid rgba(0,0,0,.12);",
      "font-size:11px;letter-spacing:.03em;text-transform:uppercase;opacity:.6}",
    "#agw .agw-cards{display:flex;flex-direction:column;gap:8px;align-self:stretch}",
    "#agw .agw-card{display:flex;gap:10px;align-items:center;text-decoration:none;color:inherit;",
      "border:1px solid #e2e6e4;border-radius:10px;padding:8px;background:#fff}",
    "#agw .agw-card:hover{border-color:" + accent + "}",
    "#agw .agw-card img{width:46px;height:46px;border-radius:7px;object-fit:cover;flex:none;background:#eee}",
    "#agw .agw-card b{display:block;font-size:13px;font-weight:600}",
    "#agw .agw-card span{font-size:12.5px;opacity:.7}",
    "#agw .agw-oos{font-size:11px;color:#8a4b1c}",
    "#agw form{display:flex;gap:8px;padding:10px;border-top:1px solid #eef1ef}",
    "#agw input{flex:1;padding:9px 11px;border:1px solid #dfe4e1;border-radius:9px;font:inherit;min-width:0}",
    "#agw button[type=submit]{padding:9px 14px;border:0;border-radius:9px;background:" + accent + ";color:#fff;cursor:pointer;font:inherit}",
    "#agw button[disabled]{opacity:.5;cursor:default}",
    // The waiting indicator. Three dots on a staggered fade, which reads as
    // "working" without implying progress we cannot measure — a progress bar
    // that jumps to 90% and sits there is worse than no bar.
    "#agw .agw-dots{align-self:flex-start;background:#f3f5f4;border-radius:10px;padding:11px 13px;display:flex;gap:4px}",
    "#agw .agw-dots i{width:6px;height:6px;border-radius:50%;background:#9aa5a0;display:block;",
      "animation:agwb 1.2s infinite ease-in-out}",
    "#agw .agw-dots i:nth-child(2){animation-delay:.18s}",
    "#agw .agw-dots i:nth-child(3){animation-delay:.36s}",
    "@keyframes agwb{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}",
    // Respect a reader who has asked for less motion. The dots still change
    // opacity so the state is still visible; they just stop bouncing.
    "@media (prefers-reduced-motion:reduce){#agw .agw-dots i{animation-duration:2.4s;transform:none!important}}"
  ].join("");
  document.head.appendChild(css);

  var root = document.createElement("div");
  root.id = "agw";
  root.innerHTML =
    "<div class=\"agw-panel\" data-open=\"0\">" +
      "<div class=\"agw-head\">Store assistant</div>" +
      "<div class=\"agw-log\"></div>" +
      "<form><input type=\"text\" placeholder=\"Ask something…\" autocomplete=\"off\">" +
      "<button type=\"submit\">Send</button></form>" +
    "</div>" +
    "<button class=\"agw-btn\" aria-label=\"Open store assistant\">💬</button>";
  document.body.appendChild(root);

  var panel = root.querySelector(".agw-panel");
  var log   = root.querySelector(".agw-log");
  var form  = root.querySelector("form");
  var input = root.querySelector("input");
  var send  = root.querySelector("button[type=submit]");
  var history = [];

  function money(v, cur) {
    var s = cur === "INR" ? "₹" : cur === "USD" ? "$" : cur + " ";
    return String(v).split("–").map(function (part) {
      var n = Number(part);
      return s + (isNaN(n) ? part : n.toLocaleString("en-IN"));
    }).join(" – ");
  }

  function say(who, text, gates) {
    var el = document.createElement("div");
    el.className = "agw-msg";
    el.dataset.who = who;
    el.textContent = text;
    if (gates && gates.length) {
      var tagEl = document.createElement("span");
      tagEl.className = "agw-gate";
      tagEl.textContent = "bounded: " + gates.join(", ");
      el.appendChild(tagEl);
    }
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  // Cards are built ONLY from server-supplied catalogue fields. The reasoner
  // never emits markup, links or image URLs, so the widget cannot render a
  // product that does not exist.
  function cards(list) {
    if (!list || !list.length) return;
    var wrap = document.createElement("div");
    wrap.className = "agw-cards";
    list.forEach(function (c) {
      var a = document.createElement("a");
      a.className = "agw-card";
      a.href = c.url || "#";
      a.target = "_top";
      var img = document.createElement("img");
      img.src = c.image || "";
      img.alt = "";
      var box = document.createElement("div");
      var b = document.createElement("b");
      b.textContent = c.title;
      var s = document.createElement("span");
      s.textContent = money(c.price, c.currency);
      box.appendChild(b);
      box.appendChild(s);
      if (!c.inStock) {
        var o = document.createElement("div");
        o.className = "agw-oos";
        o.textContent = "Out of stock";
        box.appendChild(o);
      }
      a.appendChild(img);
      a.appendChild(box);
      wrap.appendChild(a);
    });
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }

  root.querySelector(".agw-btn").addEventListener("click", function () {
    var open = panel.dataset.open === "1" ? "0" : "1";
    panel.dataset.open = open;
    if (open === "1") {
      if (!log.childElementCount) say("agent", greeting);
      input.focus();
    }
  });

  // How long to wait before giving up. The tool loop can legitimately take a
  // few seconds — several catalogue lookups and a model call each — so this is
  // generous. What it must not be is infinite: a request that never settles
  // leaves the composer disabled and the widget dead with no explanation.
  var TIMEOUT_MS = 60000;

  // Wording for the shopper. Deliberately not the technical string: "Failed to
  // fetch" tells them nothing they can act on, and it is the merchant's brand
  // carrying the message. The real error still goes to the console for whoever
  // is debugging.
  function apology(kind) {
    if (kind === "timeout") {
      return "Sorry — that took longer than expected and I had to stop waiting. Please try asking again.";
    }
    if (kind === "offline") {
      return "Sorry, I could not reach the store just now. Check your connection and try again.";
    }
    if (kind === "empty") {
      return "Sorry, I did not manage to put an answer together for that. Try asking a different way and I will have another go.";
    }
    return "Sorry, something went wrong at my end. Please try again in a moment.";
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    say("user", text);
    input.value = "";
    send.disabled = true;

    // Shown immediately, before the request is even sent. The tool loop can
    // take several seconds, and a blank panel during that time reads as broken
    // — which is exactly what it looked like before this existed.
    var dots = document.createElement("div");
    dots.className = "agw-dots";
    dots.setAttribute("role", "status");
    dots.setAttribute("aria-label", "Assistant is typing");
    dots.innerHTML = "<i></i><i></i><i></i>";
    log.appendChild(dots);
    log.scrollTop = log.scrollHeight;
    function clearDots() {
      if (dots && dots.parentNode) dots.parentNode.removeChild(dots);
      dots = null;
    }

    // One bubble, filled in as the server releases text. The server only
    // releases text that has already cleared the bounds check, so nothing shown
    // here has skipped a gate — but a late violation can still replace the
    // whole bubble, which is why the element is kept and rewritten rather than
    // appended to blindly.
    var bubble = null;
    var shown = "";
    function into(t) {
      clearDots();
      if (!bubble) {
        bubble = document.createElement("div");
        bubble.className = "agw-msg";
        bubble.dataset.who = "agent";
        log.appendChild(bubble);
      }
      shown += t;
      bubble.textContent = shown;
      log.scrollTop = log.scrollHeight;
    }
    function replaceWith(t, gates) {
      clearDots();
      if (bubble) bubble.remove();
      bubble = null;
      // History records what the shopper actually saw, which after a gate fires
      // is the refusal — not the suppressed draft, and not an empty string.
      shown = t;
      say("agent", t, gates);
    }

    // AbortController rather than a bare timer, so a hung request is actually
    // cancelled instead of being left running while we stop listening.
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      if (ctl) ctl.abort();
    }, TIMEOUT_MS);

    fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctl ? ctl.signal : undefined,
      // The merchant's own page sets window.CHAPMAN_SESSION for a signed-in
      // shopper, and leaves it undefined otherwise. Read at send time rather
      // than at load, so a shopper who signs in without reloading is picked up.
      body: JSON.stringify({
        site: site,
        message: text,
        history: history,
        session: window.CHAPMAN_SESSION || undefined,
        stream: true
      })
    })
      .then(function (r) {
        if (!r.ok) {
          return r.json().then(function (j) {
            var err = new Error((j && j.error) || "request failed");
            err.agwKind = "server";
            throw err;
          }, function () {
            var err = new Error("request failed with status " + r.status);
            err.agwKind = "server";
            throw err;
          });
        }
        var reader = r.body.getReader();
        var dec = new TextDecoder();
        var buf = "";

        function handle(ev) {
          if (ev.type === "delta") into(ev.text);
          else if (ev.type === "replace") replaceWith(ev.reply, ev.gates);
          else if (ev.type === "cards") { clearDots(); cards(ev.cards); }
          else if (ev.type === "error") {
            var err = new Error(ev.error);
            err.agwKind = "server";
            throw err;
          }
        }

        return (function pump() {
          return reader.read().then(function (res) {
            buf += dec.decode(res.value || new Uint8Array(), { stream: !res.done });
            // SSE frames are separated by a blank line. Splitting on that rather
            // than on newlines is what keeps a chunk that arrives mid-frame from
            // being parsed as truncated JSON.
            var frames = buf.split("\n\n");
            buf = frames.pop();
            frames.forEach(function (f) {
              var line = f.split("\n").find(function (l) { return l.indexOf("data: ") === 0; });
              if (line) handle(JSON.parse(line.slice(6)));
            });
            if (!res.done) return pump();
          });
        })();
      })
      .then(function () {
        // THE STREAM CAN END HAVING SAID NOTHING. Every model in the chain may
        // be rate-limited, or the loop may produce no usable answer. Before this
        // check the shopper saw their own message and then silence for ever —
        // no bubble, no error, nothing to retry against.
        if (!shown.trim()) {
          say("error", apology("empty"));
          return;
        }
        history.push({ role: "user", content: text });
        history.push({ role: "assistant", content: shown });
        if (history.length > 12) history = history.slice(-12);
      })
      .catch(function (err) {
        // The shopper gets an apology; whoever is debugging gets the truth.
        if (window.console && console.error) console.error("[agent]", err);
        var kind = timedOut
          ? "timeout"
          : (err && err.agwKind) || (typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "network");
        // A partial answer is left on screen rather than deleted — the shopper
        // already read it, and removing it would be more confusing than a note
        // saying the rest did not arrive.
        say("error", apology(kind === "server" ? "server" : kind));
      })
      .finally(function () {
        clearTimeout(timer);
        clearDots();
        send.disabled = false;
        input.focus();
      });
  });
})();
`;

export const loader = async (_args: LoaderFunctionArgs) => {
  return new Response(WIDGET, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // The script is public and origin-agnostic. The chat endpoint is where
      // the origin check actually happens.
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
    },
  });
};
