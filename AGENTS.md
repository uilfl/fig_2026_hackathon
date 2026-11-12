<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Data.** There is no database. All data is an in-memory Zustand store (`src/lib/store.ts`) seeded by `src/lib/seed.ts`; a reload resets it. Do not reintroduce Supabase/Drizzle without asking.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated (`src/routeTree.gen.ts`).

## Project rules
- Scenario simulation and attribution live in pure `src/lib/engine.ts` (tested); the system, never the agent, assigns reversibility and per-criterion sources; a step's source is its weakest criterion, and select steps re-check logged criteria against options (mismatch = unverified default). Why: keeps attribution auditable and testable.
- Runs are created by the client-side `startRun` in `src/lib/run.ts` (static rationales, no LLM); approvals, default resolutions and rules are written to the store by `src/lib/decisions.ts`; `startRun` expires older runs' pending/blocked steps. Why: the demo must work with no backend.
- Pauses come only from contract settings (reversibility threshold, per-action override in `triggers.actions`, or budget cap), computed in the engine with the reason text naming the setting. Why: every pause must trace to a visible setting.
- Steps record data dependencies in `inputs` (seqs); an irreversible step can't be approved while any upstream step holds an unresolved default, and resolving a default calls `replanRun` (`src/lib/run.ts`), which supersedes changed + downstream steps (`planReplacements` in the engine) and inserts fresh rows in the same run. Why: approvals must be informed by resolved inputs.
- Irreversible pending/blocked steps are approved together on one commit card (`isCommitStep`, `commitPlan` sharing one decided_at; `countApprovals` counts distinct decisions); saved scopes are rules of kind "scope" matched by hash in the engine, and loosening suggestions may only propose scopes, never "Goes ahead". Why: fewer approvals without removing the irreversible safeguard.
- A decline never cancels dependents by itself: they stay blocked until the user picks an alternative (`alternativesFor`/`nextAlternative` in the engine; saved as an override rule, declined row superseded, `replanRun`) or chooses "Stop the run here" (`stopRun`, the only path that cancels). Why: declining must not be a dead end.
- Receipt diffs and shared summaries are pure functions in `src/lib/receipt.ts` (tested); diffs compare how the agents started each run (first row per key thing), stats use final state. Shared receipts are snapshots in the store's `shared` list, read by `/r/$id` (this tab only; a reload resets them) and never include the trace. Why: shared links must be read-only summaries with no listing.
- "Show agent activity" (Orchestra, chat replay, typing) is a per-browser setting in `src/lib/settings.ts`, off by default; the code stays as a study condition. "Try the demo" goes straight to the app; "Reset demo" restores the seed. Why: visitors never share demo data.
- The Run screen is a decision map (`src/components/DecisionMap.tsx`, pure helpers in `src/lib/map.ts`); "try another option" is a client-side dry run of the engine (no writes). "Just this run" choices are stored as `override:<value>` on the step row and merged by `withRunRules` in `replanRun`; `applyChoice` returns an undo. The Venue/Budget agent conflict is an engine step (`CONFLICT_KEY`) that pauses downstream steps until settled. Why: every map interaction must be explainable from engine output.
- The Run screen derives every open item (conflicts, defaults, tentative nodes, commit lock, "resolved in preview") from `deriveOpenItems` in `src/lib/map.ts`, and previews only via pure `previewRun`. Why: map, panel and commit card must never disagree, and previews must never write.
- Contract edits are a local draft until "Sign & run"; signing adds a version to the store (snapshot + diff from pure `src/lib/contract.ts`) only when something changed, and a run's version is the latest one signed before it started. Why: version labels and diffs must match what the agents actually ran under.
- Receipts group steps by decision (`decisionGroups`), with superseded rows nested as earlier versions; numbers, accountability sentence and run-to-run pairs are pure in `src/lib/receipt.ts`. Status chips come from `src/components/Chip.tsx` everywhere. Why: one source for labels and counts across pages.
