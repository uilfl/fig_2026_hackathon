import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DecisionMap } from "@/components/DecisionMap";
import type { Entry } from "@/lib/decisions";
import type { NodeKey } from "@/lib/map";

// jsdom has no ResizeObserver; the map only needs it to read its width.
class StubResizeObserver {
  observe() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

const split = {
  id: "e1",
  seq: 1,
  role: "split",
  scenario: "offsite",
  kind: "select",
  action: "Allocated 60% of the budget to the venue",
  criterion: "split",
  status: "done",
  source: "user",
  agent: "Budget agent",
  rationale: "Venues drive cost.",
  resolution: null,
  default_label: null,
  criteria: [],
  preview: null,
  created_at: "2026-01-01T00:00:00Z",
  decided_at: null,
} as unknown as Entry;

function renderMap() {
  return render(
    <DecisionMap
      nodes={new Map<NodeKey, Entry>([["split", split]])}
      ghosts={[]}
      selected={undefined}
      onSelect={() => {}}
      lit={null}
      changes={null}
      onClear={() => {}}
      flash={0}
      tentative={new Map()}
      openKeys={new Set()}
      resolvedInPreview={new Set()}
      choiceHover={null}
      setChoiceHover={() => {}}
      settledConflict={false}
      venueShare="$5,000"
    />,
  );
}

describe("DecisionMap detail card", () => {
  it("opens for keyboard focus, links to the node, and closes on blur", () => {
    renderMap();
    const node = screen.getByRole("button", { name: /Budget split 60%/i });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.focus(node);
    const card = screen.getByRole("tooltip");
    expect(card).toHaveTextContent("Decided by");
    expect(node).toHaveAttribute("aria-describedby", card.id);

    fireEvent.blur(node);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes with Escape while focus stays on the node", () => {
    renderMap();
    const node = screen.getByRole("button", { name: /Budget split 60%/i });
    fireEvent.focus(node);
    fireEvent.keyDown(node, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
