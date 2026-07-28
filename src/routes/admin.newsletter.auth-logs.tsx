// /admin/newsletter/auth-logs - diagnostyka webhooka maili autoryzacyjnych
// (język i jego źródło, typ, nadawca, temat, redirect_to).
import { createFileRoute } from "@tanstack/react-router";
import { AuthEmailLogsPanel } from "@/components/admin/newsletter/auth-logs/AuthEmailLogsPanel";

export const Route = createFileRoute("/admin/newsletter/auth-logs")({
  component: AuthEmailLogsPanel,
});
