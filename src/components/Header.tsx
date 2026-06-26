import { useTranslation } from "react-i18next";
import { useSuspenseQuery } from "@tanstack/react-query";
import { memo, Suspense } from "react";
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

function HeaderInner() {
  const { i18n } = useTranslation();
  const lang = i18n.language ?? "pl";

  // Loader in __root.tsx prefetches this query, so useSuspenseQuery resolves
  // synchronously on hydration and on every client navigation - the header
  // never flashes a skeleton in steady state.
  const { data: settingsMap } = useSuspenseQuery(siteSettingsQueryOptions);
  const cfg = resolveSetting<HeaderSettings>(settingsMap, "header", {});
  const trending = cfg.trending ?? { enabled: true };

  if (!cfg.builder_data || !cfg.builder_data.sections?.length) return null;

  return (
    <>
      <AlertBar />
      {trending.enabled !== false && (
        <TrendingTicker days={trending.days ?? 7} limit={trending.limit ?? 8} />
      )}
      <AdZone position="header_banner" pageType="all" className="py-2 text-center" />
      <BuilderRenderer doc={cfg.builder_data} lang={lang.startsWith("pl") ? "pl" : "en"} />
    </>
  );
}

export const Header = memo(function Header() {
  // Suspense fallback only fires when the loader hasn't pre-warmed the cache
  // (e.g. routes that opt out of the prefetch). In normal navigation the
  // inner component resolves synchronously and this boundary is a no-op.
  return (
    <header
      data-site-header
      className="bg-background border-b border-border"
      style={{ viewTransitionName: "site-header" }}
    >
      <Suspense fallback={<HeaderSkeleton />}> 
        <HeaderInner />
      </Suspense>
    </header>
  );
});

Header.displayName = "Header";
