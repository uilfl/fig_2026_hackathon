import { describe, expect, it, vi } from "vitest";
import { buildSeed, seedIds } from "./seed";

describe("buildSeed with seedIds", () => {
  it("never generates random values, so it can run in Workers global scope", () => {
    const spy = vi.spyOn(crypto, "randomUUID");
    buildSeed(undefined, seedIds());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("gives identical, unique ids on every build (server and browser hydrate the same seed)", () => {
    const a = buildSeed(undefined, seedIds());
    const b = buildSeed(undefined, seedIds());
    expect(a.ledger.map((r) => r.id)).toEqual(b.ledger.map((r) => r.id));
    expect(new Set(a.ledger.map((r) => r.id)).size).toBe(a.ledger.length);
    expect(a.ledger.every((r) => r.run_id === a.ledger[0].run_id)).toBe(true);
  });

  it("still uses random ids by default (reset runs inside a handler)", () => {
    expect(buildSeed().ledger[0].id).not.toBe(buildSeed().ledger[0].id);
  });
});
