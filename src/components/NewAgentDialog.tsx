import { useState } from "react";
import type { Contract } from "@/lib/engine";
import type { Scenario } from "@/lib/scenarios";
import { AGENT_NAME_MAX, AGENT_NOTE_MAX, agentNameError } from "@/lib/agents";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { NEW_AGENT_TEXT as T } from "@/components/NewAgentDialog.constants";

/** Name + note for a user-added agent. Validation comes from `agentNameError`; the page adds it to the draft. */
export function NewAgentDialog({
  open,
  onOpenChange,
  contract,
  S,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: Contract;
  S: Scenario;
  onCreate: (a: { name: string; note: string }) => void;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const error = agentNameError(contract, S, name);
  const close = (o: boolean) => {
    if (!o) {
      setName("");
      setNote("");
      setTouched(false);
    }
    onOpenChange(o);
  };
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setTouched(true);
    if (error) return;
    onCreate({ name, note });
    close(false);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{T.title}</DialogTitle>
            <DialogDescription>{T.description}</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div>
              <div className="flex items-baseline justify-between">
                <Label htmlFor="agent-name">{T.name}</Label>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {T.count(name.trim().length, AGENT_NAME_MAX)}
                </span>
              </div>
              <Input
                id="agent-name"
                className="mt-1.5"
                value={name}
                maxLength={AGENT_NAME_MAX + 10}
                placeholder={T.namePlaceholder}
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  setTouched(true);
                }}
                aria-invalid={touched && !!error}
                aria-describedby={touched && error ? "agent-name-error" : undefined}
              />
              {touched && error && (
                <p id="agent-name-error" className="mt-1 text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <Label htmlFor="agent-note">{T.note}</Label>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {T.count(note.length, AGENT_NOTE_MAX)}
                </span>
              </div>
              <Textarea
                id="agent-note"
                className="mt-1.5"
                rows={3}
                value={note}
                maxLength={AGENT_NOTE_MAX}
                placeholder={T.notePlaceholder}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              {T.cancel}
            </Button>
            <Button type="submit" disabled={!!error}>
              {T.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
