// Organizm: cala strona panelu prezentow (naglowek, statystyki, zakladki).
// Trasa `src/routes/admin.gifting.tsx` jest juz cienkim opakowaniem.
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Gift } from "lucide-react";
import { ensureI18n as ensureGiftingAdminI18n } from "@/lib/i18n-gifting-admin";
import { uiLocale } from "@/lib/i18n/format";
import { AuditPanel } from "./AuditPanel";
import { LinksPanel } from "./LinksPanel";
import { SettingsPanel } from "./SettingsPanel";
import { StatsPanel } from "./StatsPanel";

export type Tab = "settings" | "links" | "audit";

export function GiftingAdmin() {
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

      <StatsPanel />

      <div className="border-b border-border">
        <nav className="flex gap-1" role="tablist">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-[6px] transition-colors ${
                tab === x.id
                  ? "border-b-2 border-brand text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {x.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "settings" && <SettingsPanel />}
      {tab === "links" && <LinksPanel dateLocale={dateLocale} />}
      {tab === "audit" && <AuditPanel dateLocale={dateLocale} />}
    </div>
  );
}
