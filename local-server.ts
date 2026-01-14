import homepage from "./index.html";

const portEnv = process.env.PORT;
const port = portEnv ? Number(portEnv) : 5021;

const server = Bun.serve({
  development: {
    console: true
  },
  port,
  routes: {
    "/": homepage
  },

  // (optional) fallback for unmatched routes:
  // Required if Bun's version < 1.2.3
  fetch(req) {
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at ${server.url}`);
