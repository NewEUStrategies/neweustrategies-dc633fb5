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
    const shell = `${read(SHELL)}\n${read(NAV_MAP)}`;
    const gated = [
      ...shell.matchAll(/isSuperAdmin\s*\?\s*\[\{[^]]*?to:\s*"\/admin\/([a-z0-9-]+)"/g),
    ]
      .map((match) => match[1])
      .filter((slug, index, all) => all.indexOf(slug) === index);
    // Kanarek: gdyby wzorzec przestał pasować, bramka zrobiłaby się pusta.
    expect(gated.length).toBeGreaterThan(0);

    const offenders = gated.filter((slug) => {
      const file = `admin.${slug}.tsx`;
      if (!adminRoutes().includes(file)) return false;
      const source = read(`${ROUTES_DIR}/${file}`);
      return !/isSuperAdmin/.test(source);
    });
    expect(offenders).toEqual([]);
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
