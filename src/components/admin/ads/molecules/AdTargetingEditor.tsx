// Molekuła: edytor kolumny `ad_slots.targeting`.
//
// Katalog zainteresowań przychodzi PROPSEM, a nie z `useInterestCatalog` -
// dzięki temu molekuła nie zna ani react-query, ani Supabase i jej dowód
// (co robi kliknięcie chipa) nie potrzebuje ani jednego mocka warstwy danych.
// Wybór języka katalogu został w organizmie, bo to on wie, jaki jest język
// interfejsu.
//
// Chipy zapisują SLUGI, nie identyfikatory: kontekst strony ma slugi pod ręką
// bez dodatkowego zapytania (patrz komentarz w `lib/ads/types.ts`). Tag jest
// pokazywany z prefiksem "#", wersja językowa wielkimi literami.
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import type { AdTargeting } from "@/lib/ads/types";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";
import { AdTargetingChip } from "../atoms/AdTargetingChip";

/** Pozycja katalogu w kształcie, w jakim edytor jej potrzebuje. */
export interface AdTargetingCatalogItem {
  id: string;
  slug: string;
  label: string;
}

export function AdTargetingEditor({
  value,
  onChange,
  categories,
  tags,
}: {
  value: AdTargeting;
  onChange: (next: AdTargeting) => void;
  categories: AdTargetingCatalogItem[];
  tags: AdTargetingCatalogItem[];
}) {
  ensureAdsAdminI18n();
  const { t } = useTranslation();

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
          {categories.map((c) => (
            <AdTargetingChip
              key={c.id}
              label={c.label}
              active={(value.categorySlugs ?? []).includes(c.slug)}
              onToggle={() =>
                onChange({ ...value, categorySlugs: toggleIn(value.categorySlugs, c.slug) })
              }
            />
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium">{t("adsAdmin.tags")}</p>
        <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
          {tags.map((tg) => (
            <AdTargetingChip
              key={tg.id}
              label={`#${tg.label}`}
              active={(value.tagSlugs ?? []).includes(tg.slug)}
              onToggle={() => onChange({ ...value, tagSlugs: toggleIn(value.tagSlugs, tg.slug) })}
            />
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium">{t("adsAdmin.languages")}</p>
        <div className="flex gap-1.5">
          {(["pl", "en"] as const).map((l) => (
            <AdTargetingChip
              key={l}
              label={l.toUpperCase()}
              active={(value.languages ?? []).includes(l)}
              onToggle={() => {
                const set = new Set(value.languages ?? []);
                if (set.has(l)) set.delete(l);
                else set.add(l);
                onChange({ ...value, languages: Array.from(set) });
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
