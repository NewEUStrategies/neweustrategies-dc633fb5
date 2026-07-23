// Edytor flag `membership_tiers.features` sterowany rejestrem capabilities
// (lib/billing/capabilities) - koniec z ręcznym wpisywaniem JSON-a z pamięci.
// Każda flaga z rejestru to przełączany chip: zielony = egzekwowana realną
// bramką, szary = deklaracja marketingowa; tooltip pokazuje punkt egzekwowania.
// Komponent edytuje ten sam string-draft co surowe pole JSON (flagi spoza
// rejestru i wartości nie-boolowskie przechodzą nietknięte), więc oba widoki
// nigdy się nie rozjeżdżają.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { TIER_CAPABILITIES } from "@/lib/billing/capabilities";
import { ensureI18n as ensureAdminPricingI18n } from "@/lib/i18n-admin-pricing";

function parseDraft(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function TierFeatureTogglesEditor({
  value,
  onChange,
  disabled,
}: {
  /** Draft pola features jako string JSON (współdzielony z polem surowym). */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  ensureAdminPricingI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const flags = useMemo(() => parseDraft(value), [value]);

  const toggle = (key: string) => {
    const next: Record<string, unknown> = { ...flags };
    if (next[key] === true) delete next[key];
    else next[key] = true;
    onChange(JSON.stringify(next));
  };

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t("adminMembership.fields.featuresKnown")}>
      {TIER_CAPABILITIES.map((cap) => {
        const enabled = flags[cap.key] === true;
        const where = lang === "en" ? cap.where_en : cap.where_pl;
        return (
          <li key={cap.key}>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={enabled}
              title={where}
              onClick={() => toggle(cap.key)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                enabled
                  ? cap.enforced
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border bg-muted text-foreground"
                  : "border-dashed border-border/70 bg-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {cap.enforced ? (
                <Check className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Info className="h-3 w-3" aria-hidden="true" />
              )}
              <span className="font-mono">{cap.key}</span>
              <span className="opacity-70">
                {cap.enforced
                  ? t("adminPricing.capabilities.enforced")
                  : t("adminPricing.capabilities.decorative")}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
