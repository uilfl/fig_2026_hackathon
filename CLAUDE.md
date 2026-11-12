# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Cosign": a UX study/demo of supervising AI agents that plan an event (Venue, Budget, etc.). Users sign a *contract* (pause thresholds), agents run a *plan* of steps, risky steps pause for approval, and a *receipt* records what happened. Built on TanStack Start (React 19, file-based routing), Tailwind v4, shadcn/ui (`src/components/ui`), TanStack Query, and a Zustand store. There is no backend or auth: data is a seeded in-memory store that resets on reload. Bun lockfile; npm also works.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` / `npm run preview`
- `npm run lint` (ESLint), `npm run format` (Prettier)
- `npm run test` — vitest run (jsdom, `src/**/*.test.ts(x)`); watch: `npm run test:watch`
- Single test: `npx vitest run src/lib/engine.test.ts` (add `-t "name"` to filter)

## Constraints

- Do not edit `src/routeTree.gen.ts` (generated). Routes are file-based under `src/routes/`; don't create Next/Remix-style `pages/` or layouts.
- No database or server functions: don't reintroduce Supabase/Drizzle. The project came from Lovable but no longer depends on it: `vite.config.ts` is a plain Vite config (Tailwind, TanStack Start, nitro `cloudflare-module` preset on build, dev port 8080).

## Architecture

Logic is deliberately kept in **pure, tested modules** in `src/lib/`; components and routes only render their output. Keep it that way — add logic there with tests, not in components.

- `engine.ts` — scenario simulation and attribution. The system (never the agent) assigns reversibility and per-criterion sources; a step's source is its weakest criterion; select steps re-check logged criteria against options (mismatch = unverified default). Computes all pauses, with reason text naming the contract setting that caused it (reversibility threshold, `triggers.actions` override, or budget cap). Also owns replanning (`planReplacements`), decline alternatives (`alternativesFor`/`nextAlternative`), saved scope rules, and the Venue/Budget conflict step (`CONFLICT_KEY`).
- `store.ts` + `seed.ts` + `model.ts` — the whole "database": a Zustand store seeded from the default contract plus one engine-planned run. `queries.ts` exposes it through TanStack Query (mutations write the store, then invalidate query keys).
- `run.ts` — `startRun` creates runs (static rationales; expires older runs' pending/blocked steps). `replanRun` supersedes changed + downstream steps and inserts fresh rows in the same run. `stopRun` (in `decisions.ts`) is the only path that cancels dependents.
- `decisions.ts` — store writes for approvals, default resolutions and rules. `applyChoice` returns an undo; "Just this run" choices are stored as `override:<value>` on the step row and merged by `withRunRules` in `replanRun`.
- `map.ts` + `components/DecisionMap.tsx` — the Run screen. Every open item comes from `deriveOpenItems`; previews ("try another option") use pure `previewRun` and must never write. Map, side panel, and commit card must never disagree.
- `contract.ts` — contract edits are a local draft until "Sign & run"; signing writes `contract_versions` (snapshot + diff) only when something changed. A run's version = latest one signed before it started.
- `receipt.ts` — receipt diffs, stats, `decisionGroups` (superseded rows nested as earlier versions), shared summaries. Diffs compare how agents *started* each run; stats use final state. Shared receipts are snapshots in the store, shown by `/r/$id` (same tab only), and never include the trace.
- `scenarios.ts` — demo cases (Team offsite, Client dinner): same plan shape, case-supplied content. Rules carry the case they belong to (`Rule.scenario`, untagged = offsite); read them with `rulesFor`/`ruleFor` and write with `putRule` so one case's rules never steer another. Receipts only compare runs of the same case.
- Connected resources (`Scenario.resources`, `Contract.resources`): a case's team calendar, brief and guest list answer the date, the requirement and who gets the invites. Source `"resource"` ranks below contract, above default; any rule for the key wins, and ids are case-scoped (`resourcesFor`/`resourceAnswering` in `engine.ts`). Connect on the Contract (versioned) or via "Answer from …" on Run (`connectResource` in `decisions.ts`, re-plans). The budget split has no resource on purpose.
- `tour.ts` + `tour-store.ts` + `components/TourCoach.tsx` — guided walkthrough: steps point at `data-tour` elements and advance when their ledger predicate holds; progress (`seen`, case) persists under `cosign.tour`, separate from the demo store.
- `settings.ts` — per-browser "Show agent activity" (Orchestra, chat replay, typing), on by default; keep the code as a study condition.

### Invariants to preserve

- Steps record data dependencies in `inputs` (seqs). An irreversible step can't be approved while any upstream step holds an unresolved default; resolving a default calls `replanRun`.
- Irreversible pending/blocked steps are approved together on one commit card (`isCommitStep`, `commitPlan` sharing one `decided_at`; `countApprovals` counts distinct decisions). Loosening suggestions may only propose scopes (rules of kind `"scope"` matched by hash), never "Goes ahead".
- Declining never cancels dependents; they stay blocked until the user picks an alternative or "Stop the run here".
- Status chips always come from `components/Chip.tsx`.
- Study UI text is English (owner's decision for this project; overrides the global 繁體中文 UI preference). Code/communication in English. Status vocabulary comes from `CHIP_LABEL`/`chipFor` in `components/Chip.tsx`: "Waiting on you" for anything paused for the user, "Receipt(s)" for the `/ledger` screen.
