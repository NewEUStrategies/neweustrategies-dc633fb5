// Trasa rejestru monetyzacji (wpłaty, przydziały członkostwa, linki prezentowe).
// Osobno od /admin/monetization, który jest dashboardem metryk.
import { createFileRoute } from "@tanstack/react-router";

import { AdminMonetizationLedger } from "@/components/admin/monetization/organisms/AdminMonetizationLedger";
import { ensureI18n as ensureMonetizationI18n } from "@/lib/i18n-admin-monetization";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";

export const Route = createFileRoute("/admin/monetization-ledger")({
  head: () => {
    // head() biegnie POZA drzewem Reacta i poza dostawcą i18next, więc `t()` tu
    // nie istnieje - język bierzemy z adresu przez `activeLang`. Trasy /admin są
    // w NON_LOCALIZED_PREFIXES, więc w praktyce rozstrzyga ciasteczko języka; to
    // jednak ta sama wartość, którą widzi ciało strony, a o zgodność karty
    // przeglądarki z interfejsem tu właśnie chodzi.
    const lang = activeLang(getRequestUrl() || "/admin/monetization-ledger");
    return {
      meta: [
        {
          title: lang === "en" ? "Monetization - ledger | Panel" : "Monetyzacja - rejestr | Panel",
        },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
  component: AdminMonetizationLedgerPage,
});

function AdminMonetizationLedgerPage() {
  ensureMonetizationI18n();
  return <AdminMonetizationLedger />;
}
