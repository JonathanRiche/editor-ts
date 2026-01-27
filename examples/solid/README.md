# EditorTs Solid + SQLocal (Vite)

This example runs EditorTs with SQLocal in a SolidJS app using Vite.

## Setup

```bash
cd examples/solid
bun install
```

## Run (Vite client only)

```bash
bun run dev
```

Visit `http://localhost:5173`.

## Run (SSR + hydration)

```bash
bun run dev
bun run server
```

Visit `http://localhost:3000`.

## Notes

- Uses the SQLocal Vite plugin for cross-origin isolation headers.
- Passes a pre-initialized SQLocal client to the storage config.
- SSR uses `renderToString` with `generateHydrationScript`, then `hydrate` in `src/client.tsx`.
- `bun run server` uses `bunfig.toml` route mapping to serve `src/server.ts`.
