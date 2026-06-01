// Admin settings layout with subtabs.
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const tabs = [
    { to: "/admin/settings/general", label: t("admin.settingsNav.general") },
    { to: "/admin/settings/design", label: t("admin.settingsNav.design") },
    { to: "/admin/settings/reading", label: t("admin.settingsNav.reading") },
    { to: "/admin/settings/discussion", label: t("admin.settingsNav.discussion") },
    { to: "/admin/settings/media", label: t("admin.settingsNav.media") },
    { to: "/admin/settings/permalinks", label: t("admin.settingsNav.permalinks") },
    { to: "/admin/settings/privacy", label: t("admin.settingsNav.privacy") },
  ];
  return (
    <div>
      <h1 className="font-display text-3xl font-bold mb-2">{t("admin.settingsNav.title")}</h1>
      <p className="text-muted-foreground mb-6">{t("admin.settingsNav.subtitle")}</p>

      <div className="flex flex-col md:flex-row gap-6">
        <aside className="md:w-56 shrink-0">
          <nav className="bg-card border border-border rounded-lg p-2 space-y-1">
            {tabs.map((tab) => {
              const active = path === tab.to || path.startsWith(tab.to + "/");
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={`block px-3 py-2 rounded-md text-sm transition ${
                    active ? "bg-brand text-brand-foreground" : "text-foreground hover:bg-muted"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <section className="flex-1 min-w-0 bg-card border border-border rounded-lg p-6">
          <Outlet />
        </section>
      </div>
    </div>
  );
}
