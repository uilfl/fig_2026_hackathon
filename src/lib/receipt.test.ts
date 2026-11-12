import { describe, expect, it } from "vitest";
import { diffRuns, previousOfCase, receiptSummary, type ReceiptRow } from "./receipt";

let t = 0;
const row = (p: Partial<ReceiptRow>): ReceiptRow => ({
  seq: 0,
  kind: "select",
  action: "",
  source: "default",
  status: "done",
  criterion: null,
  default_key: null,
  default_label: null,
  resolution: null,
  criteria: [],
  preview: null,
  created_at: new Date(1e12 + t++ * 1000).toISOString(),
  decided_at: null,
  ...p,
});
const dep = (decided: string) =>
  row({
    seq: 4,
    role: "deposit",
    kind: "spend",
    action: "Pay venue deposit to Lakeside Lodge",
    source: "approved",
    decided_at: decided,
    preview: { amount: 1600, reversibility: "never" },
  });
const inv = (decided: string, saved = false) =>
  row({
    seq: 6,
    role: "invites",
    kind: "send",
    action: "Send calendar invites",
    source: "approved",
    decided_at: decided,
    preview: { reversibility: "never", saved_scope: saved },
  });
const run1 = [
  row({
    seq: 2,
    role: "venue",
    action: "Shortlisted Lakeside Lodge",
    criteria: [{ key: "require_parking", label: "p", source: "default", verified: true }],
    default_key: "require_parking",
    default_label: "Parking",
    resolution: "keep",
  }),
  row({
    seq: 3,
    role: "dates",
    action: "Picked dates Mar 14–15",
    criterion: "earliest_weekend",
    default_key: "earliest_weekend",
    default_label: "Earliest weekend",
    resolution: "override:Mar 21–22",
  }),
  dep("a"),
  inv("b"),
];
const run2 = [
  row({
    seq: 2,
    role: "venue",
    action: "Shortlisted Lakeside Lodge",
    source: "contract",
    criteria: [{ key: "require_parking", label: "p", source: "rule", verified: true }],
  }),
  row({
    seq: 3,
    role: "dates",
    action: "Picked dates Mar 21–22",
    criterion: "earliest_weekend",
    source: "user",
  }),
  dep("c"),
  inv("c", true),
];

describe("receipt diff", () => {
  const d = diffRuns(run1, run2);
  it("shows dates and parking source changes", () => {
    expect(d).toContain("Dates: DEFAULT → YOU CHOSE · Mar 14–15 → Mar 21–22");
    expect(d).toContain("Parking: DEFAULT → CONTRACT RULE");
  });
  it("shows approvals 2 → 1 and money even when unchanged", () => {
    expect(d).toContain("Approvals: 2 → 1");
    expect(d).toContain("Money committed: $1,600 → $1,600");
  });
  it("shared summary lists assumptions with their resolution and no trace fields", () => {
    const s = receiptSummary(run1);
    expect(s.assumptions).toEqual([
      { label: "Parking", resolution: "Kept as rule" },
      { label: "Earliest weekend", resolution: "You overrode → Mar 21–22" },
    ]);
    expect(JSON.stringify(s)).not.toContain("rationale");
  });
});

import { accountability, changePairs, decisionGroups, receiptNumbers, runState } from "./receipt";
describe("receipt v2", () => {
  const row = (o: Partial<import("./receipt").ReceiptRow>) => ({
    seq: 1,
    kind: "select",
    action: "",
    source: "default",
    status: "done",
    criterion: null,
    default_key: null,
    default_label: null,
    resolution: null,
    preview: null,
    created_at: "2026-01-01T00:00:00Z",
    decided_at: null,
    ...o,
  });
  const run = [
    row({
      seq: 1,
      role: "dates",
      action: "Picked dates Mar 14–15",
      criterion: "earliest_weekend",
      default_key: "earliest_weekend",
      status: "superseded",
      resolution: "override:Mar 21–22",
    }),
    row({
      seq: 1,
      role: "dates",
      action: "Picked dates Mar 21–22",
      criterion: "earliest_weekend",
      source: "user",
      created_at: "2026-01-01T00:01:00Z",
      resolution: "override:Mar 21–22",
    }),
    row({
      seq: 2,
      role: "deposit",
      kind: "spend",
      action: "Pay venue deposit",
      source: "approved",
      decided_at: "x",
      preview: { amount: 1600, reversibility: "never", what: "", reversibility_note: "" },
    }),
    row({
      seq: 3,
      role: "catering",
      kind: "spend",
      action: "Reserve catering",
      source: "contract",
      preview: { amount: 1020, reversibility: "until_deadline", what: "", reversibility_note: "" },
    }),
  ];
  it("superseded steps sit inside their decision row", () => {
    const g = decisionGroups(run).find((x) => x.key === "dates")!;
    expect(g.row.action).toBe("Picked dates Mar 21–22");
    expect(g.earlier).toHaveLength(1);
    expect(g.earlier[0]!.why).toBe("You picked Mar 21–22 instead");
  });
  it("counts committed separately from refundable", () => {
    const n = receiptNumbers(run);
    expect([n.committed, n.refundable, n.byContract]).toEqual([1600, 1020, 1]);
    expect([n.openAssumptions, n.resolvedAssumptions]).toEqual([0, 1]);
  });
  it("writes the accountability sentence", () => {
    expect(accountability(run).text).toBe(
      "You chose the dates. The contract covered catering. You approved the $1,600 deposit. Nothing was left to an unchosen default.",
    );
    expect(runState(run)).toBe("Complete");
  });
  it("identical runs produce no changes", () => {
    expect(changePairs(run, run).some((p) => p.changed)).toBe(false);
  });
});

describe("receipts compare runs of the same case", () => {
  it("a dinner run after offsite runs has nothing to compare against; the next dinner run compares to it", () => {
    const off = run1.map((r) => ({ ...r, scenario: "offsite" }));
    const din1 = run2.map((r) => ({ ...r, scenario: "dinner" }));
    const din2 = run2.map((r) => ({ ...r, scenario: "dinner" }));
    const runs = [off, din1, off, din2];
    expect(previousOfCase(runs, 1)).toBeUndefined();
    expect(previousOfCase(runs, 3)).toBe(din1);
    expect(previousOfCase(runs, 2)).toBe(off);
  });
  it("shared summaries carry the case title", () => {
    expect(receiptSummary(run2.map((r) => ({ ...r, scenario: "dinner" }))).case).toBe(
      "Client dinner",
    );
  });
});
