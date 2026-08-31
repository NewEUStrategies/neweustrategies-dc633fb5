// Molekula: podsumowanie targetingu slotu na liscie.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-ads-admin";
import { parseAdTargeting, type AdSlot } from "@/lib/ads/types";

// Podsumowanie targetingu na liście slotów, np. "2 kat. - 1 tagi - PL".
export function TargetingSummary({ slot }: { slot: AdSlot }) {
  const { t } = useTranslation();
  const parsed = parseAdTargeting(slot.targeting);
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
