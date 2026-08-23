// Atomy kolumny "Targeting" na liście slotów: nagłówek i podsumowanie.
//
// Podsumowanie jest jedyną informacją o zawężeniu emisji widoczną BEZ wejścia
// w formularz, więc jego pusty wariant nie może być pustką - `parseAdTargeting`
// zwraca `{}` dla wszystkiego, czego nie rozumie (tablica, string, null),
// a wtedy kolumna mówi wprost "wszyscy". Puste miejsce czytałoby się jak
// "nie udało się wczytać".
//
// Prop jest CELOWO `unknown`, dokładnie jak kolumna `ad_slots.targeting` (jsonb):
// atom broni renderu sam, zamiast wymagać zawężenia od każdego wołającego.
import { useTranslation } from "react-i18next";
import { parseAdTargeting } from "@/lib/ads/types";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";

export function AdTargetingHeader() {
  ensureAdsAdminI18n();
  const { t } = useTranslation();
  return <>{t("adsAdmin.columnTargeting")}</>;
}

// Podsumowanie targetingu na liście slotów, np. "2 kat. - 1 tagi - PL".
export function AdTargetingSummary({ targeting }: { targeting: unknown }) {
  ensureAdsAdminI18n();
  const { t } = useTranslation();
  const parsed = parseAdTargeting(targeting);
  const parts: string[] = [];
  if (parsed.categorySlugs?.length) {
    parts.push(`${parsed.categorySlugs.length} ${t("adsAdmin.summaryCategories")}`);
  }
  if (parsed.tagSlugs?.length) parts.push(`${parsed.tagSlugs.length} ${t("adsAdmin.summaryTags")}`);
  if (parsed.languages?.length) parts.push(parsed.languages.map((l) => l.toUpperCase()).join("/"));
  return (
    <span className="text-xs text-muted-foreground">
      {parts.length > 0 ? parts.join(" - ") : t("adsAdmin.summaryAll")}
    </span>
  );
}
