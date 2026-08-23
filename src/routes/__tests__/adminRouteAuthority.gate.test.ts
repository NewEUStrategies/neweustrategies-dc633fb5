// Bramka: uprawnienia w PANELU zgadzają się z autorytetem w BAZIE.
//
// PO CO TA BRAMKA, A NIE TESTY RENDEROWANIA 67 TRAS. Audyt zgłosił „111 tras
// admina bez testów" i ta liczba mierzy nie to, co trzeba. Ryzyko w trasie
// panelu to nie render, a DOSTĘP - a dostęp jest w tym repo egzekwowany
// w trzech miejscach, z których żadnego nie widzi test renderujący trasę:
//
//   1. `routes/admin.tsx` - wspólny layout `/admin` przekierowuje każdego bez
//      `isStaff` na `/login`. Jedna bramka dla wszystkich 140 tras panelu.
//   2. Sama trasa - obszary wrażliwsze dokładają `isSuperAdmin` i redirect
//      (`admin.names`, `admin.super.mobile-drawer`, `admin.users.index`).
//   3. BAZA - RPC i RLS. To jest autorytet ostateczny: `change_user_role`
//      wymaga `admin`/`super_admin`, zabrania zmiany własnej roli, pilnuje
//      najemcy celu i pisze wpis do `role_audit_log`. Ma 11 asercji pgTAP
//      (`supabase/tests/role_management_test.sql`), w tym dowód, że pisanie
//      wprost do `user_roles` jest zamknięte.
//
// Test renderujący każdą trasę sprawdzałby więc rzecz najmniej istotną
// i najdroższą w utrzymaniu - czyli byłby farmą pokrycia. Ta bramka pilnuje
// TYCH warstw i jednej rzeczy, której nie pilnował nikt: czy panel nie oferuje
// akcji, którą baza i tak odrzuci.
//
// DEFEKT, KTÓRY ZNALAZŁA PRZY WDROŻENIU. `admin.users.$id` renderowało
// droplistę zmiany roli KAŻDEMU członkowi personelu - bo `/admin` przepuszcza
// też `editor` i `author`. Każde jej użycie kończyło się `not_authorized`
// z RPC, więc redaktor widział panel, który wygląda, jakby nadawał role,
// i dostawał błąd przy każdej próbie. Autorytet bazy był szczelny - kłamał
// interfejs.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTES_DIR = "src/routes";
// Rodzina `admin.community.clubs.*` - sześć tras, które ta bramka pilnuje
// osobno (patrz `describe("panel klubów - autorytet")` na końcu pliku).
const CLUB_ROUTES = [
  "admin.community.clubs.index.tsx",
  "admin.community.clubs.$clubId.tsx",
  "admin.community.clubs.topics.tsx",
  "admin.community.clubs.specializations.tsx",
  "admin.community.clubs.applications.tsx",
  "admin.community.clubs.elements.tsx",
] as const;
const CLUB_RPC_TESTS = [
  "supabase/tests/discussion_clubs_a1_test.sql",
  "supabase/tests/discussion_clubs_a2_invitations_test.sql",
  "supabase/tests/discussion_clubs_a3_threads_test.sql",
  "supabase/tests/discussion_clubs_a4_interaction_test.sql",
  "supabase/tests/discussion_clubs_a5_a6_test.sql",
  "supabase/tests/club_topics_tenant_isolation_test.sql",
] as const;
const ADMIN_LAYOUT = "src/routes/admin.tsx";
const SHELL = "src/components/admin/AdminShell.tsx";
// Mapa nawigacji panelu mieszka w osobnym module - to tam stoją wpisy
// zawężone `isSuperAdmin`, więc bramka musi czytać oba pliki.
const NAV_MAP = "src/lib/admin/adminNav.ts";
const ROLE_RPC_TEST = "supabase/tests/role_management_test.sql";

/**
 * MODUŁ 14 - MONETYZACJA. Cztery panele z nawigacji (`adminNav.ts`: /admin/ads,
 * /admin/coupons, /admin/gifting, /admin/donations) plus trzy podstrony kuponów.
 * Do wdrożenia tej sekcji bramka NIE ZNAŁA żadnej z nich - a każda oferuje
 * akcję dotykającą pieniędzy.
 */
const MONETIZATION_ROUTES = [
  "admin.ads.tsx",
  "admin.coupons.tsx",
  "admin.coupons.index.tsx",
  "admin.coupons.campaigns.tsx",
  "admin.coupons.redemptions.tsx",
  "admin.coupons.analytics.tsx",
  "admin.gifting.tsx",
  "admin.donations.tsx",
] as const;
/** Migracja, która dopisała klauzulę najemcy do PUBLICZNEGO odczytu reklam. */
const ADS_TENANT_MIGRATION =
  "supabase/migrations/20260703052115_f0827bf0-6b4f-44b7-b4a5-2695f2764718.sql";
/** Migracja z polityką `donations admin read` (rola `admin`, NIE editor). */
const DONATIONS_POLICY_MIGRATION = "supabase/migrations/20260714111000_donations.sql";
const MONETIZATION_PGTAP = [
  "supabase/tests/ad_events_tenant_scope_test.sql",
  "supabase/tests/b2b_coupons_money_test.sql",
  "supabase/tests/donations_ledger_scope_test.sql",
  "supabase/tests/coupon_effects_after_payment_test.sql",
  "supabase/tests/share_full_article_budget_test.sql",
] as const;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function adminRoutes(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((name) => name.startsWith("admin") && name.endsWith(".tsx"))
    .filter((name) => !/\.(test|spec)\.tsx$/.test(name));
}

describe("panel admina - warstwa dostępu", () => {
  it("wspólny layout `/admin` odsyła każdego bez `isStaff`", () => {
    // To jest bramka dla WSZYSTKICH tras panelu. Gdyby zniknęła, każda z 140
    // tras stałaby się publiczna naraz - i żaden test pojedynczej trasy tego
    // nie zauważy.
    const layout = read(ADMIN_LAYOUT);
    expect(layout).toMatch(/isStaff/);
    expect(layout, "layout musi PRZEKIEROWAĆ, nie tylko ukryć treść").toMatch(
      /navigate\(\{\s*to:\s*"\/login"\s*\}\)/,
    );
    expect(layout, "render bez sesji/personelu musi być pusty").toMatch(
      /if \(!session \|\| !isStaff\) return null;/,
    );
  });

  it("skan realnie widzi trasy panelu - kanarek zasięgu", () => {
    expect(adminRoutes().length).toBeGreaterThan(100);
  });

  it("trasa ukryta w nawigacji dla super_admina SAMA sprawdza rolę", () => {
    // Ukrycie linku w `AdminShell` nie chroni niczego: adres wpisuje się z ręki.
    // Dla każdej trasy, której wpis nawigacji jest zawężony `isSuperAdmin`,
    // wymagamy własnego sprawdzenia w pliku trasy.
    //
    // POPRAWKA WZORCA 2026-08-21. Poprzednia wersja szukała `isSuperAdmin ? [{`
    // z nawiasem i klamrą PRZYLEGŁYMI oraz ścieżki JEDNOSEGMENTOWEJ
    // (`"/admin/([a-z0-9-]+)"`). Oba założenia są w tym repo nieprawdziwe:
    // `adminNav.ts` formatuje bloki wieloelementowe z klamrą w następnej linii,
    // a wpisy super-admina zawierają ścieżkę dwusegmentową
    // (`/admin/super/mobile-drawer`). Skutek: bramka znajdowała JEDNĄ trasę
    // (`login-settings`) z trzech, a kanarek `gated.length > 0` przechodził na
    // tym jednym trafieniu - czyli bramka wyglądała na zdrową, pilnując
    // jednej trzeciej swojego przedmiotu. `names` i `super/mobile-drawer`
    // sprawdzają rolę poprawnie, ale usunięcie tego sprawdzenia przeszłoby
    // bez sygnału.
    const shell = `${read(SHELL)}\n${read(NAV_MAP)}`;
    const gated = [...shell.matchAll(/isSuperAdmin\s*\?\s*\[([^\]]*)\]/g)]
      .flatMap((block) => [...block[1].matchAll(/to:\s*"\/admin\/([a-z0-9/-]+)"/g)])
      .map((match) => match[1])
      .filter((path, index, all) => all.indexOf(path) === index);
    // Kanarek: gdyby wzorzec przestał pasować, bramka zrobiłaby się pusta.
    // Progiem jest LICZBA znanych tras, nie zero - dokładnie dlatego, że
    // poprzednia wersja przechodziła na jednym trafieniu z trzech.
    expect(gated.length).toBeGreaterThanOrEqual(3);
    // Wpisy WIELOSEGMENTOWE muszą być widziane - to była ślepa plama wzorca.
    expect(gated.some((path) => path.includes("/"))).toBe(true);

    const offenders = gated.filter((path) => {
      // Konwencja tras plikowych: `/admin/super/mobile-drawer` ->
      // `admin.super.mobile-drawer.tsx`.
      const file = `admin.${path.split("/").join(".")}.tsx`;
      if (!adminRoutes().includes(file)) return false;
      const source = read(`${ROUTES_DIR}/${file}`);
      return !/isSuperAdmin/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("każda trasa super-admina z nawigacji ISTNIEJE jako plik trasy", () => {
    // Wpis nawigacji celujący w nieistniejącą trasę daje super-adminowi link
    // do 404 - a poprzedni wzorzec cicho pomijał każdą trasę, której nie
    // znalazł (`if (!adminRoutes().includes(file)) return false`), więc literówka
    // w ścieżce nawigacji przechodziła jako „brak trasy do sprawdzenia".
    const shell = `${read(SHELL)}\n${read(NAV_MAP)}`;
    const gated = [...shell.matchAll(/isSuperAdmin\s*\?\s*\[([^\]]*)\]/g)]
      .flatMap((block) => [...block[1].matchAll(/to:\s*"\/admin\/([a-z0-9/-]+)"/g)])
      .map((match) => match[1]);
    const brakujace = gated.filter(
      (path) => !adminRoutes().includes(`admin.${path.split("/").join(".")}.tsx`),
    );
    expect(brakujace).toEqual([]);
  });

  it("zmianę roli oferuje tylko admin - panel nie proponuje akcji, którą baza odrzuci", () => {
    // Autorytet jest w RPC `change_user_role` (wymaga `admin`/`super_admin`).
    // Interfejs musi mówić to samo, inaczej redaktor dostaje droplistę, której
    // każde użycie kończy się `not_authorized`.
    const source = read(`${ROUTES_DIR}/admin.users.$id.tsx`);
    expect(source).toMatch(/!\(isAdmin \|\| isSuperAdmin\)/);
    // Nadanie `super_admin` zostaje ostrzejsze - dokładnie jak w RPC.
    // Wzorzec znosi zawinięcie JSX w nawias (prettier zawija, gdy etykieta
    // przestaje być literałem i schodzi z `t()`), bo pilnowany jest WARUNEK,
    // a nie sposób sformatowania gałęzi.
    expect(source).toMatch(/isSuperAdmin &&\s*\(?\s*<SelectItem value="super_admin"/);
  });

  it("autorytet nadawania rol jest pokryty pgTAP - i to on jest ostateczny", () => {
    // Ten test nie sprawdza bazy (do tego jest pgTAP) - sprawdza, że pokrycie
    // NIE ZNIKNĘŁO. Plik pgTAP da się usunąć jednym commitem i nic w TS nie
    // zapłonie, a to jest najwyżej uprzywilejowana operacja na platformie.
    const sql = read(ROLE_RPC_TEST);
    for (const guarantee of [
      "change_user_role", // sama funkcja
      "cannot_change_own_role", // nie zmieniasz sobie roli
      "super_admin_required", // super_admina nadaje super_admin
      "permission denied", // pisanie wprost do user_roles zamknięte
      "role_audit_log", // ślad w audycie
    ]) {
      expect(sql, `pgTAP przestał sprawdzać: ${guarantee}`).toContain(guarantee);
    }
  });
});

// ---------------------------------------------------------------------------
// KLUBY DYSKUSYJNE - rozszerzenie zakresu bramki (2026-08-19)
// ---------------------------------------------------------------------------
//
// PO CO. Bramka wyżej pilnowała rodziny `/admin/users*` i wpisów nawigacji
// zawężonych `isSuperAdmin`, a rodzina `admin.community.clubs.*` nie miała ANI
// JEDNEGO trafienia - mimo że jest to sześć tras, przez które przechodzi cała
// struktura modułu: widoczność klubów, próg planu, tryb atrybucji, skład,
// zaproszenia i moderacja. Ryzyko jest dokładnie tej samej klasy, co defekt,
// który ta bramka złapała przy wdrożeniu (droplista zmiany roli oferowana
// redaktorowi): panel oferuje akcję, którą baza i tak odrzuci.
//
// CZEGO TA CZĘŚĆ NIE ROBI. Nie renderuje tras - to byłaby farma pokrycia,
// dokładnie tak jak mówi nagłówek pliku. Stan i sklejenie tych sześciu tras
// (wersja robocza, `?tab=`, filtry, payload zapisu, trzy stany listy) pokrywa
// `src/routes/__tests__/adminClubRoutes.test.tsx`, a REGUŁY - tabela
// przypadków w `src/lib/clubs/__tests__/adminClubEditor.test.ts`. Tutaj
// pilnujemy wyłącznie AUTORYTETU: czy każda z sześciu tras SAMA sprawdza rolę
// i czy pokrycie pgTAP dla RPC modułu nie zniknęło.
describe("panel klubów - autorytet dostępu", () => {
  it("wszystkie sześć tras rodziny `community.clubs` istnieje - kanarek zasięgu", () => {
    // Bez tego bramka zrobiłaby się pusta po zmianie nazwy pliku i milczała.
    const present = adminRoutes();
    for (const file of CLUB_ROUTES) {
      expect(present, `brak trasy ${file}`).toContain(file);
    }
  });

  it("KAŻDA trasa klubów sama sprawdza `isAdmin` - layout `/admin` przepuszcza redaktora", () => {
    // `/admin` wymaga `isStaff`, a to obejmuje `editor` i `author`. Strukturą
    // klubów zarządza wyłącznie admin (V2 §0), więc bez własnego warunku
    // redaktor dostaje panel wyglądający na czynny i `not_authorized` z RPC
    // przy każdej próbie zapisu.
    const offenders = CLUB_ROUTES.filter((file) => !/isAdmin/.test(read(`${ROUTES_DIR}/${file}`)));
    expect(offenders).toEqual([]);
  });

  it("każda trasa klubów ODMAWIA treści, a nie tylko chowa przyciski", () => {
    // Pusta tabela bez wyjaśnienia wygląda jak awaria albo jak brak danych.
    // Warunek `if (!isAdmin) return` z komunikatem jest tym, co odróżnia
    // odmowę od defektu - i to on musi być w każdej z sześciu tras.
    const offenders = CLUB_ROUTES.filter((file) => {
      const source = read(`${ROUTES_DIR}/${file}`);
      return !/if \(!isAdmin\)\s*\{?\s*\n?\s*return/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("odmowa idzie przez KLUCZ i18n, nie przez polski napis w kodzie trasy", () => {
    // Bramka parzystości słowników nie widzi literału w JSX-ie, a moduł ma
    // wersję angielską - odmowa po polsku na `/en/` jest defektem, którego nie
    // złapie ani `check:i18n-parity`, ani przegląd kodu.
    const offenders = CLUB_ROUTES.filter((file) => {
      const source = read(`${ROUTES_DIR}/${file}`);
      return !/t\("adminClubs\.(topics\.adminOnly|noPermission(Title|Body))"\)/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("panel NIE oferuje zapisu klubu bez uprawnienia - zapytanie też jest zgaszone", () => {
    // Dwa różne błędy w jednym miejscu: (1) formularz widoczny dla kogoś, kto
    // nie może zapisać, (2) zapytanie lecące do RPC mimo braku uprawnienia -
    // to drugie zapala liczniki w logach za funkcję, której wynik nikt nie
    // zobaczy. Oba domykają się jednym warunkiem przy wywołaniu hooka.
    const editor = read(`${ROUTES_DIR}/admin.community.clubs.$clubId.tsx`);
    expect(editor, "edytor musi pytać o klub WARUNKOWO").toMatch(
      /useAdminClub\(isAdmin \? clubId : undefined\)/,
    );
    const list = read(`${ROUTES_DIR}/admin.community.clubs.index.tsx`);
    expect(list, "lista musi przekazywać `isAdmin` jako `enabled`").toMatch(
      /useAdminClubs\(filters, isAdmin\)/,
    );
  });

  it("autorytet RPC modułu klubów jest pokryty pgTAP - i to on jest ostateczny", () => {
    // Ten test nie sprawdza bazy (do tego jest pgTAP) - sprawdza, że pokrycie
    // NIE ZNIKNĘŁO. Pliki pgTAP da się usunąć jednym commitem i nic w TS nie
    // zapłonie, a to są funkcje, które decydują o widoczności treści klubu
    // zamkniętego.
    for (const file of CLUB_RPC_TESTS) {
      const sql = read(file);
      expect(sql.length, `pusty plik pgTAP: ${file}`).toBeGreaterThan(0);
    }
  });

  it("pgTAP pilnuje ZAKRESU NAJEMCY i uprawnień na funkcjach klubów", () => {
    const sql = CLUB_RPC_TESTS.map((file) => read(file)).join("\n");
    for (const guarantee of ["tenant", "admin", "club"]) {
      expect(sql, `pgTAP przestał wspominać: ${guarantee}`).toContain(guarantee);
    }
  });

  it("trasy-powłoki NIE mają własnej logiki zapisu - odmowa jest ich całą treścią", () => {
    // Cztery trasy (`topics`, `specializations`, `applications`, `elements`) są
    // powłokami: bramka + jeden manager. Gdyby doszła tam mutacja, ominęłaby
    // wzorzec „reguła w lib, sklejenie w organizmie" i wróciłaby do stanu,
    // w którym logika panelu mieszka w pliku trasy.
    const shells = [
      "admin.community.clubs.topics.tsx",
      "admin.community.clubs.specializations.tsx",
      "admin.community.clubs.applications.tsx",
      "admin.community.clubs.elements.tsx",
    ];
    const offenders = shells.filter((file) =>
      /\.mutate\(|useMutation\(/.test(read(`${ROUTES_DIR}/${file}`)),
    );
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// USTAWIENIA, INTEGRACJE, UŻYTKOWNICY, MULTI-TENANT, RODO
// rozszerzenie zakresu bramki (2026-08-21, moduł 19)
// ---------------------------------------------------------------------------
//
// PO CO. Bramka wyżej pilnowała rodziny `/admin/users*` (przez jedną trasę),
// wpisów nawigacji zawężonych `isSuperAdmin` oraz rodziny
// `admin.community.clubs.*`. Poza jej zasięgiem zostało DWADZIEŚCIA JEDEN tras
// panelu, przez które przechodzi konfiguracja całego serwisu, nadawanie ról,
// izolacja najemcy i zgody RODO: `admin.settings.*` (15), `admin.users.*` (4),
// `admin.organizations.*` (3), `admin.integrations`, `admin.names`,
// `admin.greetings`, `admin.popups`, `admin.audience`, `admin.personalized`.
//
// Ryzyko jest dokładnie tej samej klasy, co defekt, który ta bramka złapała
// przy wdrożeniu (droplista zmiany roli oferowana redaktorowi): PANEL OFERUJE
// AKCJĘ, KTÓRĄ BAZA I TAK ODRZUCI. Ta część odpowiada wyłącznie na to pytanie.
//
// CZEGO TA CZĘŚĆ NIE ROBI. Nie renderuje tras - to byłaby farma pokrycia,
// dokładnie tak jak mówi nagłówek pliku. STAN i SKLEJENIE tych rodzin pokrywają
// osobne pliki (`adminUsersRoutes.test.tsx`, `adminSettingsRoutes.test.tsx`,
// `adminOrganizationsRoutes.test.tsx`, `adminIntegrationsRoute.test.tsx`,
// `adminNamesRoute.test.tsx`, `adminAudienceRoutes.test.tsx`), a REGUŁY -
// testy warstwy `lib/` (`useSettings.test.tsx`, `invitationsFunctions.test.ts`,
// `namesCsv.test.ts`). Tutaj pilnujemy wyłącznie AUTORYTETU.
//
// TRZY WZORCE DOSTĘPU W TYM MODULE - i trzy różne reguły:
//
//   A. TRASA SUPERADMINA (`admin.names`). Wpis nawigacji zawężony
//      `isSuperAdmin`, więc trasa MUSI sprawdzać rolę SAMA i PRZEKIEROWAĆ
//      (adres wpisuje się z ręki).
//   B. TRASA ADMINA (`admin.greetings`). Wpis nawigacji zawężony `isAdmin` -
//      i to jest przypadek, którego bramka DO TEJ PORY NIE WIDZIAŁA, bo jej
//      wzorzec szukał wyłącznie `isSuperAdmin`.
//   C. TRASA CAŁEGO PERSONELU (pozostałe). Autorytet leży WYŁĄCZNIE w bazie
//      (RLS + RPC z zakresem najemcy). Tu reguła jest inna: trasa nie może
//      pisać WPROST do tabel uprzywilejowanych, a pokrycie pgTAP dla jej
//      procedur nie może zniknąć.

/** Rodziny tras objęte tym rozszerzeniem. Kanarek zasięgu - patrz test niżej. */
const MODULE19_ROUTES = [
  "admin.users.index.tsx",
  "admin.users.$id.tsx",
  "admin.users.invitations.tsx",
  "admin.users.tsx",
  "admin.organizations.tsx",
  "admin.organizations.$id.tsx",
  "admin.organizations.new.tsx",
  "admin.integrations.tsx",
  "admin.names.tsx",
  "admin.greetings.tsx",
  "admin.popups.tsx",
  "admin.audience.tsx",
  "admin.personalized.tsx",
] as const;

/** Trasy ustawień - piętnaście plików `admin.settings*`. */
function settingsRoutes(): string[] {
  return adminRoutes().filter((name) => name.startsWith("admin.settings"));
}

/**
 * Wpisy nawigacji zawężone rolą. Zwraca slugi zebrane z JEDNEGO wyrażenia
 * warunkowego `...(isX ? [ … ] : [])` - blok może nieść KILKA wpisów, więc
 * czytamy wszystkie adresy w jego wnętrzu, a nie tylko pierwszy.
 *
 * PO CO OSOBNA FUNKCJA. Dotychczasowy wzorzec bramki dopasowywał
 * `isSuperAdmin ? [{ … to: "/admin/<slug>"` - czyli PIERWSZY adres w bloku
 * i wyłącznie dla `isSuperAdmin`. Wpis zawężony `isAdmin` był dla bramki
 * niewidzialny, a to właśnie tam siedzi defekt zgłoszony niżej.
 */
function navGatedSlugs(role: "isAdmin" | "isSuperAdmin"): string[] {
  const source = `${read(SHELL)}\n${read(NAV_MAP)}`;
  const blocks = [...source.matchAll(new RegExp(`\\.\\.\\.\\(${role}\\s*\\?([^]*?)\\)\\s*,`, "g"))];
  const slugs = new Set<string>();
  for (const block of blocks) {
    for (const hit of block[1].matchAll(/to:\s*"\/admin\/([a-z0-9/-]+)"/g)) {
      slugs.add(hit[1]);
    }
  }
  return [...slugs];
}

/** Nazwa pliku trasy dla sluga nawigacji (`settings/seo` -> `admin.settings.seo.tsx`). */
function routeFileForSlug(slug: string): string {
  return `admin.${slug.split("/").join(".")}.tsx`;
}

describe("moduł 19 - kanarek zasięgu bramki", () => {
  it("wszystkie trasy rodzin modułu 19 ISTNIEJĄ pod znanymi nazwami", () => {
    // Bez tego bramka zrobiłaby się pusta po zmianie nazwy pliku i MILCZAŁA.
    // To jest ten sam mechanizm, którym zginęła kiedyś bramka
    // `check:authz-snapshot` (opisane w `src/lib/ci/gateCoverage.ts`).
    const present = adminRoutes();
    for (const file of MODULE19_ROUTES) {
      expect(present, `brak trasy ${file}`).toContain(file);
    }
  });

  it("rodzina `admin.settings.*` ma co najmniej piętnaście tras", () => {
    // Liczba jest dolną granicą, nie równością: dołożenie panelu ma być
    // możliwe bez ruszania bramki, ale ZNIKNIĘCIE połowy rodziny - nie.
    expect(settingsRoutes().length).toBeGreaterThanOrEqual(15);
  });

  it("wzorzec wpisów nawigacji zawężonych rolą realnie coś znajduje", () => {
    // Kanarek samego czytnika: gdyby wyrażenie przestało pasować (refaktor
    // `adminNav.ts`), wszystkie testy niżej zrobiłyby się puste i zielone.
    expect(navGatedSlugs("isSuperAdmin").length).toBeGreaterThan(0);
    expect(navGatedSlugs("isAdmin").length).toBeGreaterThan(0);
  });
});

describe("moduł 19 - wzorzec A: trasa superadmina sprawdza rolę SAMA", () => {
  it("każda trasa zawężona `isSuperAdmin` w nawigacji ma własny warunek", () => {
    // Ukrycie linku w nawigacji nie chroni niczego: adres wpisuje się z ręki,
    // a wspólny layout `/admin` przepuszcza każdego `isStaff` (czyli także
    // redaktora i autora).
    const offenders = navGatedSlugs("isSuperAdmin").filter((slug) => {
      const file = routeFileForSlug(slug);
      if (!adminRoutes().includes(file)) return false;
      return !/isSuperAdmin/.test(read(`${ROUTES_DIR}/${file}`));
    });
    expect(offenders).toEqual([]);
  });

  it("`admin.names` nie tylko sprawdza rolę - PRZEKIEROWUJE", () => {
    // Różnica jest istotna: ukrycie treści przy zachowaniu adresu zostawia
    // pusty ekran, który wygląda na awarię. Przekierowanie mówi wprost, że
    // to nie jest miejsce dla tej roli.
    const source = read(`${ROUTES_DIR}/admin.names.tsx`);
    expect(source).toMatch(/if \(!isSuperAdmin\) return <Navigate to="\/admin"/);
  });

  it("`admin.names` NIE PYTA bazy przed sprawdzeniem roli", () => {
    // Zapytanie wysłane przed bramką zapala liczniki w logach za funkcję,
    // której wynik nikt nie zobaczy - i wystawia kształt danych komuś, kto
    // nie ma do nich prawa.
    const source = read(`${ROUTES_DIR}/admin.names.tsx`);
    expect(source, "efekty pobierające dane muszą wyjść na `!isSuperAdmin`").toMatch(
      /if \(!isSuperAdmin\) return;/,
    );
  });
});

describe("moduł 19 - wzorzec C: autorytet w bazie, trasa nie pisze wprost", () => {
  /**
   * Tabele, do których panel NIE MOŻE pisać wprost z przeglądarki: zapis musi
   * iść przez SECURITY DEFINER z zakresem najemcy. Lista jest jawna, bo
   * „cokolwiek uprzywilejowanego" nie da się sprawdzić wzorcem.
   */
  const PRIVILEGED_TABLES = ["user_roles", "tenants", "role_audit_log", "user_consents"] as const;

  it.each(MODULE19_ROUTES)("%s nie pisze WPROST do tabel uprzywilejowanych", (file) => {
    // `change_user_role` pisze do `user_roles` w definerze i zostawia wpis
    // w `role_audit_log`; pisanie wprost jest po stronie bazy zamknięte
    // (dowód: `role_management_test.sql`, asercja „permission denied").
    // Ten test pilnuje, żeby panel w ogóle nie PRÓBOWAŁ - próba oznacza
    // ścieżkę, która w produkcji kończy się błędem bez wyjaśnienia.
    const source = read(`${ROUTES_DIR}/${file}`);
    const offenders = PRIVILEGED_TABLES.filter((table) =>
      new RegExp(`from\\("${table}"\\)[\\s\\S]{0,200}?\\.(insert|update|upsert|delete)\\(`).test(
        source,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it.each(settingsRoutes())("%s nie pisze WPROST do tabel uprzywilejowanych", (file) => {
    const source = read(`${ROUTES_DIR}/${file}`);
    const offenders = PRIVILEGED_TABLES.filter((table) =>
      new RegExp(`from\\("${table}"\\)[\\s\\S]{0,200}?\\.(insert|update|upsert|delete)\\(`).test(
        source,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("izolacja najemcy dla tras multi-tenant jest pokryta pgTAP - i to ona jest ostateczna", () => {
    // Ten test nie sprawdza bazy (do tego jest pgTAP) - sprawdza, że pokrycie
    // NIE ZNIKNĘŁO. Pliki pgTAP da się usunąć jednym commitem i nic w TS nie
    // zapłonie, a to są reguły, na których stoi rozdzielność najemców.
    const REQUIRED = [
      "supabase/tests/rls_tenant_isolation_test.sql",
      "supabase/tests/tenant_isolation_three_tenants_test.sql",
      "supabase/tests/tenants_update_grants_test.sql",
      "supabase/tests/security_definer_tenant_scope_test.sql",
      "supabase/tests/definer_header_tenant_isolation_test.sql",
      "supabase/tests/host_tenant_resolution_test.sql",
      "supabase/tests/tenant_host_assertion_test.sql",
      "supabase/tests/tenant_isolation_billing_storage_test.sql",
    ] as const;
    for (const file of REQUIRED) {
      expect(read(file).length, `pusty albo brakujący plik pgTAP: ${file}`).toBeGreaterThan(0);
    }
  });

  it("pgTAP izolacji najemcy realnie wspomina KOLUMNĘ najemcy i próbę zapisu", () => {
    // Sprawdzamy KAŻDY plik osobno, a nie sklejony tekst: warunek na sumie
    // przechodziłby, gdyby jeden plik niósł wszystko, a dwa pozostałe zrobiły
    // się puste. Wielkość liter po stronie SQL jest tu nieistotna - liczy się
    // obecność pojęcia, więc porównujemy bez rozróżniania.
    const FILES = [
      "supabase/tests/rls_tenant_isolation_test.sql",
      "supabase/tests/tenant_isolation_three_tenants_test.sql",
      "supabase/tests/security_definer_tenant_scope_test.sql",
    ] as const;
    for (const file of FILES) {
      const sql = read(file).toLowerCase();
      for (const guarantee of ["tenant_id", "insert"]) {
        expect(sql, `${file} przestał wspominać: ${guarantee}`).toContain(guarantee);
      }
    }
  });

  it("dowód zgody (RODO) jest pokryty pgTAP - utwardzenie tabel dowodowych", () => {
    // `set_user_consent` zapisuje IP/UA/wersję i jest jedyną drogą do rejestru;
    // tabele intake są dla klienta zamknięte (inwariant `check:sql-anon-insert`).
    const sql = read("supabase/tests/consent_evidence_hardening_test.sql");
    expect(sql.length).toBeGreaterThan(0);
    for (const guarantee of ["consent", "tenant"]) {
      expect(sql, `pgTAP zgód przestał wspominać: ${guarantee}`).toContain(guarantee);
    }
  });
});

describe("moduł 19 - panele ustawień nie obchodzą wspólnego silnika", () => {
  it("każdy panel czytający konfigurację robi to przez `useSettings`", () => {
    // Panel czytający `site_settings` własnym zapytaniem omija GŁĘBOKIE
    // SCALENIE przy zapisie - a to ono chroni gałęzie ustawione w innych
    // panelach (`theme_options.header`, `theme_options.buttons`, …).
    // Zapis wąskiego szkicu „jak leci" zdmuchnąłby rodzeństwo bez śladu.
    const offenders = settingsRoutes().filter((file) => {
      const source = read(`${ROUTES_DIR}/${file}`);
      const readsSettingsTable = /from\("site_settings"\)/.test(source);
      return readsSettingsTable && !/useSettings/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("żaden panel ustawień nie zapisuje `site_settings` poza silnikiem", () => {
    const offenders = settingsRoutes().filter((file) => {
      const source = read(`${ROUTES_DIR}/${file}`);
      return /from\("site_settings"\)[\s\S]{0,200}?\.(insert|update|upsert)\(/.test(source);
    });
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WZORZEC B - i DWA DEFEKTY, KTÓRE TA CZĘŚĆ BRAMKI ZŁAPAŁA (2026-08-21).
//
// Oba są zgłoszone `it.fails` z produkcją NIETKNIĘTĄ (rozdz. 6 zlecenia
// modułu 19: „Nie zmieniasz zachowania produkcyjnego, żeby test przeszedł.
// Znalazłeś defekt → `it.fails` z opisem"). Konwencja jest w repo przyjęta -
// są już inne takie zapisy z poprzednich zadań.
// ---------------------------------------------------------------------------

describe("moduł 19 - wzorzec B: trasa admina i defekty zgłoszone", () => {
  it.fails(
    "DEFEKT: trasa zawężona `isAdmin` w nawigacji NIE sprawdza roli sama (`admin.greetings`)",
    () => {
      // TO JEST TEN SAM DEFEKT, który ta bramka złapała przy wdrożeniu
      // (droplista zmiany roli oferowana redaktorowi) - tylko wpuszczony
      // INNĄ ŚCIEŻKĄ, której bramka DO TEJ PORY NIE WIDZIAŁA.
      //
      // Dotychczasowy test bramki („trasa ukryta w nawigacji dla super_admina
      // SAMA sprawdza rolę") dopasowywał wzorzec
      //   isSuperAdmin ? [{ … to: "/admin/<slug>"
      // czyli WYŁĄCZNIE wpisy zawężone `isSuperAdmin`, i tylko PIERWSZY adres
      // w bloku. Wpis zawężony `isAdmin` był dla niej niewidzialny.
      //
      // ZMIERZONY STAN. `src/lib/admin/adminNav.ts:207-209`:
      //   ...(isAdmin
      //     ? [{ to: "/admin/greetings", icon: MessageCircle, label: … }]
      //     : []),
      // a `src/routes/admin.greetings.tsx` (380 linii) NIE ZAWIERA ANI JEDNEGO
      // wystąpienia `isAdmin`, `isSuperAdmin`, `isStaff` ani `useAuth`.
      //
      // KONSEKWENCJA. Nawigacja ukrywa kafel przed redaktorem i autorem, ale
      // adres `/admin/greetings` wpisuje się z ręki, a wspólny layout `/admin`
      // przepuszcza każdego `isStaff` - czyli także `editor` i `author`. Panel
      // powitań zapisuje do `site_settings` (treści widoczne dla KAŻDEGO
      // odwiedzającego), więc redaktor dostaje w pełni czynny formularz
      // zmiany treści serwisu. Jeśli RLS na `site_settings` go zatrzyma,
      // zobaczy surowy błąd bazy bez wyjaśnienia; jeśli nie zatrzyma - zmieni
      // treść, do której nawigacja mu odmówiła dostępu. Obie odpowiedzi są
      // złe, a różnica między nimi nie jest widoczna z kodu trasy.
      //
      // NAPRAWA to ten sam jeden warunek, co w `admin.names.tsx:385`
      // (`if (!isSuperAdmin) return <Navigate to="/admin" />`), tylko na
      // `isAdmin`. Nie robimy jej tutaj, bo zakresem tego zadania są testy.
      const offenders = navGatedSlugs("isAdmin").filter((slug) => {
        const file = routeFileForSlug(slug);
        if (!adminRoutes().includes(file)) return false;
        return !/isAdmin/.test(read(`${ROUTES_DIR}/${file}`));
      });
      expect(
        offenders,
        `trasy zawężone w nawigacji, ale bez własnej bramki: ${offenders.join(", ")}`,
      ).toEqual([]);
    },
  );

  it.fails(
    "DEFEKT: `admin.users.index` oferuje droplistę zmiany roli KAŻDEMU członkowi personelu",
    () => {
      // DRUGI EKRAN TEGO SAMEGO DEFEKTU, który ta bramka opisuje w swoim
      // nagłówku. Karta użytkownika została naprawiona i bramka to pilnuje
      // (test „zmianę roli oferuje tylko admin" wyżej sprawdza
      // `admin.users.$id.tsx` na `!(isAdmin || isSuperAdmin)`). LISTA nie
      // została naprawiona i nikt tego nie zauważył, bo bramka pytała
      // o jeden plik.
      //
      // ZMIERZONY STAN. `src/routes/admin.users.$id.tsx` zawęża kontrolkę
      // warunkiem `data.id === user?.id || !(isAdmin || isSuperAdmin)`.
      // `src/routes/admin.users.index.tsx:799-822` renderuje `<Select>` ze
      // wszystkimi rolami pod warunkiem WYŁĄCZNIE `u.id === user?.id` - o roli
      // wywołującego nie pyta wcale. Plik ma sześć wystąpień `isSuperAdmin`
      // (opcja `super_admin`, impersonacja, akcje zbiorcze) i ZERO wystąpień
      // `isAdmin`.
      //
      // KONSEKWENCJA jest GORSZA niż w karcie. Karta dotyczy jednej osoby;
      // lista pokazuje wszystkich użytkowników najemcy naraz, więc redaktor
      // widzi ekran wyglądający jak konsola nadawania uprawnień dla całej
      // organizacji. Każde użycie kończy się `not_authorized` z RPC
      // `change_user_role` (autorytet bazy jest szczelny - 11 asercji pgTAP
      // w `supabase/tests/role_management_test.sql`), a komunikat idzie na
      // ekran surowym tekstem z Postgresa.
      //
      // NAPRAWA to jeden warunek, ten sam co w karcie.
      const source = read(`${ROUTES_DIR}/admin.users.index.tsx`);
      expect(source, "lista użytkowników musi zawężać droplistę roli do admina").toMatch(
        /!\(isAdmin \|\| isSuperAdmin\)/,
      );
    },
  );

  it("naprawiony ekran ZOSTAJE naprawiony - karta użytkownika nadal zawęża droplistę", () => {
    // Zapadka na regresję: gdyby warunek z karty zniknął przy refaktorze,
    // defekt wróciłby na OBA ekrany naraz, a `it.fails` wyżej dalej byłby
    // czerwony-oczekiwany i nikt by nie zauważył różnicy.
    const source = read(`${ROUTES_DIR}/admin.users.$id.tsx`);
    expect(source).toMatch(/!\(isAdmin \|\| isSuperAdmin\)/);
  });

  it("`super_admin` nadaje się WYŁĄCZNIE przez super admina - na OBU ekranach", () => {
    // RPC jest tu ostrzejsze niż dla pozostałych rol i oba ekrany muszą to
    // odbijać. Wzorzec znosi zawinięcie JSX w nawias (prettier zawija, gdy
    // etykieta schodzi z `t()`), bo pilnowany jest WARUNEK.
    const detail = read(`${ROUTES_DIR}/admin.users.$id.tsx`);
    expect(detail).toMatch(/isSuperAdmin &&\s*\(?\s*<SelectItem value="super_admin"/);
    const list = read(`${ROUTES_DIR}/admin.users.index.tsx`);
    expect(list).toMatch(/isSuperAdmin &&\s*\(?\s*<SelectItem value="super_admin"/);
  });

  it("akcje ZBIORCZE na rolach też sprawdzają uprawnienie do `super_admin`", () => {
    // Zbiorcza zmiana roli dotyczy dowolnie wielu osób jednym kliknięciem -
    // brak tego warunku dawałby redaktorowi narzędzie masowe, nie pojedyncze.
    const list = read(`${ROUTES_DIR}/admin.users.index.tsx`);
    expect(list).toMatch(/bulkRole === "super_admin" && !isSuperAdmin/);
  });

  it("bieżący użytkownik jest NIEZAZNACZALNY w akcjach zbiorczych", () => {
    // RPC ma osobną odmowę `cannot_change_own_role`; wpuszczenie siebie do
    // partii wywaliłoby całą operację na jednym rekordzie.
    const list = read(`${ROUTES_DIR}/admin.users.index.tsx`);
    expect(list).toMatch(/isSelectable = useCallback\(\(id: string\) => id !== user\?\.id/);
  });
});

// ---------------------------------------------------------------------------
// PANEL SEO - rozszerzenie zakresu bramki (2026-08-22, moduł 8)
// ---------------------------------------------------------------------------
//
// PO CO. Rodzina `admin.seo*` i `admin.settings.seo` nie miała w tej bramce ANI
// JEDNEGO trafienia. `e2e/seo.spec.ts` ma już test „/admin/seo is auth-gated
// (redirects to /auth or /login)", więc UWIERZYTELNIENIE jest dowiedzione i tu
// go NIE POWTARZAMY renderem. Bramka autorytetu odpowiada na inne pytanie:
// czy panel oferuje akcję, którą BAZA odrzuci.
//
// I odpowiedź jest twierdząca - patrz `it.fails` niżej. `site_settings` ma
// polityki `INSERT`/`UPDATE` wymagające `has_role(auth.uid(), 'admin')`,
// a wspólny layout `/admin` przepuszcza cały personel (także `editor`
// i `author`). `/admin/settings/seo` renderuje pełny formularz z `SaveBar`
// i NIE sprawdza roli - czyli dokładnie ten defekt, który ta bramka złapała
// przy wdrożeniu na droplistcie zmiany roli.
//
// CZEGO TA CZĘŚĆ NIE ROBI. Nie renderuje tras (to robi
// `adminSeoRoutes.test.tsx`) i nie sprawdza bazy (to robią polityki RLS,
// czytane tu wyłącznie jako TEKST migracji - żeby ciche rozluźnienie polityki
// nie zostało niezauważone).
const SEO_ROUTES = ["admin.seo.tsx", "admin.seo.search-console.tsx", "admin.settings.seo.tsx"];
/** Migracja, która nadała `site_settings` politykę „tylko admin pisze". */
const SITE_SETTINGS_POLICY_MIGRATION =
  "supabase/migrations/20260626162717_fe6d7498-55f7-4850-b07e-7accc7013cb5.sql";

describe("panel SEO - autorytet dostępu", () => {
  it("wszystkie trzy trasy rodziny SEO istnieją - kanarek zasięgu", () => {
    // Bez tego bramka zrobiłaby się pusta po zmianie nazwy pliku i milczała.
    const present = adminRoutes();
    for (const file of SEO_ROUTES) {
      expect(present, `brak trasy panelu SEO: ${file}`).toContain(file);
    }
  });

  it("autorytet zapisu ustawień SEO to `admin` w RLS - i ta polityka nadal istnieje", () => {
    // To jest źródło prawdy dla testu niżej. Gdyby polityka została
    // rozluźniona (albo migracja usunięta), `it.fails` przestałby opisywać
    // realny defekt, a nikt by tego nie zauważył - stąd czytamy ją wprost.
    const sql = read(SITE_SETTINGS_POLICY_MIGRATION);
    expect(sql).toContain('CREATE POLICY "site_settings admin insert"');
    expect(sql).toContain('CREATE POLICY "site_settings admin update"');
    const adminChecks = sql.match(/public\.has_role\(auth\.uid\(\), 'admin'::app_role\)/g) ?? [];
    expect(
      adminChecks.length,
      "zapis site_settings musi wymagać roli `admin` w INSERT i UPDATE",
    ).toBeGreaterThanOrEqual(2);
  });

  it("przeglądy SEO są TYLKO DO CZYTANIA - nie oferują zapisu, którego baza mogłaby odrzucić", () => {
    // `/admin/seo` i `/admin/seo/search-console` czytają treść i dane GSC.
    // Dopóki nie mają mutacji, brak własnego sprawdzenia roli jest POPRAWNY:
    // layout `/admin` odsiewa osoby z zewnątrz, a personel ma prawo czytać.
    // Gdyby dowolna z nich dostała zapis, ten test padnie i wymusi decyzję
    // o roli - zamiast wypuścić formularz, który odrzuci RLS.
    const offenders = ["admin.seo.tsx", "admin.seo.search-console.tsx"].filter((file) =>
      /useMutation\(|\.mutate\(|\.upsert\(|\.insert\(|\.update\(|\.delete\(/.test(
        read(`${ROUTES_DIR}/${file}`),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("panel SEO nie mówi redaktorowi po polsku w kodzie - komunikaty idą przez klucze", () => {
    // Ta sama zasada, co przy odmowach klubów: literał w JSX-ie omija bramkę
    // parytetu PL/EN, więc angielski panel wyświetlałby polszczyznę.
    for (const file of SEO_ROUTES) {
      const source = read(`${ROUTES_DIR}/${file}`);
      expect(source, `${file} nie woła t() ani razu`).toMatch(/\bt\("/);
    }
  });

  it.fails(
    "DEFEKT: /admin/settings/seo oferuje ZAPIS każdemu członkowi personelu, a baza go odrzuci",
    () => {
      // KONSEKWENCJA. `site_settings` INSERT/UPDATE wymaga `has_role(..., 'admin')`
      // (asercja wyżej czyta tę politykę wprost), a layout `/admin` przepuszcza
      // też `editor` i `author`. Redaktor wchodzi na zakładkę SEO, wypełnia
      // sufiks tytułu, politykę crawlerów AI, liczbę wpisów w RSS - i klika
      // „Zapisz". Zapis wraca błędem RLS. Interfejs wygląda, jakby redaktor
      // zarządzał SEO całego serwisu; autorytet bazy jest szczelny, kłamie
      // panel. To ta sama klasa defektu, którą ta bramka złapała przy wdrożeniu
      // na `admin.users.$id` (droplista zmiany roli dla całego personelu).
      //
      // NAPRAWA (poza zakresem tego zadania - nie zmieniamy produkcji, żeby
      // test przeszedł): trasa powinna czytać `isAdmin` z `useAuth()` i albo
      // odmawiać treści, albo renderować formularz w trybie tylko do czytania.
      const source = read(`${ROUTES_DIR}/admin.settings.seo.tsx`);
      expect(source, "trasa zapisująca site_settings musi sama sprawdzać rolę `admin`").toMatch(
        /isAdmin/,
      );
    },
  );

  it("kontrola dodatnia: /admin/settings/seo FAKTYCZNIE oferuje dziś zapis bez sprawdzenia roli", () => {
    // Bez tego testu `it.fails` wyżej mógłby zzielenieć z niewłaściwego
    // powodu - np. gdyby ktoś usunął `SaveBar` zamiast dodać warunek roli.
    // Te dwie asercje opisują stan FAKTYCZNY: zapis jest, kontroli roli nie ma.
    const source = read(`${ROUTES_DIR}/admin.settings.seo.tsx`);
    expect(source, "zapis istnieje").toMatch(/save\.mutate\(/);
    expect(source, "kontroli roli nie ma").not.toMatch(/isAdmin|isSuperAdmin/);
  });
});

describe("moduł 14 - panele monetyzacji: autorytet dostępu", () => {
  it("wszystkie osiem tras monetyzacji istnieje - kanarek zasięgu", () => {
    // Bez tego bramka zrobiłaby się pusta po przeniesieniu albo przemianowaniu
    // pliku i milczała - tak samo, jak milczała przez pięć wydań audytu,
    // zanim ta sekcja powstała.
    const present = adminRoutes();
    for (const file of MONETIZATION_ROUTES) {
      expect(present, `brak trasy monetyzacji: ${file}`).toContain(file);
    }
  });

  it("`noindex` przychodzi ze WSPÓLNEGO layoutu, nie z każdej trasy osobno", () => {
    // Ustalenie warte zapisania, bo łatwo je przeoczyć: tylko 27 ze 142 tras
    // panelu deklaruje `robots` samodzielnie, a mimo to WSZYSTKIE są wyłączone
    // z indeksowania - `head()` w `routes/admin.tsx` scala się w dół po
    // dopasowanym łańcuchu tras. Wymaganie `noindex` w każdym pliku panelu
    // byłoby więc szumem; wymagać trzeba tego, żeby ŹRÓDŁO nie zniknęło.
    const layout = read(ADMIN_LAYOUT);
    expect(layout).toMatch(/name:\s*"robots"/);
    expect(layout).toMatch(/noindex,\s*nofollow/);
  });

  it("żaden panel monetyzacji nie NADPISUJE `robots` w swoim `head()`", () => {
    // Dziecko może przesłonić wpis rodzica tą samą nazwą `meta`. Panel, który
    // zadeklaruje `robots: index`, wypadłby z osłony layoutu - i nikt by tego
    // nie zauważył, bo reszta panelu nadal byłaby wyłączona z indeksowania.
    const offenders = MONETIZATION_ROUTES.filter((file) => {
      const source = read(`${ROUTES_DIR}/${file}`);
      return /name:\s*"robots"/.test(source) && !/noindex/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("żaden panel monetyzacji nie pisze WPROST do tabel uprzywilejowanych", () => {
    const PRIVILEGED = ["user_roles", "tenants", "role_audit_log", "user_consents"] as const;
    for (const file of MONETIZATION_ROUTES) {
      const source = read(`${ROUTES_DIR}/${file}`);
      const offenders = PRIVILEGED.filter((table) =>
        new RegExp(`from\\("${table}"\\)[\\s\\S]{0,200}?\\.(insert|update|upsert|delete)\\(`).test(
          source,
        ),
      );
      expect(offenders, `${file} pisze wprost do tabeli uprzywilejowanej`).toEqual([]);
    }
  });

  it("publiczny odczyt reklam JEST wiązany z najemcą - i ta klauzula nadal istnieje", () => {
    // Migracja zakładająca tabele (20260624165807) dała publiczny odczyt BEZ
    // najemcy: `USING (status = 'active')`. Klauzulę dopisała dopiero
    // 20260703052115. Utrata tej poprawki znaczy: czytelnik jednej redakcji
    // dostaje kreacje drugiej, razem z zawartością kolumny `script`.
    const sql = read(ADS_TENANT_MIGRATION);
    expect(sql).toContain('CREATE POLICY "Public can read active ad_slots"');
    expect(sql).toContain('CREATE POLICY "Public can read active ad_placements"');
    const tenantClauses = sql.match(/tenant_id = public\.public_tenant_id\(\)/g) ?? [];
    expect(
      tenantClauses.length,
      "publiczny odczyt slotów I placementów musi wiązać się z najemcą",
    ).toBeGreaterThanOrEqual(2);
  });

  it("rejestr wpłat to autorytet `admin` w RLS - i ta polityka nadal istnieje", () => {
    // Źródło prawdy dla `it.fails` niżej. Gdyby politykę rozluźniono do
    // `editor`, tamten test przestałby opisywać realny defekt.
    const sql = read(DONATIONS_POLICY_MIGRATION);
    expect(sql).toContain('CREATE POLICY "donations admin read"');
    expect(sql).toMatch(/has_role\(\(SELECT auth\.uid\(\)\), 'admin'::app_role\)/);
    expect(sql, "rejestr wpłat NIE MOŻE dopuszczać roli editor").not.toMatch(/'editor'::app_role/);
  });

  it("autorytet monetyzacji jest pokryty pgTAP - i to pokrycie nie zniknęło", () => {
    // Ten test nie sprawdza bazy (do tego są same pliki pgTAP) - sprawdza, że
    // da się je usunąć jednym commitem, a wtedy coś w TS musi zapłonąć.
    for (const file of MONETIZATION_PGTAP) {
      expect(read(file).length, `pusty albo brakujący plik pgTAP: ${file}`).toBeGreaterThan(0);
    }
  });

  it("pgTAP monetyzacji realnie wspomina najemcę i próbę zapisu", () => {
    // Każdy plik OSOBNO: warunek na sklejonym tekście przechodziłby, gdyby
    // jeden plik niósł wszystko, a pozostałe zrobiły się puste.
    for (const file of [
      "supabase/tests/ad_events_tenant_scope_test.sql",
      "supabase/tests/donations_ledger_scope_test.sql",
    ]) {
      const sql = read(file).toLowerCase();
      for (const guarantee of ["tenant_id", "insert"]) {
        expect(sql, `${file} przestał wspominać: ${guarantee}`).toContain(guarantee);
      }
    }
  });

  it("pgTAP kwot kuponu dowodzi OBECNOŚCI CHECK-ów, a nie ich braku", () => {
    // Zlecenie zakładało, że baza nie ma CHECK-ów na kwocie kuponu. Ma
    // wszystkie cztery, więc plik pgTAP chroni je przed cofnięciem. Ten test
    // pilnuje, żeby ktoś nie zamienił go z powrotem na „dokumentację braku".
    const sql = read("supabase/tests/b2b_coupons_money_test.sql");
    expect(sql).toContain("discount_percent");
    expect(sql).toContain("discount_cents");
    expect(sql).toContain("max_redemptions");
    expect(sql, "CHECK-i dowodzimy przez ODRZUCENIE wstawki").toContain("throws_ok");
  });

  it("każdy panel monetyzacji jest DWUJĘZYCZNY - jednym z dwóch mechanizmów", () => {
    // Wymaganie brzmi „dwujęzyczny", nie „woła t()". Sześć paneli korzysta ze
    // słownika i18next; DWA (`admin.coupons.tsx` i `admin.coupons.analytics.tsx`)
    // mają zamiast tego lokalny helper `const L = (pl, en) => ...`. To nadal
    // jest dwujęzyczność - po angielsku panel NIE pokazuje polszczyzny - więc
    // asercja przyjmuje oba mechanizmy. Konsekwencje helpera opisuje test niżej.
    for (const file of MONETIZATION_ROUTES) {
      const source = read(`${ROUTES_DIR}/${file}`);
      const viaDictionary = /\bt\("/.test(source);
      const viaLocalHelper = /const L = \(pl: string, en: string\)/.test(source);
      expect(
        viaDictionary || viaLocalHelper,
        `${file} nie jest dwujęzyczny ani przez t(), ani przez lokalny helper`,
      ).toBe(true);
    }
  });

  it("DŁUG: trzy panele kuponów omijają słownik, więc ich napisy są niewidoczne dla bramek i18n", () => {
    // Ten test NIE jest defektem funkcjonalnym - jest zapisem długu, żeby nie
    // zniknął. Trzy pliki, nie dwa: `admin.coupons.redemptions.tsx` używa
    // OBU mechanizmów naraz (jedno `t()` obok helpera), co jest najgorszym
    // wariantem - część napisów tej samej strony jest w słowniku, część nie.
    // Napisy w lokalnym helperze `L(pl, en)` są dwujęzyczne, ale:
    //   * nie przechodzą przez `i18nParity.gate` ani `i18nKeyDrift.gate`
    //     (te czytają WYŁĄCZNIE `src/lib/i18n-*.ts`),
    //   * nie widzi ich tłumacz, bo nie ma dla nich klucza,
    //   * trzecia wersja językowa wymagałaby przepisania obu plików.
    // Przeniesienie do `i18n-admin-coupons.ts` jest bezpieczne, ale jest
    // ZMIANĄ PRODUKCYJNĄ i nie wchodzi w zakres tej bramki. Jeżeli ktoś to
    // zrobi, ten test padnie i trzeba go usunąć - to jest jego cel.
    const withLocalHelper = MONETIZATION_ROUTES.filter((file) =>
      /const L = \(pl: string, en: string\)/.test(read(`${ROUTES_DIR}/${file}`)),
    );
    expect(withLocalHelper).toEqual([
      "admin.coupons.tsx",
      "admin.coupons.redemptions.tsx",
      "admin.coupons.analytics.tsx",
    ]);
  });

  it("panele kuponów, reklam i prezentów SĄ spójne z autorytetem bazy", () => {
    // Kontrola POZYTYWNA - i powód, dla którego `it.fails` niżej dotyczy
    // wyłącznie darowizn. `b2b_coupons`, `ad_slots`, `ad_placements`
    // i `gift_article_settings` dopuszczają w RLS `admin OR editor`, a warstwa
    // serwerowa giftingu używa `requireAdminEditor`. Layout `/admin` przepuszcza
    // dokładnie tę samą grupę, więc redaktor, który widzi te panele, MOŻE
    // wykonać ich akcje. Tu interfejs nie kłamie.
    const coupons = read(
      "supabase/migrations/20260721070203_a0e336e0-eaf3-4342-9435-40e076ebf0dd.sql",
    );
    expect(coupons).toMatch(/b2b_coupons_staff_all/);
    expect(coupons).toMatch(/'editor'/);
    const gifting = read("src/lib/gifting-admin.functions.ts");
    expect(gifting).toMatch(/requireAdminEditor/);
  });

  it.fails(
    "DEFEKT: /admin/donations pokazuje redaktorowi PUSTY rejestr wpłat i przycisk, " +
      "który serwer odrzuci - trasa nie domyka uprawnienia sama",
    () => {
      // KONSEKWENCJA. `donations` ma w RLS wyłącznie `admin` (asercja wyżej
      // czyta tę politykę wprost), a layout `/admin` przepuszcza też `editor`
      // i `author`. Redaktor otwiera /admin/donations i widzi DWIE nieprawdy
      // naraz:
      //   1. tabelę „Ostatnie wpłaty" jako PUSTĄ - co czyta się jako „nikt nie
      //      wpłacił", a znaczy „nie masz prawa tego widzieć". Kafelki „Suma
      //      wpłat" liczą się z publicznych statystyk (service role), więc
      //      pokazują kwotę - obok pustej listy. Sprzeczność w jednym widoku.
      //   2. przycisk „Synchronizuj ze Stripe", który wywoła
      //      `syncDonationsWithStripe` -> `assertAdmin` -> `forbidden`.
      // To ta sama klasa defektu, którą ta bramka złapała na `admin.users.$id`
      // (droplista roli dla całego personelu) i na `admin.settings.seo`.
      //
      // NAPRAWA (poza zakresem - nie zmieniamy produkcji, żeby test przeszedł):
      // trasa powinna czytać `isAdmin` z `useAuth()` i albo odmawiać treści,
      // albo ukryć rejestr i przycisk synchronizacji.
      const source = read(`${ROUTES_DIR}/admin.donations.tsx`);
      expect(source, "panel rejestru wpłat musi sam sprawdzać rolę `admin`").toMatch(/isAdmin/);
    },
  );

  it("kontrola dodatnia: /admin/donations FAKTYCZNIE oferuje dziś akcje bez sprawdzenia roli", () => {
    // Bez tego `it.fails` wyżej mógłby zzielenieć z niewłaściwego powodu -
    // np. gdyby ktoś usunął przycisk synchronizacji zamiast dodać warunek roli.
    const source = read(`${ROUTES_DIR}/admin.donations.tsx`);
    expect(source, "synchronizacja ze Stripe jest oferowana").toMatch(/syncDonationsWithStripe/);
    expect(source, "rejestr wpłat jest czytany").toMatch(/listDonationRecords/);
    expect(source, "kontroli roli nie ma").not.toMatch(/isAdmin|isSuperAdmin/);
  });
});
