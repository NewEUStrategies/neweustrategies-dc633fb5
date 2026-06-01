// Appearance layout: spójny pasek nawigacji + Outlet dla pod-zakładek.
import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/appearance")({
  component: AppearanceLayout,
  beforeLoad: ({ location }) => {
    if (location.pathname === "/admin/appearance") {
      throw redirect({ to: "/admin/appearance/header" });
    }
  },
});

function AppearanceLayout() {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const tabs = [
    { to: "/admin/appearance/header", label: t("admin.appearance.header") },
    { to: "/admin/appearance/footer", label: t("admin.appearance.footer") },
    { to: "/admin/appearance/menu", label: t("admin.appearance.menu") },
    { to: "/admin/appearance/global-colors", label: t("admin.appearance.globalColors") },
  ];
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((tab) => {
          const active = path.startsWith(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`px-3 py-2 text-sm rounded-t-md border-b-2 -mb-px transition ${
                active
                  ? "border-brand text-brand font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
