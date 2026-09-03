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
const MIGRATIONS_DIR = "supabase/migrations";
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
// Rodzina `admin.newsletter.*` - czternaście tras panelu newslettera, które ta
// bramka pilnuje osobno (patrz `describe("panel newslettera - autorytet dostępu")`).
const NEWSLETTER_ROUTES = [
  "admin.newsletter.tsx",
  "admin.newsletter.index.tsx",
  "admin.newsletter.overview.tsx",
  "admin.newsletter.campaigns.tsx",
  "admin.newsletter.campaigns.index.tsx",
  "admin.newsletter.campaigns.$id.tsx",
  "admin.newsletter.subscribers.tsx",
  "admin.newsletter.deliverability.tsx",
  "admin.newsletter.auth-logs.tsx",
  "admin.newsletter.email-content.tsx",
  "admin.newsletter.email-preview.tsx",
  "admin.newsletter.system-emails.tsx",
  "admin.newsletter.inline.tsx",
  "admin.newsletter.popup.tsx",
] as const;
// Warstwa serwerowa, przez którą panel newslettera dotyka bazy. Wszystkie
// funkcje w tych plikach są WYŁĄCZNIE panelowe, więc każda musi mieć bramkę
// roli. `newsletter-popup-events.functions.ts` NIE jest na tej liście celowo:
// mieszka tam jeden endpoint publiczny (telemetria popupu od anonimowego
// odwiedzającego) - pilnuje go osobna asercja niżej.
const NEWSLETTER_SERVER_FNS = [
  "src/lib/newsletter-campaigns.functions.ts",
  "src/lib/newsletter-admin.functions.ts",
  "src/lib/newsletter-deliverability.functions.ts",
] as const;
// pgTAP bazy tłumień i zdarzeń kampanii - autorytet ostateczny higieny listy.
const NEWSLETTER_PGTAP_TESTS = [
  "supabase/tests/email_suppression_test.sql",
  "supabase/tests/email_suppression_unification_test.sql",
  "supabase/tests/newsletter_campaign_events_backfill_test.sql",
  "supabase/tests/newsletter_campaign_events_dedup_test.sql",
  "supabase/tests/newsletter_email_ci_unique_test.sql",
] as const;
const ADMIN_LAYOUT = "src/routes/admin.tsx";
const SHELL = "src/components/admin/AdminShell.tsx";
// Mapa nawigacji panelu mieszka w osobnym module - to tam stoją wpisy
// zawężone `isSuperAdmin`, więc bramka musi czytać oba pliki.
const NAV_MAP = "src/lib/admin/adminNav.ts";
const ROLE_RPC_TEST = "supabase/tests/role_management_test.sql";

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

// ---------------------------------------------------------------------------
// PANEL NEWSLETTERA
// rozszerzenie zakresu bramki (moduł 11, etap 3)
// ---------------------------------------------------------------------------
//
// DOSTĘPU DO TYCH TRAS PILNUJE WSPÓLNY LAYOUT `/admin` (`isStaff`) - żadna
// z czternastu nie ma i NIE POTRZEBUJE własnego sprawdzenia roli, bo
// newsletter prowadzi cała redakcja; te trasy odpowiadają za STAN i SKLEJENIE,
// a ich stan pokrywają `adminNewsletterCampaignRoutes.test.tsx` oraz
// `adminNewsletterShellRoutes.test.tsx`.
//
// Bramka pilnuje więc czterech rzeczy, których nie widzi żaden test renderujący:
// czy rodzina nadal istnieje w komplecie, czy trasy nadal chodzą do bazy
// WYŁĄCZNIE przez funkcje serwerowe, czy każda z tych funkcji ma bramkę roli,
// i czy pokrycie pgTAP dla tłumień oraz zdarzeń kampanii nie zniknęło.
describe("panel newslettera - autorytet dostępu", () => {
  it("wszystkie czternaście tras rodziny `admin.newsletter` istnieje - kanarek zasięgu", () => {
    // Bez tego bramka zrobiłaby się pusta po zmianie nazwy pliku i milczała.
    const present = adminRoutes();
    for (const file of NEWSLETTER_ROUTES) {
      expect(present, `brak trasy ${file}`).toContain(file);
    }
    // Skan widzi CAŁĄ rodzinę, także pliki dodane po napisaniu tej listy.
    const skan = present.filter((name) => name.startsWith("admin.newsletter"));
    expect(skan.length).toBeGreaterThanOrEqual(NEWSLETTER_ROUTES.length);
  });

  it("dostępu pilnuje layout `/admin` - żadna trasa newslettera nie udaje własnej bramki", () => {
    // Newsletter prowadzi cała redakcja (`isStaff` = admin/editor/author), więc
    // brak własnego `isAdmin` jest tu POPRAWNY, a nie przeoczony. Ten test
    // przybija stan faktyczny: gdyby ktoś dołożył w trasie warunek `isAdmin`
    // bez zmiany reguł po stronie funkcji serwerowych i RLS, panel zacząłby
    // odmawiać czegoś, do czego baza i tak dopuszcza - czyli kłamałby
    // w drugą stronę niż defekt z nagłówka tego pliku.
    const zRolaWTrasie = NEWSLETTER_ROUTES.filter((file) =>
      /isAdmin|isSuperAdmin/.test(read(`${ROUTES_DIR}/${file}`)),
    );
    expect(zRolaWTrasie).toEqual([]);
    // …a skoro tak, layout MUSI być jedyną i realną bramką.
    expect(read(ADMIN_LAYOUT)).toMatch(/isStaff/);
  });

  it("trasy newslettera NIE budują własnych zapytań do Supabase - idą przez server fns", () => {
    // Zapytanie zbudowane w pliku trasy omija bramkę roli funkcji serwerowej
    // i przypięcie do najemcy, które ta funkcja robi z profilu wywołującego.
    // Lista subskrybentów to dane osobowe - jedno takie zapytanie w panelu
    // wystarczy, żeby wyciekła poza tenanta.
    const offenders = NEWSLETTER_ROUTES.filter((file) => {
      const source = read(`${ROUTES_DIR}/${file}`);
      return /@\/integrations\/supabase|supabaseAdmin|\bsupabase\s*\n?\s*\.from\(/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("KAŻDA funkcja serwerowa newslettera deklaruje bramkę personelu", () => {
    // To jest miejsce, w którym naprawdę mieszka autoryzacja tego modułu.
    // Server fn bez middleware jest wywoływalna przez każdego, kto zna jej
    // adres - a te funkcje czytają listę adresów i URUCHAMIAJĄ WYSYŁKĘ.
    for (const file of NEWSLETTER_SERVER_FNS) {
      const source = read(file);
      const ilePublicznych = (source.match(/createServerFn\(/g) ?? []).length;
      const ileZBramka = (
        source.match(/\.middleware\(\[require(Staff|AdminEditor|Admin)\]\)/g) ?? []
      ).length;
      expect(
        ilePublicznych,
        `${file}: brak funkcji serwerowych - czy plik się nie przeniósł?`,
      ).toBeGreaterThan(0);
      expect(ileZBramka, `${file}: ${ilePublicznych} funkcji, ${ileZBramka} z bramką roli`).toBe(
        ilePublicznych,
      );
    }
  });

  it("telemetria popupu jest publiczna Z ROZMYSŁEM, ale JEJ RAPORT już nie", () => {
    // Zdarzenia popupu zbiera anonimowy odwiedzający - tam bramki roli być nie
    // może (tenant rozwiązuje się z hosta żądania, wolumen tnie limiter).
    // RAPORT z tych zdarzeń to już dane panelu i musi być za personelem.
    // Ten podział jest łatwy do przypadkowego odwrócenia przy dokładaniu
    // kolejnej funkcji do tego pliku, dlatego stoi tu jawnie.
    const source = read("src/lib/newsletter-popup-events.functions.ts");
    const publiczny = source.slice(source.indexOf("logNewsletterPopupEvent"));
    const raport = source.slice(source.indexOf("getNewsletterPopupEventStats"));
    expect(
      publiczny.slice(0, raport.length > 0 ? publiczny.length - raport.length : undefined),
    ).not.toMatch(/\.middleware\(\[require/);
    expect(raport).toMatch(/\.middleware\(\[requireStaff\]\)/);
  });

  it("autorytet tłumień i zdarzeń kampanii jest pokryty pgTAP - i to on jest ostateczny", () => {
    // Ten test nie sprawdza bazy (do tego jest pgTAP) - sprawdza, że pokrycie
    // NIE ZNIKNĘŁO. To są reguły, po których adres z twardym odbiciem albo
    // skargą na spam wypada z audiencji ZANIM powstanie request do dostawcy,
    // oraz reguła unikalności adresu bez rozróżniania wielkości liter (bez niej
    // ta sama osoba wchodzi na listę dwa razy i dostaje kampanię podwójnie).
    for (const file of NEWSLETTER_PGTAP_TESTS) {
      const sql = read(file);
      expect(sql.length, `pusty plik pgTAP: ${file}`).toBeGreaterThan(0);
    }
  });

  it("pgTAP newslettera pilnuje ZAKRESU NAJEMCY i wykluczeń adresowych", () => {
    const sql = NEWSLETTER_PGTAP_TESTS.map((file) => read(file)).join("\n");
    for (const guarantee of ["tenant", "email", "suppression"]) {
      expect(sql, `pgTAP przestał wspominać: ${guarantee}`).toContain(guarantee);
    }
    // Deduplikacja zdarzeń kampanii to warunek uczciwego wskaźnika otwarć -
    // bez niej „otwarcia" potrafią przekroczyć liczbę dostarczonych.
    expect(sql).toContain("newsletter_campaign_events");
  });

  it("trasy newslettera mówią do operatora KLUCZAMI i18n, nie polszczyzną w kodzie", () => {
    // Bramka parytetu słowników nie widzi literału w JSX-ie, a moduł ma wersję
    // angielską. Sprawdzamy trasy, które w ogóle mają własną treść - reszta to
    // powłoki delegujące render do organizmów panelu.
    const zTrescia = NEWSLETTER_ROUTES.filter((file) =>
      /useTranslation\(/.test(read(`${ROUTES_DIR}/${file}`)),
    );
    expect(zTrescia.length, "żadna trasa newslettera nie ma własnej treści?").toBeGreaterThan(0);
    for (const file of zTrescia) {
      expect(read(`${ROUTES_DIR}/${file}`), `${file} nie woła t() ani razu`).toMatch(/\bt\("/);
    }
  });
});

// ---------------------------------------------------------------------------
// PANEL SPOŁECZNOŚCI POZA KLUBAMI
// rozszerzenie zakresu bramki (2026-09-02, moduł 16)
// ---------------------------------------------------------------------------
//
// PO CO. Bramka widziała z modułu społeczności WYŁĄCZNIE podrodzinę
// `admin.community.clubs.*` (sześć tras, sekcja „panel klubów - autorytet
// dostępu" wyżej). Pozostałe DZIESIĘĆ tras panelu społeczności - w tym
// `admin.community.qa.tsx`, przez które przechodzi moderacja pytań
// publiczności i PUBLIKACJA podsumowania sesji jako treści - nie było na
// żadnej z list tego pliku: ani na `CLUB_ROUTES`, ani na `NEWSLETTER_ROUTES`,
// ani na `MODULE19_ROUTES`. Skutek: gdyby ktoś dołożył tam własny warunek
// roli albo zbudował zapytanie do Supabase z pominięciem warstwy `lib/`,
// bramka by tego nie zauważyła.
//
// DLACZEGO REGUŁA JEST TU INNA NIŻ DLA KLUBÓW. Struktura klubów jest domeną
// wyłącznie admina, więc TAM każda trasa MUSI sprawdzać `isAdmin` sama.
// Społecznością (Q&A, ankiety, czat, odznaki, powiadomienia) zarządza CAŁA
// redakcja - `isStaff` z layoutu `/admin` jest tu bramką właściwą, a własny
// warunek roli w trasie byłby defektem w drugą stronę: panel odmawiałby
// czegoś, do czego RLS i tak dopuszcza (polityki `qa sessions staff all`,
// `qa questions staff read` wymieniają `admin` ORAZ `editor`, a dodatkowo
// przepuszczają gospodarza sesji).
//
// STAN i SKLEJENIE tych tras pokrywają osobne pliki
// (`adminCommunityQaRoute.test.tsx`, `adminCommunityChatRoute.test.tsx`,
// `adminCommunityNotificationsRoute.test.tsx`). Tutaj - wyłącznie AUTORYTET.

/** Rodzina `admin.community.*` BEZ podrodziny klubów (ta ma sekcję wyżej). */
const COMMUNITY_ROUTES = [
  "admin.community.tsx",
  "admin.community.index.tsx",
  "admin.community.qa.tsx",
  "admin.community.polls.tsx",
  "admin.community.events.tsx",
  "admin.community.chat.tsx",
  "admin.community.badges.tsx",
  "admin.community.contributors.tsx",
  "admin.community.engagement.tsx",
  "admin.community.notifications.tsx",
] as const;

/** pgTAP autorytetu Q&A - anonimowość pytających i workflow publikacji. */
const COMMUNITY_QA_PGTAP = [
  "supabase/tests/community_qa_test.sql",
  "supabase/tests/community_qa_summary_test.sql",
] as const;

describe("panel społeczności - autorytet dostępu", () => {
  it("wszystkie dziesięć tras rodziny `admin.community` (poza klubami) istnieje", () => {
    // Bez tego bramka zrobiłaby się pusta po zmianie nazwy pliku i MILCZAŁA.
    const present = adminRoutes();
    for (const file of COMMUNITY_ROUTES) {
      expect(present, `brak trasy ${file}`).toContain(file);
    }
    // Skan widzi CAŁĄ rodzinę razem z klubami, także pliki dodane po napisaniu
    // tej listy - inaczej nowa trasa panelu społeczności wchodziłaby poza
    // zasięg bramki bez żadnego sygnału.
    const skan = present.filter((name) => name.startsWith("admin.community"));
    expect(skan.length).toBeGreaterThanOrEqual(COMMUNITY_ROUTES.length + CLUB_ROUTES.length);
  });

  it("dostępu pilnuje layout `/admin` - żadna z tych tras nie udaje własnej bramki", () => {
    // Społecznością zarządza cała redakcja (`isStaff` = admin/editor/author),
    // więc brak własnego `isAdmin` jest tu POPRAWNY, a nie przeoczony.
    // `useAuth` samo w sobie nie jest zakazane (`admin.community.badges`
    // czyta z niego `tenantId` do zapytań) - zakazany jest WARUNEK ROLI, bo
    // to on rozjeżdża się z regułami bazy przy pierwszej zmianie ról.
    const zRolaWTrasie = COMMUNITY_ROUTES.filter((file) =>
      /isAdmin|isSuperAdmin|isStaff/.test(read(`${ROUTES_DIR}/${file}`)),
    );
    expect(zRolaWTrasie).toEqual([]);
    // …a skoro tak, layout MUSI być jedyną i realną bramką.
    expect(read(ADMIN_LAYOUT)).toMatch(/isStaff/);
  });

  it("trasy społeczności nie budują WŁASNYCH zapytań do Supabase", () => {
    // Zapytanie zbudowane w pliku trasy omija warstwę `src/lib/admin/*`,
    // w której mieszka wybór kolumn - a w Q&A ten wybór jest regułą
    // prywatności: `qa_questions.user_id` jest odcięty grantem i lista kolumn
    // musi go pomijać, inaczej odczyt w ogóle się nie powiedzie.
    const offenders = COMMUNITY_ROUTES.filter((file) =>
      /@\/integrations\/supabase|supabaseAdmin|\bsupabase\s*\n?\s*\.from\(/.test(
        read(`${ROUTES_DIR}/${file}`),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("trasy społeczności mówią do operatora KLUCZAMI i18n, nie polszczyzną w kodzie", () => {
    // Bramka parytetu słowników nie widzi literału w JSX-ie, a moduł ma wersję
    // angielską. Sprawdzamy trasy, które w ogóle mają własną treść - reszta to
    // powłoki delegujące render do organizmów panelu.
    const zTrescia = COMMUNITY_ROUTES.filter((file) =>
      /useTranslation\(/.test(read(`${ROUTES_DIR}/${file}`)),
    );
    expect(zTrescia.length, "żadna trasa społeczności nie ma własnej treści?").toBeGreaterThan(0);
    for (const file of zTrescia) {
      expect(read(`${ROUTES_DIR}/${file}`), `${file} nie woła t() ani razu`).toMatch(/\bt\("/);
    }
  });

  it("autorytet Q&A jest pokryty pgTAP - anonimowość i workflow publikacji", () => {
    // Ten test nie sprawdza bazy (do tego jest pgTAP) - sprawdza, że pokrycie
    // NIE ZNIKNĘŁO. To są reguły, po których (a) tożsamość pytającego nie
    // opuszcza bazy i (b) publikacja podsumowania wymaga roli redakcyjnej.
    for (const file of COMMUNITY_QA_PGTAP) {
      expect(read(file).length, `pusty plik pgTAP: ${file}`).toBeGreaterThan(0);
    }
    const sql = COMMUNITY_QA_PGTAP.map((file) => read(file)).join("\n");
    expect(sql, "pgTAP przestał pilnować odcięcia kolumny user_id").toContain("user_id");
    expect(sql).toContain("publish_qa_session_summary");
    expect(sql).toContain("publish requires editorial role");
  });

  it("panel Q&A nie oferuje publikacji jako akcji cichej - ma osobną drogę na szkic", () => {
    // Ten sam wzorzec, który znalazł defekt z nagłówka pliku (panel oferuje
    // akcję, którą baza odrzuci). RPC `publish_qa_session_summary` przepuszcza
    // szkic dla redaktora i gospodarza, a PUBLIKACJĘ tylko dla
    // `can_publish_content`. Panel musi mieć OBIE drogi widoczne obok siebie,
    // inaczej redaktor ma jeden przycisk, który zawsze kończy się odmową.
    const source = read(`${ROUTES_DIR}/admin.community.qa.tsx`);
    expect(source).toMatch(/publishQaSessionSummary\(session\.id, publish\)/);
    expect(source).toMatch(/adminCommunity\.qa\.createDraft/);
    expect(source).toMatch(/adminCommunity\.qa\.publishNow/);
    expect(source).toMatch(/adminCommunity\.qa\.publishingRequiresAdminRole/);
  });
});

// Rodzina karier - dwie trasy panelu rekrutacji, które ta bramka do 03.09.2026
// NIE WIDZIAŁA. Bramka pilnuje autorytetu dostępu przez JAWNE listy rodzin
// (kluby, newsletter, moduł 19, SEO, społeczność); rodziny karier nie było na
// żadnej z nich, więc dołożenie w tych trasach własnego - i niezgodnego z bazą -
// warunku roli przechodziłoby po cichu. Dziurę wykrył `adminHiringRoute.test.tsx`
// i zapisał jako `it.fails` z kontrolą dodatnią; ta sekcja ją zamyka, a tamten
// `it.fails` przy najbliższym przebiegu zapali się jako NIEOCZEKIWANIE ZIELONY
// i wymusi zamianę na zwykły `it` - czyli dokładnie tak, jak ten wzorzec ma
// działać.
const CAREERS_ROUTES = ["admin.careers.tsx", "admin.hiring.tsx"] as const;

/** Tabele, do których panel rekrutacji ma prawo pisać WPROST (pod RLS). */
const CAREERS_TABLES = [
  "career_application_events",
  "career_applications",
  "career_cv_gc_queue",
  "career_page_sections",
  "career_roles",
  "career_settings",
  "contact_messages",
  "crm_leads",
] as const;

/** Migracja zakładająca zakres najemcy i polityki `is_staff()` dla karier. */
const CAREERS_TENANT_MIGRATION = "supabase/migrations/20260814100000_careers_tenant_scope.sql";

/** Treść jednego `CREATE POLICY ...;` z pliku migracji (do porównań progu roli). */
function policyBlock(migrationFile: string, policy: string): string {
  const sql = read(`${MIGRATIONS_DIR}/${migrationFile}`);
  return sql.slice(sql.indexOf(`CREATE POLICY ${policy}`)).split(";")[0];
}

/** Migracje definiujące daną politykę, w kolejności wykonania (ostatnia obowiązuje). */
function migrationsDefining(policy: string): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .filter((file) => read(`${MIGRATIONS_DIR}/${file}`).includes(`CREATE POLICY ${policy}`));
}

/** Definicja OBOWIĄZUJĄCA - z ostatniej migracji, która politykę odtwarza. */
function effectivePolicy(policy: string): { file: string; block: string } {
  const defining = migrationsDefining(policy);
  if (defining.length === 0) throw new Error(`test: nikt nie definiuje polityki ${policy}`);
  const file = defining[defining.length - 1];
  return { file, block: policyBlock(file, policy) };
}

describe("panel rekrutacji - autorytet dostępu", () => {
  it("obie trasy rodziny karier istnieją", () => {
    // Kanarek: bez tego bramka zrobiłaby się pusta po zmianie nazwy pliku
    // i MILCZAŁA, zamiast zapalić się na braku trasy.
    const present = adminRoutes();
    for (const file of CAREERS_ROUTES) {
      expect(present, `brak trasy ${file}`).toContain(file);
    }
    // Skan widzi CAŁĄ rodzinę, także trasy dodane po napisaniu tej listy -
    // inaczej nowy panel rekrutacji wchodziłby poza zasięg bramki bez sygnału.
    const skan = present.filter(
      (name) => name.startsWith("admin.careers") || name.startsWith("admin.hiring"),
    );
    expect(skan.length).toBe(CAREERS_ROUTES.length);
  });

  it("dostępu pilnuje layout `/admin` - żadna z tych tras nie udaje własnej bramki", () => {
    // Rekrutację prowadzi cała redakcja (`isStaff` = admin/editor/author), więc
    // brak własnego `isAdmin` jest tu POPRAWNY, a nie przeoczony. Zakazany jest
    // WARUNEK ROLI w trasie, bo to on rozjeżdża się z regułami bazy przy
    // pierwszej zmianie ról - a tu po drugiej stronie stoją polityki
    // `career_*_staff_*` pytające `public.is_staff()`.
    const zRolaWTrasie = CAREERS_ROUTES.filter((file) =>
      /isAdmin|isSuperAdmin|isStaff/.test(read(`${ROUTES_DIR}/${file}`)),
    );
    expect(zRolaWTrasie).toEqual([]);
    expect(read(ADMIN_LAYOUT)).toMatch(/isStaff/);
    const sql = read(CAREERS_TENANT_MIGRATION);
    expect(sql, "polityki karier przestały pytać o `is_staff()`").toContain("public.is_staff()");
  });

  it("ŻADNA trasa rekrutacji nie sięga po klienta z rolą serwisową", () => {
    // NAJWAŻNIEJSZY INWARIANT TEJ SEKCJI. Oba panele obracają DANYMI OSOBOWYMI
    // kandydatów (imię, kontakt, plik CV w prywatnym kubełku). Klient
    // `service_role` omija RLS W CAŁOŚCI, więc jeden taki import zamieniłby
    // panel pod polityką najemcy w panel bez granic - i to bez śladu w typach.
    // Ta reguła nie jest teoretyczna: sąsiedni endpoint `jobs-tick` NAPRAWDĘ
    // używa `supabaseAdmin`, więc wzorzec jest w repo dostępny „pod ręką".
    const offenders = CAREERS_ROUTES.filter((file) =>
      /client\.server|supabaseAdmin/.test(read(`${ROUTES_DIR}/${file}`)),
    );
    expect(offenders).toEqual([]);
  });

  it("trasy rekrutacji nie piszą WPROST do tabel uprzywilejowanych", () => {
    const zakazane = ["user_roles", "tenants", "role_audit_log", "user_consents"] as const;
    for (const file of CAREERS_ROUTES) {
      const source = read(`${ROUTES_DIR}/${file}`);
      for (const table of zakazane) {
        expect(source, `${file} pisze wprost do ${table}`).not.toMatch(
          new RegExp(`from\\("${table}"\\)`),
        );
      }
    }
  });

  it("zbiór tabel dotykanych przez panel rekrutacji nie rośnie po cichu", () => {
    // RATCHET ZAKRESU, nie ozdoba. Te trasy budują zapytania W SOBIE (inaczej
    // niż rodzina społeczności, która schodzi przez `src/lib/admin/*`), więc
    // nowa tabela pojawia się tu jednym `.from("...")` - bez przeglądu, bez
    // migracji polityki i bez wpisu w rejestrze własnicielskim. Lista jest
    // JAWNA, żeby takie poszerzenie wymagało zmiany tej bramki, a więc rozmowy.
    const dotykane = new Set<string>();
    for (const file of CAREERS_ROUTES) {
      for (const match of read(`${ROUTES_DIR}/${file}`).matchAll(/\.from\("([a-z_]+)"\)/g)) {
        dotykane.add(match[1]);
      }
    }
    expect([...dotykane].sort()).toEqual([...CAREERS_TABLES]);
  });

  it("próg roli tabel TREŚCIOWYCH karier jest ten sam W KAŻDEJ migracji, która go definiuje", () => {
    // PO CO TA ASERCJA JEST TUTAJ, A NIE W TEŚCIE TRASY. Test trasy dowodzi
    // zgodności „panel wpuszcza dokładnie tych, których wpuszcza baza",
    // czytając JEDNĄ migrację. To za mało: `career_roles_staff_write` jest
    // definiowane w TRZECH migracjach (20260813224302, 20260814100000,
    // 20260814122639), a obowiązuje OSTATNIA. Test czytający pierwszą z nich
    // zostaje zielony także wtedy, gdy ktoś zmieni próg w najnowszej -
    // czyli dowodzi inwariantu o polityce obowiązującej, patrząc na tekst
    // zastąpiony. Ta bramka sprawdza WSZYSTKIE definicje razem, więc
    // rozjechanie się ich progów zapala się tutaj, niezależnie od tego, którą
    // migrację czyta który test.
    const contentPolicies = [
      "career_roles_staff_write",
      "career_roles_staff_update",
      "career_roles_staff_delete",
      "career_sections_staff_write",
      "career_sections_staff_update",
    ] as const;
    for (const policy of contentPolicies) {
      // `migrationsDefining` SORTUJE, i to nie jest kosmetyka: `readdirSync`
      // oddaje wpisy w kolejności zależnej od systemu plików (na ext4 jest to
      // kolejność haszowa, nie nazwowa), a ten test rozstrzyga, KTÓRA definicja
      // obowiązuje, po OSTATNIM elemencie listy. Bez sortowania bramka mogłaby
      // na innym checkoucie zatwierdzić definicję ZASTĄPIONĄ - czyli popełnić
      // dokładnie ten błąd, przeciw któremu została napisana.
      // ZNALEZISKO Codeksa na PR #326, potwierdzone pomiarem: przy odwróconej
      // kolejności listingu stara wersja wybierała `20260813224302` (sprzed
      // zakresowania najemcy) i przechodziła, choć zakres mógł już nie istnieć
      // w migracji obowiązującej.
      const defining = migrationsDefining(policy);
      expect(defining.length, `nikt już nie definiuje polityki ${policy}`).toBeGreaterThan(0);
      // PRÓG ROLI musi być ten sam w KAŻDEJ definicji - to on rozjeżdża się
      // z bramką panelu i to jego zmiana w najnowszej migracji przeszłaby
      // niezauważona przez test czytający starszą.
      for (const file of defining) {
        const block = policyBlock(file, policy);
        expect(block, `${policy} w ${file} nie pyta o public.is_staff()`).toContain(
          "public.is_staff()",
        );
      }
      // ZAKRES NAJEMCY sprawdzamy tylko w definicji OBOWIĄZUJĄCEJ. Żądanie go
      // od wszystkich byłoby asercją nieprawdziwą: `20260813224302` powstało
      // PRZED zakresowaniem i ma `WITH CHECK (public.is_staff())` bez najemcy -
      // zakres dołożyła dopiero `20260814100000_careers_tenant_scope`. Bramka
      // ma pilnować stanu obowiązującego, nie przepisywać historii.
      const effective = defining[defining.length - 1];
      expect(
        policyBlock(effective, policy),
        `${policy} zgubiło zakres najemcy w obowiązującej ${effective}`,
      ).toContain("public.current_tenant_id()");
    }
  });

  it("zaostrzenie progu dla ZGŁOSZEŃ kandydatów nie zostało cicho cofnięte", () => {
    // Migracja 20260824074231 przestawiła `career_applications*` z
    // `is_staff()` na `is_admin_or_editor()` - różnica to DOKŁADNIE rola
    // `author`, która od tamtej pory nie widzi procesów rekrutacyjnych,
    // dziennika etapów ani kubełka CV. Uprząż runtime sprawdza to na żywej
    // bazie (§15 `scripts/careers-harness/runtime_test.sql`); tutaj stoi
    // tańszy strażnik statyczny: NAJNOWSZA definicja tych polityk nie może
    // wrócić do `is_staff()`.
    for (const policy of [
      "career_applications_staff_read",
      "career_applications_staff_update",
      "career_application_events_staff_read",
    ] as const) {
      const defining = migrationsDefining(policy);
      expect(defining.length, `nikt już nie definiuje polityki ${policy}`).toBeGreaterThan(0);
      const last = defining[defining.length - 1];
      const sql = read(`${MIGRATIONS_DIR}/${last}`);
      const block = sql.slice(sql.indexOf(`CREATE POLICY ${policy}`)).split(";")[0];
      expect(block, `${policy} wróciło do is_staff() w ${last}`).toContain("is_admin_or_editor()");
    }
  });

  it("kubełek `career-cv` NIE MOŻE zgubić wiązania najemcy - to już raz się cofnęło", () => {
    // TA BRAMKA POWSTAŁA NA WYRAŹNE ŻĄDANIE MIGRACJI NAPRAWCZEJ.
    // `20260814194500_career_cv_policies_tenant_scope_reassert.sql` opisuje we
    // własnym nagłówku, co się stało: `20260814100000` zawęziło trzy polityki
    // bucketu do najemcy, bo `is_staff()` bada WYŁĄCZNIE rolę - więc redaktor
    // najemcy A mógł podpisać i pobrać KAŻDE CV każdego najemcy. Trzy godziny
    // później platforma zapisała wygenerowaną `20260814122512`, odpowiednik
    // stanu SPRZED hardeningu, który tę samą trójkę odtworzył bez najemcy.
    // I dalej cytat z tamtego nagłówka: „Stan końcowy bazy uratowała WYŁĄCZNIE
    // kolejność plików. (…) Gdyby bliźniak dostał wcześniejszy znacznik czasu -
    // izolacja najemców na plikach CV byłaby dziś otwarta na produkcji,
    // A ŻADNA BRAMKA BY TEGO NIE POWIEDZIAŁA." Od teraz powie.
    //
    // Mierzymy definicję OBOWIĄZUJĄCĄ, czyli z ostatniej migracji odtwarzającej
    // politykę - dokładnie tak, jak rozstrzyga to Postgres.
    for (const policy of ['"career_cv_staff_read"', '"career_cv_staff_delete"'] as const) {
      const { file, block } = effectivePolicy(policy);
      expect(block, `${policy} zgubiło najemcę w obowiązującej ${file}`).toContain(
        "public.current_tenant_id()::text",
      );
      expect(block, `${policy} zgubiło próg roli w obowiązującej ${file}`).toMatch(
        /public\.(is_staff|is_admin_or_editor)\(\)/,
      );
    }
  });

  it("wgranie CV przez KANDYDATA wymusza ścieżkę z najemcą, bez warunku roli", () => {
    // Ta polityka jest dla `anon` - kandydat z zewnątrz nie ma roli i mieć jej
    // nie może, więc najemcę wymusza KSZTAŁT ŚCIEŻKI: dokładnie trzy segmenty,
    // pierwszy równy najemcy przeglądanego hosta, drugi `uploads`. Zdjęcie
    // któregokolwiek z tych warunków otwiera zapis w katalogu obcego najemcy.
    const { file, block } = effectivePolicy('"career_cv_public_upload"');
    expect(block, `zapis CV przestał liczyć segmenty ścieżki (${file})`).toContain(
      "array_length(storage.foldername(name), 1) = 3",
    );
    expect(block, `zapis CV przestał przypinać najemcę hosta (${file})`).toContain(
      "public.public_tenant_id()::text",
    );
    expect(block, `zapis CV przestał wymagać katalogu uploads (${file})`).toContain("'uploads'");
    // Kontrola dodatnia sensu tej polityki: jest dla anonima, więc NIE MA
    // w niej progu roli - i to jest poprawne, a nie przeoczone.
    expect(block).toContain("TO anon");
    expect(block).not.toContain("is_staff()");
  });

  it("plik CV kandydata wychodzi z panelu WYŁĄCZNIE jako krótkotrwały podpis", () => {
    // Kubełek `career-cv` jest prywatny, a panel nie ma prawa budować adresu
    // publicznego. `signCvUrl` domyślnie podpisuje na 300 sekund i to jedyna
    // droga do pliku - `getPublicUrl` w tej ścieżce byłby wyciekiem danych
    // osobowych do każdego, kto zobaczy adres.
    const layer = read("src/lib/careers/cvUpload.ts");
    expect(layer).toMatch(/createSignedUrl\(path, expiresInSeconds\)/);
    expect(layer).toMatch(/expiresInSeconds\s*=\s*300/);
    expect(layer, "warstwa CV zaczęła budować adres publiczny").not.toContain("getPublicUrl");
    const panel = read(`${ROUTES_DIR}/admin.careers.tsx`);
    expect(panel).toContain("signCvUrl");
    expect(panel, "panel zaczął budować adres do CV sam").not.toContain("createSignedUrl");
  });
});
