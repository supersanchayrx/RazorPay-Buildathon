/**
 * Where this gateway answers, as the outside world reaches it.
 *
 * Everything an agent is handed is built from this string: the MCP endpoint in
 * the discovery document, the URLs in `/llms.txt`, the continue link a checkout
 * escalates to. Get it wrong and nothing looks broken — the document is served,
 * it validates, it names an endpoint, and the endpoint is one that only this
 * process can resolve. The failure lands on somebody else's machine, as a DNS
 * error naming a host they have never heard of.
 *
 * That is not hypothetical. It is what a container does by default:
 *
 *   $ curl http://localhost:4000/.well-known/ucp
 *   "endpoint": "http://gateway:3000/ucp/pk_.../mcp"
 *
 * `gateway` is a compose service name. Inside the network it is right; to the
 * agent that was told to shop there, it does not exist. The request arrived via
 * a proxy that dialled `gateway:3000`, so `Host` said `gateway:3000`, so that is
 * what the document advertised.
 *
 * TWO SOURCES, IN THIS ORDER.
 *
 * 1. `GATEWAY_ORIGIN`, when set. It is a deployment stating where it answers,
 *    and a deployment knows things a request cannot: that it sits behind a
 *    tunnel, that its internal service name is not a public hostname, that TLS
 *    terminates upstream. `npm run init` writes it and INSTALL.md asks for it.
 *
 * 2. The forwarded headers, then `Host`. Correct for the ordinary case — one
 *    process, reached directly or through a proxy that forwards honestly — and
 *    it is what this did before, unchanged, whenever the variable is unset.
 *
 * The order matters and is deliberate. `Host` is attacker-controlled: it is a
 * header on a request, and a URL built from it is a URL an outsider chose. For
 * a public discovery document that is mostly a nuisance; for anything that ends
 * up in a message we send a shopper it is worse than a nuisance. Letting an
 * operator pin it is the fix, and pinning has to win or it is not a fix.
 */

/** A trailing slash here becomes a double slash in every URL built from it. */
const trim = (s: string) => s.trim().replace(/\/+$/, "");

/**
 * `selfOrigin(request)` — scheme and host, no path, no trailing slash.
 *
 * Give it the request even when GATEWAY_ORIGIN is set: the fallback has to stay
 * exercised, because a deployment that unsets the variable should degrade to
 * the old behaviour rather than to an empty string.
 */
export function selfOrigin(request: Request): string {
  const configured = process.env.GATEWAY_ORIGIN;
  if (configured && trim(configured).length > 0) {
    const value = trim(configured);
    try {
      // Parsed rather than trusted. A GATEWAY_ORIGIN with a path on it — and
      // `https://shop.example/` is the one people write — would otherwise put a
      // stray segment into every endpoint we publish.
      return new URL(value).origin;
    } catch {
      // Unparseable is a configuration error, but not one worth refusing to
      // serve over: fall through to the request and let `npm run doctor` be the
      // thing that says so.
    }
  }

  const u = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? u.host;
  return `${proto}://${host}`;
}
