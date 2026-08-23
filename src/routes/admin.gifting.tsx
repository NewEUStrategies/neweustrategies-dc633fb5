// Panel admina - Gift Articles. Trzy zakladki: Ustawienia (per tenant),
// Linki (przeglad + cofanie), Audyt (log zdarzen created/redeemed/revoked).
// Modul jest domena admin/editor: server functions przechodza przez
// requireAdminEditor, a baza re-waliduje role i tenant w RLS/SECURITY DEFINER
// RPC.
//
// Po ekstrakcji (atomic design) trasa jest KOMPOZYCJA: kafle statystyk stoja
// NAD nawigacja (przelaczanie zakladek ich nie odmontowuje), a trzy organizmy
// z src/components/admin/gifting/organisms trzymaja wlasna warstwe danych.
// Formularz ustawien pracuje na drafcie z lib/gifting/admin-model - jedno
// zrodlo prawdy dla zakresow (lustro CHECK-ow SQL), walidacji i semantyki
// "0 = bez limitu" (puste pole nigdy nie staje sie cichym zerem).
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Gift } from "lucide-react";
import { GiftTabNav } from "@/components/admin/gifting/molecules/GiftTabNav";
import { GiftAuditPanel } from "@/components/admin/gifting/organisms/GiftAuditPanel";
import { GiftLinksPanel } from "@/components/admin/gifting/organisms/GiftLinksPanel";
import { GiftSettingsPanel } from "@/components/admin/gifting/organisms/GiftSettingsPanel";
import { GiftStatsPanel } from "@/components/admin/gifting/organisms/GiftStatsPanel";
import { ensureI18n as ensureGiftingAdminI18n } from "@/lib/i18n-gifting-admin";
import { uiLocale } from "@/lib/i18n/format";

export const Route = createFileRoute("/admin/gifting")({
  component: GiftingAdmin,
});

type Tab = "settings" | "links" | "audit";

function GiftingAdmin() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-gifting-admin.ts.
  ensureGiftingAdminI18n();
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("settings");
  const lang = i18n.language === "en" ? "en" : "pl";
  const dateLocale = uiLocale(lang);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "settings", label: t("giftingAdmin.tabs.settings") },
    { id: "links", label: t("giftingAdmin.tabs.links") },
    { id: "audit", label: t("giftingAdmin.tabs.audit") },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold flex items-center gap-3">
          <Gift className="w-7 h-7 text-brand" aria-hidden />
          {t("giftingAdmin.title")}
        </h1>
        <p className="text-muted-foreground mt-1">{t("giftingAdmin.subtitle")}</p>
      </div>

      <GiftStatsPanel />

      <GiftTabNav tabs={tabs} active={tab} onSelect={setTab} />

      {tab === "settings" && <GiftSettingsPanel />}
      {tab === "links" && <GiftLinksPanel dateLocale={dateLocale} />}
      {tab === "audit" && <GiftAuditPanel dateLocale={dateLocale} />}
    </div>
  );
}
