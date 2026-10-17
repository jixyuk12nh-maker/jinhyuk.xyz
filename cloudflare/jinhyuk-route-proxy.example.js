// Example snippet for the existing jinhyuk.xyz Worker, not a standalone deployable worker.
// Insert before its normal static-site/assets fallback, after existing reserved API routes.
const pathParts = new URL(request.url).pathname.split("/").filter(Boolean);
if (request.method === "GET" && pathParts.length === 2) {
  const upstream = new URL(request.url);
  upstream.protocol = "https:";
  upstream.hostname = "tm.jixyuk12nh.workers.dev";
  return fetch(new Request(upstream, request));
}
