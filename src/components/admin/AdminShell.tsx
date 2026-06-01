import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { LayoutDashboard, FileText, File, FolderTree, Tags, Users, Image as ImageIcon, LogOut, Home, Moon, Sun, Globe, Settings, PanelLeft, Layers, Star, Mail, Bookmark } from "@/lib/lucide-shim";
import { useTheme } from "@/components/ThemeProvider";
import { AdminLangBar } from "@/components/admin/AdminLangBar";
import { useState, type ReactNode } from "react";

export function AdminShell({ children, hideSidebar }: { children: ReactNode; hideSidebar?: boolean }) {
  const { t, i18n } = useTranslation();
  const { signOut, user, isAdmin } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const lang = i18n.language ?? "pl";

  const isEditRoute = /^\/admin\/(posts|pages)\/[^/]+$/.test(path) || path.startsWith("/admin/appearance");
  const [forceCompact, setForceCompact] = useState(false);
  const compact = isEditRoute || forceCompact;

  const items = [
    { to: "/admin", icon: LayoutDashboard, label: t("admin.nav.dashboard") },
    { to: "/admin/posts", icon: FileText, label: t("admin.nav.posts") },
    { to: "/admin/pages", icon: File, label: t("admin.nav.pages") },
    { to: "/admin/media", icon: ImageIcon, label: t("admin.nav.media") },
    { to: "/admin/categories", icon: FolderTree, label: t("admin.nav.categories") },
    { to: "/admin/tags", icon: Tags, label: t("admin.nav.tags") },
    { to: "/admin/paywall", icon: Star, label: t("admin.nav.paywall") },
    { to: "/admin/appearance", icon: Layers, label: t("admin.nav.appearance") },
    { to: "/admin/post-layouts", icon: Layers, label: t("admin.nav.postLayouts") },
    { to: "/admin/content-area", icon: FileText, label: t("admin.nav.contentArea") },
    { to: "/admin/newsletter", icon: Mail, label: t("admin.nav.newsletter") },
    { to: "/admin/personalized", icon: Bookmark, label: t("admin.nav.personalized") },
    ...(isAdmin ? [
      { to: "/admin/users", icon: Users, label: t("admin.nav.users") },
      { to: "/admin/settings", icon: Settings, label: t("admin.nav.settings") },
    ] : []),
  ];


  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className={`min-h-screen bg-muted/30 ${hideSidebar ? "" : "flex"}`}>
      <AdminLangBar />
      {!hideSidebar && (
        <aside
          className={`${compact ? "w-14" : "w-64"} bg-card border-r border-border flex flex-col transition-all duration-200`}
        >
          <div className="p-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Link to="/admin" className="font-display font-bold text-base">
                {compact ? "NES" : <>NES <span className="text-brand">Admin</span></>}
              </Link>
              <button
                onClick={() => setForceCompact((s) => !s)}
                className="ml-auto text-muted-foreground hover:text-foreground"
                title={compact ? "Rozszerz" : "Zwiń"}
              >
                <PanelLeft className={`w-4 h-4 transition-transform ${compact ? "" : "rotate-180"}`} />
              </button>
            </div>
            {!compact && <p className="text-xs text-muted-foreground mt-1 truncate">{user?.email}</p>}
          </div>
          <nav className="flex-1 p-2 space-y-1">
            {items.map(({ to, icon: Icon, label }) => {
              const active = path === to || (to !== "/admin" && path.startsWith(to));
              return (
                <Link
                  key={to}
                  to={to}
                  title={label}
                  className={`flex items-center gap-3 px-2 py-2 rounded-md text-sm transition ${
                    active ? "bg-brand text-brand-foreground" : "text-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className={`truncate ${compact ? "hidden" : ""}`}>{label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="p-2 border-t border-border space-y-1">
            <Link
              to="/"
              title={t("admin.viewSite")}
              className="flex items-center gap-3 px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
            >
              <Home className="w-4 h-4 shrink-0" />
              <span className={compact ? "hidden" : ""}>{t("admin.viewSite")}</span>
            </Link>
            <button
              onClick={toggle}
              title={t("admin.theme")}
              className="w-full flex items-center gap-3 px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
            >
              {theme === "dark" ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
              <span className={compact ? "hidden" : ""}>{t("admin.theme")}</span>
            </button>
            <button
              onClick={() => i18n.changeLanguage(lang.startsWith("pl") ? "en" : "pl")}
              title={lang.startsWith("pl") ? "PL" : "EN"}
              className="w-full flex items-center gap-3 px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
            >
              <Globe className="w-4 h-4 shrink-0" />
              <span className={compact ? "hidden" : ""}>{lang.startsWith("pl") ? "PL" : "EN"}</span>
            </button>
            <button
              onClick={handleSignOut}
              title={t("admin.signout")}
              className="w-full flex items-center gap-3 px-2 py-2 rounded-md text-sm text-destructive hover:bg-destructive/10"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span className={compact ? "hidden" : ""}>{t("admin.signout")}</span>
            </button>
          </div>
        </aside>
      )}
      <main className={`overflow-x-auto ${hideSidebar ? "w-full" : "flex-1"}`}>
        <div className={isEditRoute ? "p-3" : "max-w-6xl mx-auto p-6 lg:p-10"}>{children}</div>
      </main>
    </div>
  );
}
