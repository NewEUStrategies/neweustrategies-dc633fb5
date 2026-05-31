// Appearance layout: edit site header, footer and primary menu.
import { createFileRoute, Link, Outlet, useRouterState, redirect } from "@tanstack/react-router";

const tabs = [
  { to: "/admin/appearance/header", label: "Nagłówek" },
  { to: "/admin/appearance/footer", label: "Stopka" },
  { to: "/admin/appearance/menu", label: "Menu" },
] as const;

export const Route = createFileRoute("/admin/appearance")({
  component: AppearanceLayout,
  beforeLoad: ({ location }) => {
    if (location.pathname === "/admin/appearance") {
      throw redirect({ to: "/admin/appearance/header" });
    }
  },
});

function AppearanceLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="font-display text-xl font-bold mr-3">Wygląd</h1>
        {tabs.map((t) => {
          const active = path === t.to || path.startsWith(t.to + "/");
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`px-3 py-1.5 rounded-md text-sm transition border ${
                active
                  ? "bg-brand text-brand-foreground border-brand"
                  : "border-border text-foreground hover:bg-muted"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      <Outlet />
    </div>
  );
}
