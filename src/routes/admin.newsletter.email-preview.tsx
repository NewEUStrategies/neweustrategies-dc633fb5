// /admin/newsletter/email-preview - podgląd szablonów maili autoryzacyjnych (PL/EN).
import { createFileRoute } from "@tanstack/react-router";
import { AuthEmailPreviewPanel } from "@/components/admin/newsletter/system-emails/AuthEmailPreviewPanel";

export const Route = createFileRoute("/admin/newsletter/email-preview")({
  component: AuthEmailPreviewPanel,
});
