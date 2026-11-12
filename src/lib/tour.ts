/**
 * The guided walkthrough: which element each step points at, what it says (worded for the chosen case),
 * and when it's done. Pure — progress lives in `tour-store.ts`, the coachmark in `components/TourCoach.tsx`.
 */
import { isCommitStep } from "./engine";
import { isOpenConflict, isOpenDefault, latestRun, type Entry } from "./decisions";
import type { Scenario } from "./scenarios";

export type TourRoute = "/contract" | "/run" | "/ledger";
export type TourStep = {
  id: string;
  /** Page the step lives on; the intro (step 0) shows anywhere. */
  route: TourRoute | null;
  /** `data-tour` value of the element it points at (null = centred card). */
  target: string | null;
  title: string;
  body: (S: Scenario) => string;
  /** Done when the user has done the thing (checked against the ledger). Without it, the step waits for Next. */
  done?: (ledger: Entry[]) => boolean;
  /** Shown instead of a Next button while `done` is false. */
  hint?: string;
  /** Next is still offered even though the step has a `done` check. */
  skippable?: boolean;
};

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const live = (ledger: Entry[]) => latestRun(ledger).filter((e) => e.status !== "superseded");

/** No open conflict in the latest run. */
export const conflictSettled = (ledger: Entry[]) => !live(ledger).some(isOpenConflict);
/** No open default (an assumption nobody chose) in the latest run. */
export const defaultsSettled = (ledger: Entry[]) => !live(ledger).some(isOpenDefault);
/** No irreversible step left waiting for approval in the latest run. */
export const commitSettled = (ledger: Entry[]) => !live(ledger).some(isCommitStep);

export const TOUR: TourStep[] = [
  {
    id: "intro",
    route: null,
    target: null,
    title: "Agents plan. You decide where they stop.",
    body: () =>
      "Cosign is a study of supervising AI agents. You sign a contract that says when agents must stop and ask, they run a plan, and every decision shows who made it: you, your contract, or an agent's assumption. Pick a case to walk through — it takes about two minutes.",
  },
  {
    id: "case",
    route: "/contract",
    target: "case",
    title: "What the agents work on",
    body: (S) =>
      `You're on the ${S.title}. Each case has its own agents, options and rules. Switching cases here is a contract change, so it only applies when you sign.`,
  },
  {
    id: "sentence",
    route: "/contract",
    target: "sentence",
    title: "Your brief, in one sentence",
    body: (S) =>
      `Goal, ${S.sentence.unit}, budget, and when to check with you. Tap any underlined part to change it — nothing applies until you sign.`,
  },
  {
    id: "risk-map",
    route: "/contract",
    target: "risk-map",
    title: "Where agents stop and ask",
    body: (S) =>
      `Each action sits on this map by how hard it is to undo. Anything past the line waits for you — right now that's “${lower(S.actionLabels.deposit)}” and “${lower(S.actionLabels.invites)}”. Drag the line or tap a dot to change it.`,
  },
  {
    id: "agents",
    route: "/contract",
    target: "agents",
    title: "Your agents' standing instructions",
    body: (S) =>
      `The ${S.agents.budget}, ${S.agents.venue} and ${S.agents.invites} each own part of the plan. Open one to set its instructions, what it may do without asking, or pause it. Changes take effect when you press Sign & run. The agents have already run once on this brief — let's look at what they did.`,
  },
  {
    id: "waiting",
    route: "/run",
    target: "waiting",
    title: "Waiting on you",
    body: () =>
      "The run paused where your contract said to. Everything that needs you is listed here, in the order it blocks the plan. Agents never resume on their own.",
  },
  {
    id: "conflict",
    route: "/run",
    target: "conflict",
    title: "The agents disagree",
    body: (S) => {
      const p = S.options.find((o) => o.name === S.preference)!;
      return `The ${S.agents.venue} wants ${S.preference} (${S.fits(p.cap)}, ${S.requirement.tag}); the ${S.agents.budget} says it's over the ${S.place} share. Cosign never picks a side — choose one to continue.`;
    },
    done: conflictSettled,
    hint: "Pick a side to continue",
  },
  {
    id: "default",
    route: "/run",
    target: "default",
    title: "A decision nobody made",
    body: () =>
      "An agent assumed this — nobody chose it. Keep it as a rule, accept it just this run, override it, or answer it from a connected resource like a calendar. Anything irreversible that depends on it stays locked until you decide.",
    done: defaultsSettled,
    hint: "Resolve the open assumptions",
    skippable: true,
  },
  {
    id: "commit",
    route: "/run",
    target: "commit",
    title: "Approve what can't be undone, together",
    body: (S) =>
      `“${S.actionLabels.deposit}” and “${lower(S.actionLabels.invites)}” go on one card. Untick anything you don't want; nothing goes out until you approve.`,
    done: commitSettled,
    hint: "Approve or decline the commit plan",
  },
  {
    id: "receipt",
    route: "/ledger",
    target: "receipt",
    title: "The receipt",
    body: () =>
      "Who decided each thing — you, your contract, or an agent's assumption — what it cost, and what changed since the last run of this case. That's the loop: brief, supervise, review. Run it again with different settings and compare.",
  },
];

export const LAST_STEP = TOUR.length - 1;

/** The next step after `from` that still needs doing (steps already satisfied are skipped); past the end = finished. */
export function nextStep(from: number, ledger: Entry[]): number {
  let i = from + 1;
  while (i <= LAST_STEP && TOUR[i]!.done?.(ledger)) i++;
  return i;
}

/** Where the tour should be: the current step, or the next one if the user just did what it asked. */
export function settle(step: number, ledger: Entry[]): number {
  return TOUR[step]?.done?.(ledger) ? nextStep(step, ledger) : step;
}

/** Previous step for Back: skips steps already done (they'd move straight on again), never back into the intro. */
export function prevStep(step: number, ledger: Entry[]): number {
  let i = step - 1;
  while (i > 1 && TOUR[i]!.done?.(ledger)) i--;
  return Math.max(1, i);
}
