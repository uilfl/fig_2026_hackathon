/** Wording for the agent settings panel (study UI is English). */
export const PANEL_TEXT = {
  decides: "What it decides",
  decidesEmpty: "Nothing to choose: it uses your goal and headcount as they are.",
  defaultNote: "Shows as a default nobody chose until you set it.",
  stops: "When it stops to ask",
  stopsEmpty:
    "Its picks are free to change, so it only stops if you pause it or ask before every side effect.",
  askSwitch: "Ask me first",
  followsContract: (asks: boolean) => `Following your contract (${asks ? "asks" : "goes ahead"})`,
  changedFromContract: (asks: boolean) =>
    `Changed from your contract, which would ${asks ? "ask" : "go ahead"}`,
  reset: "Reset",
  readAsks: "Asks first",
  readGoes: "Goes ahead",
  readContract: " (your contract)",
  pause: "Pause this agent",
  pauseNote: "Every step it takes waits for you, and steps that depend on it stay blocked.",
  paused: "Paused",
  running: "Running",
  lastRun: "What it did last run",
  lastRunEmpty: "Nothing yet.",
  footerEdit: "Changes apply to the next run, when you sign.",
  change: "Change settings",
} as const;
