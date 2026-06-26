import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { LayoutDashboard, FileText, File, FolderTree, Tags, Users, Image as ImageIcon, LogOut, Home, Moon, Sun, Globe, Settings, PanelLeft, Star, Mail, Bookmark, ChevronRight, Lock, Palette, LayoutGrid, Sparkles, PanelsTopLeft, Newspaper, Megaphone, Mic, Film, Brush, Wand2, Share2 } from "@/lib/lucide-shim";
import { useTheme } from "@/components/ThemeProvider";
import { AdminLangBar } from "@/components/admin/AdminLangBar";
import { useState, type ReactNode } from "react";
import { AdminSidebarExtrasProvider, useAdminSidebarExtrasSlot } from "@/components/admin/AdminSidebarExtras";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { cn } from "@/lib/utils";

import type { SidebarStyle } from "@/lib/builder/sidebarStyles";

type SidebarLogoCfg = {
  logo: {
    sidebar_icon: string; sidebar_icon_dark: string;
    sidebar_expanded: string; sidebar_expanded_dark: string;
    main: string; main_dark: string;
  };
  sidebars?: { style?: SidebarStyle };
};
const SIDEBAR_LOGO_DEFAULTS: SidebarLogoCfg = {
  logo: { sidebar_icon: "", sidebar_icon_dark: "", sidebar_expanded: "", sidebar_expanded_dark: "", main: "", main_dark: "" },
  sidebars: { style: "style-1" },
};


export function AdminShell({ children, hideSidebar }: { children: ReactNode; hideSidebar?: boolean }) {
  return (
    <AdminSidebarExtrasProvider>
      <AdminShellInner hideSidebar={hideSidebar}>{children}</AdminShellInner>
    </AdminSidebarExtrasProvider>
  );
}

function AdminShellInner({ children, hideSidebar }: { children: ReactNode; hideSidebar?: boolean }) {

  const { t, i18n } = useTranslation();
  const { signOut, user, isAdmin } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const lang = i18n.language ?? "pl";
  const { extras } = useAdminSidebarExtrasSlot();
  const themeOpts = useSiteSetting<SidebarLogoCfg>("theme_options", SIDEBAR_LOGO_DEFAULTS);
  const sidebarStyle = themeOpts.sidebars?.style ?? "style-1";


  const isEditRoute = /^\/admin\/(posts|pages)\/[^/]+$/.test(path) || path.startsWith("/admin/appearance");
  const isThemeOptions = path.startsWith("/admin/theme-options");
  const [forceCompact, setForceCompact] = useState(false);
  const compact = ((isEditRoute || forceCompact) && !extras) || sidebarStyle === "style-4";


  type NavItem = { to: string; icon: typeof LayoutDashboard; label: string };
  type NavGroup = { id: string; label?: string; items: NavItem[] };

  const groups: NavGroup[] = [
    {
      id: "overview",
      items: [{ to: "/admin", icon: LayoutDashboard, label: t("admin.nav.dashboard") }],
    },
    {
      id: "content",
      label: t("admin.navGroups.content"),
      items: [
        { to: "/admin/posts", icon: Newspaper, label: t("admin.nav.posts") },
        { to: "/admin/pages", icon: File, label: t("admin.nav.pages") },
        { to: "/admin/media", icon: ImageIcon, label: t("admin.nav.media") },
        { to: "/admin/categories", icon: FolderTree, label: t("admin.nav.categories") },
        { to: "/admin/tags", icon: Tags, label: t("admin.nav.tags") },
        { to: "/admin/content-area", icon: FileText, label: t("admin.nav.contentArea") },
      ],
    },
    {
      id: "monetization",
      label: t("admin.navGroups.monetization"),
      items: [
        { to: "/admin/paywall", icon: Lock, label: t("admin.nav.paywall") },
        { to: "/admin/ads", icon: Megaphone, label: t("admin.nav.ads") },
      ],
    },
    {
      id: "engagement",
      label: t("admin.navGroups.engagement"),
      items: [
        { to: "/admin/newsletter", icon: Mail, label: t("admin.nav.newsletter") },
        { to: "/admin/podcasts", icon: Mic, label: t("admin.nav.podcasts") },
        { to: "/admin/web-stories", icon: Film, label: t("admin.nav.webStories") },
        { to: "/admin/personalized", icon: Wand2, label: t("admin.nav.personalized") },
        { to: "/admin/related-posts", icon: Share2, label: t("admin.nav.relatedPosts") },
      ],
    },
    {
      id: "design",
      label: t("admin.navGroups.design"),
      items: [
        { to: "/admin/appearance", icon: PanelsTopLeft, label: t("admin.nav.appearance") },
        { to: "/admin/theme-options", icon: Palette, label: t("admin.nav.themeOptions") },
        { to: "/admin/post-layouts", icon: LayoutGrid, label: t("admin.nav.postLayouts") },

      ],
    },
    ...(isAdmin
      ? [{
          id: "system",
          label: t("admin.navGroups.system"),
          items: [
            { to: "/admin/users", icon: Users, label: t("admin.nav.users") },
            { to: "/admin/settings", icon: Settings, label: t("admin.nav.settings") },
          ],
        }]
      : []),
  ];
  void Star; void Bookmark; void Brush;


  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className={`min-h-screen bg-muted/30 ${hideSidebar ? "" : "flex"}`}>
      {hideSidebar && <AdminLangBar />}
      {!hideSidebar && (
        <aside
          data-sidebar="sidebar"
          data-sidebar-style={sidebarStyle}
          className={cn(
            compact ? "w-12" : "w-56",
            "bg-card border-r border-border flex flex-col transition-all duration-200 sticky top-0 self-start h-screen max-h-screen sidebar-shell",
          )}
        >

          <div className="p-3 border-b border-border">
            <div className={`flex items-center ${compact ? "justify-center" : "gap-2"}`}>
              <Link
                to="/admin"
                data-sidebar-brand
                className={`font-display font-bold text-base flex items-center justify-center min-w-0 ${compact ? "" : "flex-1"} bg-transparent hover:bg-transparent`}
                style={{ background: "transparent" }}
                title="Kokpit"
              >
                <SidebarBrand compact={compact} />
              </Link>
              {!compact && (
                <button
                  onClick={() => setForceCompact((s) => !s)}
                  data-sidebar-toggle
                  className="ml-auto text-muted-foreground hover:text-foreground shrink-0 bg-transparent hover:bg-transparent"
                  title={t("admin.sidebar.collapse")}
                >
                  <PanelLeft className="w-4 h-4 rotate-180 transition-transform" />
                </button>
              )}
            </div>
            {compact && (
              <button
                onClick={() => setForceCompact((s) => !s)}
                data-sidebar-toggle
                className="mt-2 mx-auto flex text-muted-foreground hover:text-foreground bg-transparent hover:bg-transparent"
                title={t("admin.sidebar.expand")}
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}
          </div>
          <nav className="flex-1 p-2 space-y-3 overflow-y-auto">
            {groups.map((group, idx) => (
              <div key={group.id} className={idx > 0 ? "pt-2 border-t border-border/60" : ""}>
                {group.label && !compact && (
                  <div
                    data-sidebar="group-label"
                    className="px-2 pt-1 pb-0 text-[8px] uppercase tracking-wider text-muted-foreground font-semibold"
                  >
                    {group.label}
                  </div>
                )}
                <div className="space-y-0.5">
                  {group.items.map(({ to, icon: Icon, label }) => {
                    const active = path === to || (to !== "/admin" && path.startsWith(to));
                    return (
                      <Link
                        key={to}
                        to={to}
                        title={label}
                        data-sidebar="menu-button"
                        data-active={active ? "true" : "false"}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] leading-tight transition ${
                          active ? "bg-brand text-brand-foreground" : "text-foreground hover:bg-muted"
                        }`}
                      >
                        <Icon className="w-3 h-3 shrink-0" />
                        <span className={`truncate ${compact ? "hidden" : ""}`}>{label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}

            {extras && !compact && (
              <div className="mt-4 pt-3 border-t border-border space-y-0.5">
                {extras.title && (
                  <div data-sidebar="group-label" className="px-2 pb-1 text-[8px] uppercase tracking-wider text-muted-foreground font-medium">
                    {extras.title}
                  </div>
                )}
                {extras.items.map((it) => {
                  const Icon = it.icon;
                  const isActive = extras.activeId === it.id;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => extras.onSelect(it.id)}
                      data-sidebar="menu-button"
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left border-l-2 transition ${
                        isActive
                          ? "border-brand bg-brand/10 text-brand font-medium"
                          : "border-transparent hover:bg-muted text-foreground"
                      }`}
                    >
                      {Icon && <Icon className="w-4 h-4 shrink-0" />}
                      <span className={cn("flex-1 truncate", compact && "hidden")}>{it.label}</span>
                      {isActive && <ChevronRight className="w-3 h-3" />}
                    </button>
                  );
                })}
              </div>
            )}
          </nav>

          <div className="p-2 border-t border-border space-y-0.5">
            <Link
              to="/"
              title={t("admin.viewSite")}
              data-sidebar="menu-button"
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-muted-foreground hover:bg-muted"
            >
              <Home className="w-3.5 h-3.5 shrink-0" />
              <span className={compact ? "hidden" : ""}>{t("admin.viewSite")}</span>
            </Link>
            <button
              onClick={toggle}
              title={t("admin.theme")}
              data-sidebar="menu-button"
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-muted-foreground hover:bg-muted"
            >
              {theme === "dark" ? <Sun className="w-3.5 h-3.5 shrink-0" /> : <Moon className="w-3.5 h-3.5 shrink-0" />}
              <span className={compact ? "hidden" : ""}>{t("admin.theme")}</span>
            </button>
            <button
              onClick={() => i18n.changeLanguage(lang.startsWith("pl") ? "en" : "pl")}
              title={lang.startsWith("pl") ? "PL" : "EN"}
              data-sidebar="menu-button"
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-muted-foreground hover:bg-muted"
            >
              <Globe className="w-3.5 h-3.5 shrink-0" />
              <span className={compact ? "hidden" : ""}>{lang.startsWith("pl") ? "PL" : "EN"}</span>
            </button>
            <button
              onClick={handleSignOut}
              title={t("admin.signout")}
              data-sidebar="menu-button"
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-destructive hover:bg-destructive/10"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span className={compact ? "hidden" : ""}>{t("admin.signout")}</span>
            </button>
          </div>
        </aside>
      )}
      <main className={`${isEditRoute ? "min-w-0" : "overflow-x-auto"} ${hideSidebar ? "w-full" : "flex-1"}`}>
        <div className={isEditRoute ? "p-3" : isThemeOptions ? "max-w-6xl mr-auto ml-0 py-6 lg:py-10 pl-3 lg:pl-4 pr-6 lg:pr-10" : "max-w-6xl mx-auto p-6 lg:p-10"}>{children}</div>
      </main>
    </div>
  );
}

function SidebarBrand({ compact }: { compact: boolean }) {
  const cfg = useSiteSetting<SidebarLogoCfg>("theme_options", SIDEBAR_LOGO_DEFAULTS);
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const logo = cfg.logo ?? SIDEBAR_LOGO_DEFAULTS.logo;
  const iconSrc = (isDark ? logo.sidebar_icon_dark : logo.sidebar_icon) || logo.sidebar_icon || logo.sidebar_icon_dark;
  const expandedSrc = (isDark ? logo.sidebar_expanded_dark : logo.sidebar_expanded) || logo.sidebar_expanded || logo.sidebar_expanded_dark || (isDark ? logo.main_dark : logo.main) || logo.main;

  if (compact) {
    return iconSrc
      ? <img src={iconSrc} alt="Logo" className="w-8 h-8 object-contain" />
      : <span className="text-base">NES</span>;
  }
  return expandedSrc
    ? <img src={expandedSrc} alt="Logo" className="max-h-9 max-w-full object-contain" />
    : <span>NES <span className="text-brand">Admin</span></span>;
}
