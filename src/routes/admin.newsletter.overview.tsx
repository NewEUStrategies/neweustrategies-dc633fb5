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
import { useAuth } from "@/hooks/useAuth";
import { adminPageHead } from "@/lib/adminPageHead";
import { ensureI18n as ensureNewsletterAdminI18n } from "@/lib/i18n-newsletter-admin";
import { processDueCampaigns } from "@/lib/newsletter-campaigns.functions";
import { newsletterKeys } from "@/lib/newsletter/keys";

export const Route = createFileRoute("/admin/newsletter/overview")({
  head: () =>
    adminPageHead(
      "Newsletter - podsumowanie",
      "Wskaźniki listy subskrybentów, tryb formularzy, nadawca i reguły popupu newslettera z podglądem na żywo.",
    ),
  component: NewsletterOverview,
});

function NewsletterOverview() {
  ensureNewsletterAdminI18n();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const processDue = useServerFn(processDueCampaigns);
  const { roles } = useAuth();
  // Tick WYSYŁA pocztę - serwer wpuszcza wyłącznie administratora i redaktora
  // (S1 def. 10). Autor nie wysyła więc żądania, które zawsze zostałoby odrzucone.
  const canSend = roles.includes("admin") || roles.includes("editor");

  // Opportunistic tick: raz przy montowaniu, fire-and-forget. Toast tylko
  // gdy faktycznie coś zostało wysłane.
  const tickRan = useRef(false);
  useEffect(() => {
    if (tickRan.current || !canSend) return;
    tickRan.current = true;
    processDue()
      .then((res) => {
        if (res.fired > 0) {
          // Ten sam komunikat co przycisk "Wyślij zaległe" na liście kampanii -
          // jeden klucz, nie dwa niezależnie tłumaczone szablony napisu.
          toast.success(t("adminNewsletter.campaigns.dueFired", { count: res.fired }));
          qc.invalidateQueries({ queryKey: newsletterKeys.campaignsAll() });
        }
      })
      .catch(() => undefined);
  }, [processDue, qc, t, canSend]);

  return <OverviewPanel />;
}
