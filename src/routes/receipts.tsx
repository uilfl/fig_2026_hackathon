import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/receipts")({
  beforeLoad: () => { throw redirect({ to: "/ledger" }); },
});
