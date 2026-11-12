import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { resourceAnswers } from "@/lib/receipt";

export type ChipKind =
  | "you"
  | "approved"
  | "contract"
  | "resource"
  | "default"
  | "waiting"
  | "blocked"
  | "superseded"
  | "neutral";
const STYLE: Record<ChipKind, string> = {
  you: "text-src-user",
  approved: "text-src-approved",
  contract: "text-src-contract",
  resource: "text-src-resource",
  default: "text-src-default-text border-dashed",
  waiting: "text-src-pending-text",
  blocked: "text-muted-foreground",
  superseded: "text-muted-foreground line-through",
  neutral: "text-muted-foreground",
};
/** Text style for a chip kind, for places that render their own `stamp` (e.g. map nodes, trace rows). */
export const chipClass = (kind: ChipKind) => STYLE[kind];
export const CHIP_LABEL: Record<Exclude<ChipKind, "neutral">, string> = {
  you: "You chose",
  approved: "Approved",
  contract: "Contract rule",
  resource: "From a resource",
  default: "Default · nobody chose",
  waiting: "Waiting on you",
  blocked: "Blocked",
  superseded: "Superseded",
};

/** The one status chip set used across Run, Contract and Receipts. */
export function Chip({
  kind,
  children,
  className,
}: {
  kind: ChipKind;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "stamp inline-flex shrink-0 items-center gap-1 whitespace-nowrap",
        STYLE[kind],
        className,
      )}
    >
      {kind === "blocked" && <Lock className="h-3 w-3" aria-hidden />}
      {children ?? (kind === "neutral" ? null : CHIP_LABEL[kind])}
    </span>
  );
}

type RowLike = {
  source: string;
  status: string;
  resolution: string | null;
  preview: unknown;
  criteria?: unknown;
};
/** Map a ledger row to a chip kind + label. */
export function chipFor(e: RowLike): { kind: ChipKind; label: string } {
  const p = e.preview as { saved_scope?: boolean } | null;
  if (e.status === "superseded") return { kind: "superseded", label: "Superseded" };
  if (e.status === "pending") return { kind: "waiting", label: "Waiting on you" };
  if (e.status === "blocked") return { kind: "blocked", label: "Blocked" };
  if (e.status === "declined") return { kind: "you", label: "You declined" };
  if (e.status === "cancelled") return { kind: "blocked", label: "Stopped" };
  if (e.status === "expired") return { kind: "neutral", label: "Expired" };
  if (e.source === "approved")
    return { kind: "approved", label: p?.saved_scope ? "Approved · saved scope" : "Approved" };
  if (e.source === "user") return { kind: "you", label: "You chose" };
  if (e.source === "contract") return { kind: "contract", label: "Contract rule" };
  if (e.source === "resource") {
    const name = resourceAnswers(e)[0]?.resource;
    return { kind: "resource", label: name ? `From ${name}` : CHIP_LABEL.resource };
  }
  if (e.source === "default") {
    const r = e.resolution;
    if (!r) return { kind: "default", label: "Default · nobody chose" };
    if (r === "keep") return { kind: "contract", label: "Kept as rule" };
    if (r === "once") return { kind: "you", label: "You accepted once" };
    if (r.startsWith("override:")) return { kind: "you", label: `You overrode → ${r.slice(9)}` };
    return { kind: "waiting", label: "You flagged: should have asked" };
  }
  return { kind: "neutral", label: e.source };
}
