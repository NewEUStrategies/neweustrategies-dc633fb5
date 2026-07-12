// Shared "Wygląd / Appearance" area sub-nav. The design settings used to be
// scattered across four unrelated screens (appearance, theme options, brand
// tokens, post layouts); mounting this bar at the top of each makes them read
// as one area WITHOUT merging the route files. Presentational only — it mirrors
// NewsletterSubNav (TanStack Link + useRouterState for active detection,
// bilingual via react-i18next) and reuses existing i18n keys for tab labels.
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PanelsTopLeft, Palette, LayoutGrid, Brush } from "@/lib/lucide-shim";

const tabs = [
  {
    to: "/admin/appearance/header",
    match: "/admin/appearance",
    icon: PanelsTopLeft,
    i18nKey: "admin.nav.appearance",
  },
  {
    to: "/admin/theme-options",
    match: "/admin/theme-options",
    icon: Palette,
    i18nKey: "admin.nav.themeOptions",
  },
  {
    to: "/admin/settings/design",
    match: "/admin/settings/design",
    icon: Brush,
    i18nKey: "admin.settingsNav.design",
  },
  {
    to: "/admin/post-layouts",
    match: "/admin/post-layouts",
    icon: LayoutGrid,
    i18nKey: "admin.nav.postLayouts",
  },
] as const;

export function DesignSubNav() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="sticky top-0 z-30 mb-4 py-3 bg-background/95 backdrop-blur border-b border-border">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 pr-3 mr-1 border-r border-border/60">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Palette className="w-4 h-4 text-primary" />
          </div>
          <h1 className="font-display text-base sm:text-lg leading-none">
            {t("admin.navGroups.design")}
          </h1>
        </div>
        <nav className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border/60">
          {tabs.map((tab) => {
            const active = pathname.startsWith(tab.match);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors " +
                  (active
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="w-3.5 h-3.5" />
                {t(tab.i18nKey)}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
