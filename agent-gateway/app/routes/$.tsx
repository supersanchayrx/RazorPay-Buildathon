/**
 * Keep genuine application 404s inside the root middleware pipeline. Without
 * this final route, React Router creates its own response before route
 * middleware runs, so the response has neither Chapman's request ID nor its
 * stable HTTP_404 log code.
 */
export function loader() {
  return new Response(
    JSON.stringify({ error: "Not found", error_code: "HTTP_404" }),
    {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
}

export default function NotFound() {
  return null;
}
