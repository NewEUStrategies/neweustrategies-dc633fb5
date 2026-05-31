// Admin settings layout with subtabs (general, reading, discussion, media, permalinks, privacy).
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";

const tabs = [
  { to: "/admin/settings/general", label: "Ogólne" },
  { to: "/admin/settings/reading", label: "Czytanie" },
  { to: "/admin/settings/discussion", label: "Dyskusja" },
  { to: "/admin/settings/media", label: "Media" },
  { to: "/admin/settings/permalinks", label: "Bezpośrednie odnośniki" },
  { to: "/admin/settings/privacy", label: "Prywatność" },
] as const;

export const Route = createFileRoute("/admin/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div>
      <h1 className="font-display text-3xl font-bold mb-2">Ustawienia</h1>
      <p className="text-muted-foreground mb-6">Konfiguracja witryny pogrupowana w sekcje.</p>

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
