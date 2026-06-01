// Appearance layout: spójny pasek nawigacji + Outlet dla pod-zakładek
// (Nagłówek, Stopka, Menu, Global Colors).
import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/appearance")({
  component: AppearanceLayout,
  beforeLoad: ({ location }) => {
    if (location.pathname === "/admin/appearance") {
      throw redirect({ to: "/admin/appearance/header" });
    }
  },
});

const TABS = [
  { to: "/admin/appearance/header", label: "Nagłówek" },
  { to: "/admin/appearance/footer", label: "Stopka" },
  { to: "/admin/appearance/menu", label: "Menu" },
  { to: "/admin/appearance/global-colors", label: "Global Colors" },
] as const;

function AppearanceLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => {
          const active = path.startsWith(t.to);
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`px-3 py-2 text-sm rounded-t-md border-b-2 -mb-px transition ${
                active
                  ? "border-brand text-brand font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
