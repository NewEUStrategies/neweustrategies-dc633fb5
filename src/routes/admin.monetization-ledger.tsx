// Trasa rejestru monetyzacji (wpłaty, przydziały członkostwa, linki prezentowe).
// Osobno od /admin/monetization, który jest dashboardem metryk.
import { createFileRoute } from "@tanstack/react-router";

import { AdminMonetizationLedger } from "@/components/admin/monetization/organisms/AdminMonetizationLedger";
import { ensureI18n as ensureMonetizationI18n } from "@/lib/i18n-admin-monetization";

export const Route = createFileRoute("/admin/monetization-ledger")({
  head: () => ({
    meta: [
      { title: "Monetyzacja - rejestr | Panel" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminMonetizationLedgerPage,
});

function AdminMonetizationLedgerPage() {
  ensureMonetizationI18n();
  return <AdminMonetizationLedger />;
}
