// /admin/newsletter/overview - KPI, logika, tryb, dual preview.
// To domyślna strona sekcji newslettera (/admin/newsletter -> redirect tutaj),
// więc montuje się jako pierwsza - dlatego to również tu odpala się
// opportunistic tick `processDueCampaigns` (wysyłka zaległych zaplanowanych
// kampanii; fallback zamiast pg_cron, patrz docs/ARCHITECTURE.md §2.6).
import { useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { OverviewPanel } from "@/components/admin/newsletter/OverviewPanel";
import { ensureI18n as ensureNewsletterAdminI18n } from "@/lib/i18n-newsletter-admin";
import { processDueCampaigns } from "@/lib/newsletter-campaigns.functions";

export const Route = createFileRoute("/admin/newsletter/overview")({
  component: NewsletterOverview,
});

function NewsletterOverview() {
  ensureNewsletterAdminI18n();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const processDue = useServerFn(processDueCampaigns);

  // Opportunistic tick: raz przy montowaniu, fire-and-forget. Toast tylko
  // gdy faktycznie coś zostało wysłane.
  const tickRan = useRef(false);
  useEffect(() => {
    if (tickRan.current) return;
    tickRan.current = true;
    processDue()
      .then((res) => {
        if (res.fired > 0) {
          // Ten sam komunikat co przycisk "Wyślij zaległe" na liście kampanii -
          // jeden klucz, nie dwa niezależnie tłumaczone szablony napisu.
          toast.success(t("adminNewsletter.campaigns.dueFired", { count: res.fired }));
          qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
        }
      })
      .catch(() => undefined);
  }, [processDue, qc, t]);

  return <OverviewPanel />;
}
