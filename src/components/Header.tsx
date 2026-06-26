import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import type { BuilderDocument } from "@/lib/builder/types";
import { AlertBar } from "@/components/AlertBar";
import { AdZone } from "@/components/AdSlot";
import { TrendingTicker } from "@/components/header/TrendingTicker";
import { HeaderSkeleton } from "@/components/header/HeaderSkeleton";

type HeaderSettings = {
  builder_data?: BuilderDocument | null;
  trending?: { enabled?: boolean; days?: number; limit?: number };
};

export function Header() {
  const { i18n } = useTranslation();
  const lang = i18n.language ?? "pl";

  // Read directly from the shared bulk site_settings query so we can observe
  // pending state and render a skeleton instead of `null` (which caused the
  // "pop-in" on slow connections). The same query also feeds Footer, nav,
  // AlertBar - prefetching it once in __root.tsx hydrates the whole chrome.
  const { data: settingsMap, isPending } = useQuery(siteSettingsQueryOptions);
  const cfg = resolveSetting<HeaderSettings>(settingsMap, "header", {});
  const trending = cfg.trending ?? { enabled: true };

  if (isPending) return <HeaderSkeleton />;
  if (!cfg.builder_data || !cfg.builder_data.sections?.length) return null;

  return (
    <header className="bg-background border-b border-border">
      <AlertBar />
      {trending.enabled !== false && (
        <TrendingTicker days={trending.days ?? 7} limit={trending.limit ?? 8} />
      )}
      <AdZone position="header_banner" pageType="all" className="py-2 text-center" />
      <BuilderRenderer doc={cfg.builder_data} lang={lang.startsWith("pl") ? "pl" : "en"} />
    </header>
  );
}
