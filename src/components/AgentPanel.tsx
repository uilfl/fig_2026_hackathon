import { Link } from "@tanstack/react-router";
import type { Contract } from "@/lib/engine";
import type { AgentRole, Scenario } from "@/lib/scenarios";
import { agentSettings, agentSteps, withAgentSetting, UP_TO_AGENT, type ActionMode, type AgentChange } from "@/lib/agents";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/AgentChat";
import { Chip, chipFor } from "@/components/Chip";

type Row = { id: string; agent: string; action: string; source: string; status: string; resolution: string | null; preview: unknown };

const MODE_LABEL: Record<ActionMode, string> = { ask: "Always ask me first", threshold: "Follow my threshold", go: "Go ahead without asking" };
const MODES: ActionMode[] = ["ask", "threshold", "go"];

/**
 * One agent's settings, as a view of the contract. `onChange` given = editable (Contract page, writes the draft);
 * otherwise read-only with a link to change them on the Contract page.
 */
export function AgentPanel({ role, onClose, S, contract, run, onChange }: { role: AgentRole | null; onClose: () => void; S: Scenario; contract: Contract; run: Row[]; onChange?: (next: Contract) => void }) {
  const v = role ? agentSettings(contract, S, role) : null;
  const steps = role ? agentSteps(run, S, role).filter((e) => e.status !== "superseded") : [];
  const set = (change: AgentChange) => { if (role && onChange) onChange(withAgentSetting(contract, S, role, change)); };
  const edit = !!onChange;
  return (
    <Sheet open={!!role} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex flex-col overflow-y-auto">
        {v && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3"><Avatar who={v.name} S={S} /><SheetTitle>{v.name}</SheetTitle>{v.paused && <Chip kind="waiting">Paused</Chip>}</div>
              <SheetDescription>{v.job}</SheetDescription>
            </SheetHeader>

            <section className="mt-6" aria-labelledby="agent-instructions">
              <h3 id="agent-instructions" className="stamp text-muted-foreground">Follows these instructions</h3>
              {!v.instructions.length && <p className="mt-2 text-sm text-muted-foreground">Nothing to choose: it uses your goal and headcount as they are.</p>}
              {v.instructions.map((i) => (
                <fieldset key={i.key} className="mt-3">
                  <legend className="text-sm font-medium">{i.title}</legend>
                  {edit ? (
                    <RadioGroup value={i.value} onValueChange={(value) => set({ instruction: i.key, value })} className="mt-2 gap-1.5">
                      {i.options.map((o) => (
                        <label key={o.value} className="flex items-center gap-2 text-sm"><RadioGroupItem value={o.value} />{o.label}</label>
                      ))}
                    </RadioGroup>
                  ) : (
                    <p className="mt-1 text-sm">{i.options.find((o) => o.value === i.value)?.label}</p>
                  )}
                  {i.value === UP_TO_AGENT && <p className="mt-1 text-xs text-src-default-text">Shows as a default nobody chose until you set it.</p>}
                </fieldset>
              ))}
            </section>

            <section className="mt-6" aria-labelledby="agent-actions">
              <h3 id="agent-actions" className="stamp text-muted-foreground">May do without asking</h3>
              {!v.actions.length && <p className="mt-2 text-sm text-muted-foreground">Its picks are free to change, so it only stops if you pause it or ask before every side effect.</p>}
              {v.actions.map((a) => (
                <fieldset key={a.key} className="mt-3">
                  <legend className="text-sm font-medium">{a.label}</legend>
                  {edit ? (
                    <RadioGroup value={a.mode} onValueChange={(m) => set({ action: a.key, mode: m as ActionMode })} className="mt-2 gap-1.5">
                      {MODES.map((m) => (
                        <label key={m} className="flex items-center gap-2 text-sm"><RadioGroupItem value={m} />{MODE_LABEL[m]}{m === "threshold" && <span className="text-muted-foreground">({a.thresholdAsks ? "asks" : "goes ahead"})</span>}</label>
                      ))}
                    </RadioGroup>
                  ) : (
                    <p className="mt-1 text-sm">{MODE_LABEL[a.mode]}{a.mode === "threshold" && ` (${a.thresholdAsks ? "asks" : "goes ahead"})`}</p>
                  )}
                </fieldset>
              ))}
            </section>

            <section className="mt-6 border-t border-border pt-4" aria-labelledby="agent-pause">
              <div className="flex items-center justify-between gap-3">
                <h3 id="agent-pause" className="text-sm font-medium">Pause this agent</h3>
                {edit ? <Switch checked={v.paused} onCheckedChange={(paused) => set({ paused })} aria-labelledby="agent-pause" /> : <span className="text-sm">{v.paused ? "Paused" : "Running"}</span>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Every step it takes waits for you, and steps that depend on it stay blocked.</p>
            </section>

            <section className="mt-6" aria-labelledby="agent-did">
              <h3 id="agent-did" className="stamp text-muted-foreground">What it did last run</h3>
              {!steps.length && <p className="mt-2 text-sm text-muted-foreground">Nothing yet.</p>}
              <ul className="mt-2 space-y-2">
                {steps.map((e) => { const chip = chipFor(e); return <li key={e.id} className="flex items-start justify-between gap-3 text-sm"><span>{e.action}</span><Chip kind={chip.kind} className="shrink-0">{chip.label}</Chip></li>; })}
              </ul>
            </section>

            <SheetFooter className="mt-auto pt-6">
              {edit ? <p className="text-xs text-muted-foreground">Changes apply to the next run, when you sign.</p> : (
                <Button asChild variant="outline"><Link to="/contract" search={{ agent: v.role }} onClick={onClose}>Change settings</Link></Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
