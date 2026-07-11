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
import { processDueCampaigns } from "@/lib/newsletter-campaigns.functions";

export const Route = createFileRoute("/admin/newsletter/overview")({
  component: NewsletterOverview,
});

function NewsletterOverview() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
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
          toast.success(
            isPl
              ? `Wysłano ${res.fired} zaplanowanych kampanii`
              : `Sent ${res.fired} scheduled campaigns`,
          );
          qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
        }
      })
      .catch(() => undefined);
  }, [processDue, qc, isPl]);

  return <OverviewPanel />;
}
