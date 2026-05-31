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
    <div>
      <h1 className="font-display text-3xl font-bold mb-2">Wygląd</h1>
      <p className="text-muted-foreground mb-6">Edycja nagłówka, stopki i menu witryny.</p>

      <div className="flex flex-col md:flex-row gap-6">
        <aside className="md:w-56 shrink-0">
          <nav className="bg-card border border-border rounded-lg p-2 space-y-1">
            {tabs.map((t) => {
              const active = path === t.to || path.startsWith(t.to + "/");
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={`block px-3 py-2 rounded-md text-sm transition ${
                    active ? "bg-brand text-brand-foreground" : "text-foreground hover:bg-muted"
                  }`}
                >
                  {t.label}
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
