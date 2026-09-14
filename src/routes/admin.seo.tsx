// UKŁAD kokpitu SEO (/admin/seo) - pasek zakładek i `<Outlet />`, nic więcej.
//
// DLACZEGO TO JEST UKŁAD, A NIE EKRAN. Do 2026-09 ta trasa renderowała tabelę
// treści i NIE wołała `<Outlet />`, mając przy tym dziecko
// (`/admin/seo/search-console`). W TanStack Router `Match` renderuje ALBO
// `component`, ALBO `<Outlet />` - nigdy oba - więc Search Console było
// NIEOSIĄGALNE z przeglądarki: każde wejście pokazywało tabelę treści. Defekt
// był zamrożony w `parentRoutesRenderOutlet.gate.test.ts` na liście
// `KNOWN_BROKEN` z adnotacją, że naprawa to podział na układ + `x.index.tsx`.
// Ta zmiana wykonuje dokładnie ten podział, a wpis z listy długu znika.
//
// PODZIAŁ ZAKŁADEK wynika z tego, KTO co poprawia, a nie z układu bazy:
//   kokpit          - co jest zepsute i gdzie to kliknąć,
//   strona główna   - nazwa serwisu, tytuł i opis (wynik na nazwę marki),
//   karty społ.     - og:image i podglądy per sieć,
//   treści          - tabela wszystkich wpisów i stron,
//   Search Console  - dane z zewnątrz (zapytania, strony).
//
// Trasa jest CZYSTO NAWIGACYJNA i taka ma zostać: bramka autorytetu
// (`adminRouteAuthority.gate.test.ts`) wymaga, żeby `admin.seo.tsx` nie
// wykonywało żadnej mutacji.
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Search } from "@/lib/lucide-shim";
import { ensureI18n } from "@/lib/i18n-admin-seo-hub";

export const Route = createFileRoute("/admin/seo")({
  component: SeoHubLayout,
  // Tytuł zakładki przeglądarki jest literałem, a nie `t()`: `head()` czytające
  // słownik wciąga cały jego graf do chunku wejściowego KAŻDEJ strony
  // (scripts/check-entry-purity.ts). Dzieci dopisują własne, bardziej
  // szczegółowe tytuły - w TanStacku wygrywa ostatnie dopasowanie.
  head: () => ({ meta: [{ title: "SEO" }] }),
});

interface HubTab {
  to: string;
  label: string;
  /** Zakładka indeksowa dopasowuje się TYLKO dokładną ścieżką. */
  exact?: boolean;
}

function SeoHubLayout() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-seo-hub.ts.
  ensureI18n();
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const tabs: HubTab[] = [
    { to: "/admin/seo", label: t("adminSeoHub.tabDashboard"), exact: true },
    { to: "/admin/seo/homepage", label: t("adminSeoHub.tabHomepage") },
    { to: "/admin/seo/social", label: t("adminSeoHub.tabSocial") },
    { to: "/admin/seo/content", label: t("adminSeoHub.tabContent") },
    { to: "/admin/seo/queries", label: t("adminSeoHub.tabQueries") },
    { to: "/admin/seo/search-console", label: t("adminSeoHub.tabSearchConsole") },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2">
          <Search className="w-6 h-6" />
          {t("adminSeoHub.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t("adminSeoHub.subtitle")}</p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((tab) => {
          // Zakładka indeksowa musi porównywać ścieżkę DOKŁADNIE - prefiks
          // "/admin/seo" pasuje do każdej podstrony, więc kokpit świeciłby się
          // jako aktywny na wszystkich zakładkach naraz.
          const active = tab.exact ? path === tab.to : path.startsWith(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                active
                  ? "border-brand text-brand font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
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
