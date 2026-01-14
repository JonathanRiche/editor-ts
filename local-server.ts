import homepage from "./index.html";

const portEnv = process.env.PORT;
const port = portEnv ? Number(portEnv) : 5021;

const opencodeBaseUrl = process.env.OPENCODE_BASE_URL ?? "http://127.0.0.1:6007";
const opencodeUser = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
const opencodePass = process.env.OPENCODE_SERVER_PASSWORD;

const server = Bun.serve({
  development: {
    console: true
  },
  port,
  routes: {
    "/": homepage,

    // Proxy to a password-protected opencode server (avoids browser CORS preflight).
    "/opencode/*": async (req) => {
      const url = new URL(req.url);
      const upstreamPath = url.pathname.replace(/^\/opencode/, "");
      const upstream = new URL(upstreamPath + url.search, opencodeBaseUrl);

      const headers = new Headers(req.headers);
      headers.delete("host");
      headers.delete("origin");

      if (opencodePass) {
        const basic = Buffer.from(`${opencodeUser}:${opencodePass}`).toString("base64");
        headers.set("authorization", `Basic ${basic}`);
      }

      const upstreamReq = new Request(upstream.toString(), {
        method: req.method,
        headers,
        body: req.body,
      });

      const res = await fetch(upstreamReq);

      // Ensure browser can read the response
      const outHeaders = new Headers(res.headers);
      outHeaders.set("access-control-allow-origin", url.origin);

      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: outHeaders,
      });
    },
  },

  // (optional) fallback for unmatched routes:
  // Required if Bun's version < 1.2.3
  fetch(req) {
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at ${server.url}`);
console.log(`Proxying /opencode/* -> ${opencodeBaseUrl}`);
