// /admin/newsletter/system-emails - log wysyłek i raport dostarczalności
// maili systemowych (autoryzacja + transakcyjne).
import { createFileRoute } from "@tanstack/react-router";
import { SystemEmailsPanel } from "@/components/admin/newsletter/system-emails/SystemEmailsPanel";

export const Route = createFileRoute("/admin/newsletter/system-emails")({
  component: SystemEmailsPanel,
});
