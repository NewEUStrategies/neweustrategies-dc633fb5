import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { LayoutDashboard, FileText, File, FolderTree, Tags, Users, Image as ImageIcon, LogOut, Home, Moon, Sun, Globe } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import type { ReactNode } from "react";

export function AdminShell({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { signOut, user, isAdmin } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const lang = i18n.language ?? "pl";

  const items = [
    { to: "/admin", icon: LayoutDashboard, label: t("admin.nav.dashboard") },
    { to: "/admin/posts", icon: FileText, label: t("admin.nav.posts") },
    { to: "/admin/pages", icon: File, label: t("admin.nav.pages") },
    { to: "/admin/media", icon: ImageIcon, label: t("admin.nav.media") },
    { to: "/admin/categories", icon: FolderTree, label: t("admin.nav.categories") },
    { to: "/admin/tags", icon: Tags, label: t("admin.nav.tags") },
    ...(isAdmin ? [{ to: "/admin/users", icon: Users, label: t("admin.nav.users") }] : []),
  ];

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen flex bg-muted/30">
      <aside className="w-64 bg-card border-r border-border flex flex-col">
        <div className="p-5 border-b border-border">
          <Link to="/admin" className="font-display text-lg font-bold">
            NES <span className="text-brand">Admin</span>
          </Link>
          <p className="text-xs text-muted-foreground mt-1 truncate">{user?.email}</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {items.map(({ to, icon: Icon, label }) => {
            const active = path === to || (to !== "/admin" && path.startsWith(to));
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition ${
                  active ? "bg-brand text-brand-foreground" : "text-foreground hover:bg-muted"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border space-y-1">
          <Link to="/" className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted">
            <Home className="w-4 h-4" /> {t("admin.viewSite")}
          </Link>
          <button onClick={toggle} className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted">
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />} {t("admin.theme")}
          </button>
          <button
            onClick={() => i18n.changeLanguage(lang.startsWith("pl") ? "en" : "pl")}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
          >
            <Globe className="w-4 h-4" /> {lang.startsWith("pl") ? "PL" : "EN"}
          </button>
          <button onClick={handleSignOut} className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-destructive hover:bg-destructive/10">
            <LogOut className="w-4 h-4" /> {t("admin.signout")}
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto">
        <div className="max-w-6xl mx-auto p-6 lg:p-10">{children}</div>
      </main>
    </div>
  );
}
