// /admin/newsletter/email-content - edycja treści maili karencji i końca dostępu (PL/EN).
import { createFileRoute } from "@tanstack/react-router";
import { TxEmailContentPanel } from "@/components/admin/newsletter/system-emails/TxEmailContentPanel";

export const Route = createFileRoute("/admin/newsletter/email-content")({
  component: TxEmailContentPanel,
});
