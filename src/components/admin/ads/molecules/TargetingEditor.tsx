// Molekula: edytor kolumny `ad_slots.targeting`.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-ads-admin";
import { Label } from "@/components/ui/label";
import { useInterestCatalog } from "@/hooks/useInterests";
import type { AdLanguage, AdTargeting } from "@/lib/ads/types";
import { chipClass } from "../model";

// Edytor kolumny ad_slots.targeting: chipy kategorii/tagów (katalog
// zainteresowań) + przełączniki wersji językowych.
export function TargetingEditor({
  value,
  onChange,
}: {
  value: AdTargeting;
  onChange: (next: AdTargeting) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang: AdLanguage = i18n.language === "en" ? "en" : "pl";
  const catalog = useInterestCatalog(lang);

  const toggleIn = (list: string[] | undefined, slug: string): string[] => {
    const set = new Set(list ?? []);
    if (set.has(slug)) set.delete(slug);
    else set.add(slug);
    return Array.from(set);
  };

  return (
    <div className="sm:col-span-2 space-y-3 rounded-md border border-border p-3">
      <div>
        <Label className="mb-0">{t("adsAdmin.targetingTitle")}</Label>
        <p className="mt-1 text-xs text-muted-foreground">{t("adsAdmin.targetingHint")}</p>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium">{t("adsAdmin.categories")}</p>
        <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
          {(catalog.data?.categories ?? []).map((c) => {
            const active = (value.categorySlugs ?? []).includes(c.slug);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onChange({ ...value, categorySlugs: toggleIn(value.categorySlugs, c.slug) })
                }
                className={chipClass(active)}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium">{t("adsAdmin.tags")}</p>
        <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
          {(catalog.data?.tags ?? []).map((tg) => {
            const active = (value.tagSlugs ?? []).includes(tg.slug);
            return (
              <button
                key={tg.id}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ ...value, tagSlugs: toggleIn(value.tagSlugs, tg.slug) })}
                className={chipClass(active)}
              >
                #{tg.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium">{t("adsAdmin.languages")}</p>
        <div className="flex gap-1.5">
          {(["pl", "en"] as const).map((l) => {
            const active = (value.languages ?? []).includes(l);
            return (
              <button
                key={l}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  const set = new Set(value.languages ?? []);
                  if (set.has(l)) set.delete(l);
                  else set.add(l);
                  onChange({ ...value, languages: Array.from(set) });
                }}
                className={chipClass(active)}
              >
                {l.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
