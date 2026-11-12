/** Wording for creating your own agent (study UI is English). */
export const NEW_AGENT_TEXT = {
  card: "+ New agent",
  cardHint: "Add your own agent to the team",
  title: "New agent",
  description: "Name an agent and say what it's for. It joins the team when you sign.",
  demoNote:
    "Demo version: new agents are saved to your contract but don't work yet. They won't take any steps in a run.",
  name: "Name",
  namePlaceholder: "e.g. Catering agent",
  note: "What is it for?",
  notePlaceholder: "e.g. Finds a caterer that works for the whole group",
  count: (n: number, max: number) => `${n}/${max}`,
  cancel: "Cancel",
  create: "Add agent",
  added: (name: string) => `${name} added — applies when you sign`,
  noSteps: "Takes no steps yet",
  remove: "Remove",
  removeLabel: (name: string) => `Remove ${name}`,
  orchestra: (names: string) => `Also on your team: ${names} — no steps in this run.`,
} as const;
