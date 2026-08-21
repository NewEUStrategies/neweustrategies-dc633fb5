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
