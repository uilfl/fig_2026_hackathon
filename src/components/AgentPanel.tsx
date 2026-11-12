import { Link } from "@tanstack/react-router";
import type { Contract } from "@/lib/engine";
import type { AgentRole, Scenario } from "@/lib/scenarios";
import {
  agentSettings,
  agentSteps,
  agentSummary,
  withAgentSetting,
  UP_TO_AGENT,
  type AgentChange,
  type InstructionOption,
} from "@/lib/agents";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/AgentChat";
import { Chip, chipFor } from "@/components/Chip";
import { PANEL_TEXT as T } from "@/components/AgentPanel.constants";

type Row = {
  id: string;
  agent: string;
  action: string;
  source: string;
  status: string;
  resolution: string | null;
  preview: unknown;
};

/** One choice as a card: label, optional muted hint; "Let the agent decide" gets the dashed default style. */
function OptionCard({
  o,
  checked,
  edit,
}: {
  o: InstructionOption;
  checked: boolean;
  edit: boolean;
}) {
  const isDefault = o.value === UP_TO_AGENT;
  const tone = checked
    ? isDefault
      ? "border-dashed border-src-default bg-card"
      : "border-foreground bg-card"
    : "border-border";
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 border p-3 transition-colors duration-150 ${tone}`}
    >
      {edit && <RadioGroupItem value={o.value} className="mt-0.5" />}
      <span className="flex flex-col">
        <span
          className={`text-sm ${checked ? "font-medium" : ""} ${isDefault && checked ? "text-src-default-text" : ""}`}
        >
          {o.label}
        </span>
        {o.hint && <span className="font-mono text-[11px] text-muted-foreground">{o.hint}</span>}
      </span>
    </label>
  );
}

/**
 * One agent's settings, as a view of the contract. `onChange` given = editable (Contract page, writes the draft);
 * otherwise read-only with a link to change them on the Contract page.
 */
export function AgentPanel({
  role,
  onClose,
  S,
  contract,
  run,
  onChange,
}: {
  role: AgentRole | null;
  onClose: () => void;
  S: Scenario;
  contract: Contract;
  run: Row[];
  onChange?: (next: Contract) => void;
}) {
  const v = role ? agentSettings(contract, S, role) : null;
  const steps = role ? agentSteps(run, S, role).filter((e) => e.status !== "superseded") : [];
  const set = (change: AgentChange) => {
    if (role && onChange) onChange(withAgentSetting(contract, S, role, change));
  };
  const edit = !!onChange;
  return (
    <Sheet
      open={!!role}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent className="flex flex-col overflow-y-auto">
        {v && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <Avatar who={v.name} S={S} />
                <SheetTitle>{v.name}</SheetTitle>
                {v.paused && <Chip kind="waiting">{T.paused}</Chip>}
              </div>
              <SheetDescription>{v.job}</SheetDescription>
              <p className="mt-2 border-l-2 border-border pl-3 text-sm">
                {agentSummary(contract, S, v.role)}
              </p>
            </SheetHeader>

            <section className="mt-6" aria-labelledby="agent-instructions">
              <h3 id="agent-instructions" className="stamp text-muted-foreground">
                {T.decides}
              </h3>
              {!v.instructions.length && (
                <p className="mt-2 text-sm text-muted-foreground">{T.decidesEmpty}</p>
              )}
              {v.instructions.map((i) => {
                const current = i.options.find((o) => o.value === i.value);
                return (
                  <fieldset key={i.key} className="mt-4">
                    <legend className="text-sm font-medium">{i.title}</legend>
                    {edit ? (
                      <RadioGroup
                        value={i.value}
                        onValueChange={(value) => set({ instruction: i.key, value })}
                        className="mt-2 gap-2"
                      >
                        {i.options.map((o) => (
                          <OptionCard key={o.value} o={o} checked={o.value === i.value} edit />
                        ))}
                      </RadioGroup>
                    ) : (
                      current && (
                        <div className="mt-2">
                          <OptionCard o={current} checked edit={false} />
                        </div>
                      )
                    )}
                    {i.value === UP_TO_AGENT && (
                      <p className="mt-1.5 text-xs text-src-default-text">{T.defaultNote}</p>
                    )}
                  </fieldset>
                );
              })}
            </section>

            <section className="mt-6" aria-labelledby="agent-actions">
              <h3 id="agent-actions" className="stamp text-muted-foreground">
                {T.stops}
              </h3>
              {!v.actions.length && (
                <p className="mt-2 text-sm text-muted-foreground">{T.stopsEmpty}</p>
              )}
              <ul className="mt-2 divide-y divide-border border border-border">
                {v.actions.map((a) => {
                  const id = `ask-${a.key}`;
                  return (
                    <li key={a.key} className="p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span id={id} className="text-sm font-medium">
                          {a.label}
                        </span>
                        {edit ? (
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            {T.askSwitch}
                            <Switch
                              checked={a.asks}
                              onCheckedChange={(asks) => set({ action: a.key, asks })}
                              aria-labelledby={id}
                              aria-describedby={`${id}-note`}
                            />
                          </label>
                        ) : (
                          <span className="text-sm">
                            {a.asks ? T.readAsks : T.readGoes}
                            {!a.overridden && (
                              <span className="text-muted-foreground">{T.readContract}</span>
                            )}
                          </span>
                        )}
                      </div>
                      {edit && (
                        <p
                          id={`${id}-note`}
                          className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          {a.overridden
                            ? T.changedFromContract(a.thresholdAsks)
                            : T.followsContract(a.thresholdAsks)}
                          {a.overridden && (
                            <button
                              type="button"
                              className="underline underline-offset-4 hover:text-foreground"
                              onClick={() => set({ action: a.key, mode: "threshold" })}
                            >
                              {T.reset}
                            </button>
                          )}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            <section
              className={`mt-6 border p-3 ${v.paused ? "border-src-pending" : "border-border"}`}
              aria-labelledby="agent-pause"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 id="agent-pause" className="text-sm font-medium">
                  {T.pause}
                </h3>
                {edit ? (
                  <Switch
                    checked={v.paused}
                    onCheckedChange={(paused) => set({ paused })}
                    aria-labelledby="agent-pause"
                  />
                ) : (
                  <span className="text-sm">{v.paused ? T.paused : T.running}</span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{T.pauseNote}</p>
            </section>

            <section className="mt-6" aria-labelledby="agent-did">
              <h3 id="agent-did" className="stamp text-muted-foreground">
                {T.lastRun}
              </h3>
              {!steps.length && (
                <p className="mt-2 text-sm text-muted-foreground">{T.lastRunEmpty}</p>
              )}
              <ul className="mt-2 space-y-2">
                {steps.map((e) => {
                  const chip = chipFor(e);
                  return (
                    <li key={e.id} className="flex items-start justify-between gap-3 text-sm">
                      <span>{e.action}</span>
                      <Chip kind={chip.kind} className="shrink-0">
                        {chip.label}
                      </Chip>
                    </li>
                  );
                })}
              </ul>
            </section>

            <SheetFooter className="mt-auto pt-6">
              {edit ? (
                <p className="text-xs text-muted-foreground">{T.footerEdit}</p>
              ) : (
                <Button asChild variant="outline">
                  <Link to="/contract" search={{ agent: v.role }} onClick={onClose}>
                    {T.change}
                  </Link>
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
