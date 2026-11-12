# Cosign

A responsibility ledger for delegating to AI agents: every agent action is traced to you, an approval, a contract rule, or a default nobody chose.

There is no backend. The demo runs on a seeded in-memory store (`src/lib/seed.ts`); reloading resets it.

## Development

```sh
bun install   # or npm i
bun run dev   # http://localhost:8080
bun run test
bun run build # Cloudflare Workers output in .output/
```

## Built with

TanStack Start, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, TanStack Query, Zustand.
# fig_2026_hackathon
