// `/admin/` - trasa kokpitu. Przedmiotem dowodu jest JEDNA rzecz: KTO i KIEDY
// żąda chunku pulpitu. Obie strony tego pytania mają cenę liczoną w setkach
// kilobajtów, więc obie są tu przypięte.
//
// STRONA PIERWSZA - CHUNK MA POLECIEĆ WCZEŚNIE. `/admin` jest trasą `ssr: false`,
// a `AdminLayout` (routes/admin.tsx) przy `useAuth().loading` NIE renderuje
// `<Outlet/>`. Komponent tej trasy montuje się dopiero PO rozstrzygnięciu sesji,
// a `React.lazy` odpala import przy pierwszym renderze - więc pobranie chunku
// stało szeregowo za dwoma fazami sieciowymi uwierzytelnienia (`getSession`
// + odczyt `user_roles`/`profiles`), mimo że od żadnej z nich nie zależy.
// Zmierzone na produkcji LCP `/admin` = 7,54 s.
//
// STRONA DRUGA - I TYLKO DLA TEJ TRASY. Pierwsze podejście wołało rozgrzewkę
// przy EWALUACJI MODUŁU, w założeniu, że router ewaluuje moduł tylko dla
// dopasowanej trasy. Bramka `first-visit` na zbudowanym artefakcie obaliła to
// pomiarem: wejście na `/` ściąga moduły kilkunastu niedopasowanych tras, więc
// rozgrzewka wyciekła na publiczną stronę główną razem z całym silnikiem
// wykresów - jsBytes 3 070 809 -> 3 504 909 (+434 kB: `Chart` 216 kB,
// `ChartFrame` 74 kB, `i18n-admin-analytics` 58 kB, `AdminDashboard`,
// `useDashboardData`, `geoQuery`, `DataVizViews`).
//
// DLATEGO TEN PLIK MIERZY OBIE STRONY. Test, który sprawdza tylko „chunk został
// zażądany", przechodzi także dla wersji, która żąda go WSZĘDZIE - i dokładnie
// taki test przepuścił tę regresję. Asercja o module jest tu kontrolą negatywną
// i jest ważniejsza od asercji o loaderze.
//
// GRANICA DOWODU. `vi.mock` zamienia moduł pulpitu na atrapę, więc mierzymy
// ŻĄDANIE modułu, nie transfer sieciowy ani realny podział na chunki. Tego
// drugiego pilnują bramki artefaktu (`check:chunks`, `check:entry-purity`,
// `first-visit`) - i to one, a nie ten plik, są ostatecznym sędzią rozmiaru.
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dashboardRequests: 0 }));

vi.mock("@/components/admin/dashboard/AdminDashboard", () => {
  h.dashboardRequests += 1;
  return { AdminDashboard: () => null };
});

// Nakładki słownika rejestrują klucze efektem ubocznym importu i sięgają po
// `@/lib/i18n`; w tym pliku nie mają nic do zrobienia, a ciągną za sobą
// react-i18next (ta sama pułapka cyklu, co w `dashboardSection.test.tsx`).
vi.mock("@/lib/i18n-admin-dashboard", () => ({ ensureI18n: () => {} }));
vi.mock("@/components/admin/analytics/AdminBiStrip", () => ({ AdminBiStrip: () => null }));

/** Jedno przejście przez kolejkę makrozadań - rozgrzewka jest `void`-owana. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("/admin/ - kto żąda chunku pulpitu", () => {
  it("SAM import modułu trasy NIE żąda chunku - inaczej wycieka na każdą stronę", async () => {
    expect(h.dashboardRequests).toBe(0);

    const mod = await import("@/routes/admin.index");
    await settle();

    // KONTROLA NEGATYWNA REGRESJI +434 kB. Moduły tras są na kliencie
    // ewaluowane szeroko, także dla tras NIEDOPASOWANYCH, więc efekt uboczny
    // w ciele modułu jest efektem na całym serwisie.
    expect(h.dashboardRequests).toBe(0);
    // Sam komponent też nie wystarcza: `lazy` odpala import dopiero przy
    // renderze, a tu nic się nie renderuje.
    expect(mod.Route.options.component).toBeTypeOf("function");
    expect(h.dashboardRequests).toBe(0);
  });

  it("`loader` trasy żąda chunku - bez renderu i bez sesji", async () => {
    const { Route } = await import("@/routes/admin.index");
    const loader = Route.options.loader as (() => void) | undefined;
    expect(loader).toBeTypeOf("function");

    loader?.();
    await settle();

    // Loader biegnie WYŁĄCZNIE dla dopasowanej trasy i przed montażem Reacta,
    // więc pobranie chunku jedzie równolegle do rozstrzygania sesji.
    expect(h.dashboardRequests).toBe(1);
  });

  it("loader NIE zwraca obietnicy - nie wolno mu opóźnić wejścia do panelu", async () => {
    const { Route } = await import("@/routes/admin.index");
    const loader = Route.options.loader as (() => unknown) | undefined;

    // Gdyby loader awaitował rozgrzewkę, zamieniłby ją z RÓWNOLEGŁEJ na
    // BLOKUJĄCĄ - czyli odwrócił cały sens tej zmiany.
    expect(loader?.()).toBeUndefined();
  });
});
