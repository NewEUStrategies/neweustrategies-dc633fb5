// BRAMKA: REGULAMINY, GRUPY I NADANIA SA ADMINISTRACYJNE - REDAKTOR NIE WCHODZI.
//
// PO CO TEN PLIK ISTNIEJE. Cala warstwa autoryzacji tego podmodulu opiera sie
// na JEDNYM zdaniu w kazdej funkcji RPC: `v_tenant := assert_editor_tenant();`.
// Nazwa tej oslony KLAMIE - od migracji `20260824090000` deleguje ona do
// `assert_event_admin_tenant()` i redaktora ODRZUCA (komentarz w bazie zaczyna
// sie od slowa WYCOFANA). Alias zostal wylacznie po to, zeby 160 istniejacych
// wywolan zmienilo zachowanie bez przepisywania cial funkcji.
//
// TO JEST DOKLADNIE TAKI KSZTALT, KTORY PSUJE SIE PO CICHU:
//   * ktos „porzadkuje" nazwe i przepina funkcje na `assert_event_staff_tenant`,
//     bo tak brzmi bardziej po ludzku - i modul otwiera sie dla redakcji;
//   * albo ktos przedeklarowuje sam alias na wlasne sprawdzenie roli - nazwa
//     zostaje ta sama, a wszystkie wywolania cicho wpuszczaja redaktora.
// W obu przypadkach `tsc` przechodzi, lint przechodzi, testy komponentow
// przechodza (klient nie zna rol bazy), a ekran uprawnien staje otworem.
//
// PARA JEST TU WBUDOWANA W BAZE I POWTORZONA W ASERCJACH: oslona
// administracyjna ma byc na KAZDEJ funkcji tego podmodulu, a oslona `staff` -
// na ZADNEJ; przy czym `staff` NIE jest martwa (ekran LISTY wydarzen zostaje
// powierzchnia redakcyjna), wiec czytnik musi ja gdzies widziec. Bez tej
// drugiej polowy asercja „zadna funkcja nie uzywa staffa" bylaby spelniona
// takze przez czytnik, ktory nie widzi niczego.
//
// ODPOWIEDNIK WYKONAWCZY: `scripts/events-harness/runtime_test.d/80_admin_only.sql`
// (redaktor dostaje `admin role required` z aliasu I z wersji administracyjnej,
// administrator przechodzi, redaktor NADAL przechodzi przez oslone staff) oraz
// `supabase/tests/event_admin_only_contract_test.sql` na bramce pgtap. Tutaj
// czytamy sam tekst migracji - to jedyne zrodlo, ktore bramka vitest ma pod
// reka, ale za to sprawdzane przy KAZDYM przebiegu testow, a nie tylko tam,
// gdzie stoi zywy Postgres.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const API_DIR = join(process.cwd(), "src", "lib", "events");

/** Modul kliencki -> funkcje, ktore wola. Zrodlem sa wywolania `rpc("...")`. */
const MODULY = ["termsGroupsApi", "audienceGrantsApi"] as const;

/**
 * Ciala funkcji po odtworzeniu calego lancucha migracji - OSTATNIA DEFINICJA
 * WYGRYWA, tak jak przy `supabase db push`. Funkcje tego modulu bywaja
 * przepisywane kilka razy (plik opisowy, pozniej migracja panelu z UUID-em
 * w nazwie) i obowiazuje ta pozniejsza.
 */
function functionBodies(): Map<string, string> {
  const out = new Map<string, string>();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const head = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
    for (const match of sql.matchAll(head)) {
      // Cialo jest w cudzyslowie dolarowym, a tag bywa rozny: `$$`, `$fn$`.
      // Szukamy PIERWSZEGO otwarcia po naglowku (dalej stoi lista argumentow
      // i `RETURNS`, wiec okno jest z zapasem) i jego domkniecia.
      const window = sql.slice(match.index, match.index + 4000);
      const open = /\$([a-z0-9_]*)\$/i.exec(window);
      if (open === null) continue;
      const tag = open[0];
      const start = match.index + open.index + tag.length;
      const end = sql.indexOf(tag, start);
      if (end === -1) continue;
      out.set(match[1], sql.slice(start, end));
    }
  }
  return out;
}

const BODIES = functionBodies();

/** Nazwy RPC, ktore wola warstwa kliencka podmodulu. */
function calledFunctions(): string[] {
  const found = new Set<string>();
  for (const moduleName of MODULY) {
    const source = readFileSync(join(API_DIR, `${moduleName}.ts`), "utf8");
    for (const match of source.matchAll(/\brpc\(\s*"([a-z0-9_]+)"/g)) found.add(match[1]);
  }
  return [...found].sort();
}

const WOLANE = calledFunctions();

const OSLONA_ADMIN = /assert_(?:event_admin|editor)_tenant\s*\(\s*\)/;
const OSLONA_STAFF = /assert_event_staff_tenant\s*\(\s*\)/;

describe("bramka nie jest prozna", () => {
  it("czytnik widzi ciala funkcji i wywolania klienta", () => {
    expect(BODIES.size).toBeGreaterThan(100);
    expect(WOLANE.length).toBeGreaterThanOrEqual(8);
  });

  it("kazda wolana funkcja ma definicje w migracjach", () => {
    expect(WOLANE.filter((name) => !BODIES.has(name))).toEqual([]);
  });

  // KONTROLA DODATNIA CZYTNIKA. Gdyby wyrazenie na oslone `staff` nie pasowalo
  // do niczego, asercja „zadna funkcja podmodulu jej nie uzywa" byla by
  // spelniona przez pomylke. Oslona staffa ISTNIEJE i JEST uzywana - przez trzy
  // funkcje ekranu LISTY wydarzen, ktory zostaje powierzchnia redakcyjna.
  it("oslona `staff` istnieje i jest uzywana gdzie indziej w bazie", () => {
    expect(BODIES.has("assert_event_staff_tenant")).toBe(true);
    const uzywajace = [...BODIES.entries()].filter(
      ([name, body]) => name !== "assert_event_staff_tenant" && OSLONA_STAFF.test(body),
    );
    expect(uzywajace.length).toBeGreaterThan(0);
  });
});

describe("para oslon: administracyjna na KAZDEJ funkcji, staffowa na ZADNEJ", () => {
  it.each(WOLANE)("`%s` otwiera sie oslona administracyjna", (name) => {
    const body = BODIES.get(name);
    expect(body, `brak ciala funkcji ${name}`).toBeDefined();
    expect(OSLONA_ADMIN.test(body ?? "")).toBe(true);
  });

  it.each(WOLANE)("`%s` NIE stoi na oslonie dla redakcji", (name) => {
    expect(OSLONA_STAFF.test(BODIES.get(name) ?? "")).toBe(false);
  });
});

describe("alias `assert_editor_tenant` nadal deleguje do wersji administracyjnej", () => {
  // TA SAMA ASERCJA, CO PUNKT 4 W `80_admin_only.sql`. Gdyby ktoras migracja
  // przedeklarowala alias na wlasne sprawdzenie roli, nazwa zostalaby ta sama,
  // a wszystkie wywolania w cialach funkcji podmodulu po cichu znow wpuscilyby
  // redakcje - bez ani jednej zmiany po stronie klienta.
  it("cialo aliasu wola `assert_event_admin_tenant`", () => {
    const alias = BODIES.get("assert_editor_tenant");
    expect(alias).toBeDefined();
    expect(alias ?? "").toMatch(/assert_event_admin_tenant/);
  });

  it("alias NIE sprawdza roli `editor` na wlasna reke", () => {
    expect(BODIES.get("assert_editor_tenant") ?? "").not.toMatch(/'editor'/);
  });

  // KOD ODMOWY JEST CZESCIA KONTRAKTU Z EKRANEM: `adminTermsErrors` czyta GLOWE
  // komunikatu (`forbidden`), a `80_admin_only.sql` sprawdza jego OGON
  // (`admin role required`). Zmiana tekstu w bazie zabralaby redaktorowi
  // nazwane zdanie i zostawila „Nie udalo sie wykonac operacji".
  it("oslona administracyjna odmawia tekstem `forbidden: admin role required`", () => {
    const admin = BODIES.get("assert_event_admin_tenant");
    expect(admin).toBeDefined();
    expect(admin ?? "").toMatch(/RAISE EXCEPTION 'forbidden: admin role required'/);
  });

  it("oslona administracyjna odmawia takze bez zalogowanego uzytkownika", () => {
    expect(BODIES.get("assert_event_admin_tenant") ?? "").toMatch(
      /RAISE EXCEPTION 'forbidden: authentication required'/,
    );
  });

  // SUPER ADMINISTRATOR TO TA SAMA USTERKA OD DRUGIEJ STRONY: `has_role` czyta
  // wiersz `user_roles` SCISLE i nie obejmuje `super_admin`, wiec oslona bez
  // `is_super_admin` zamykalaby go przed jego wlasnymi danymi.
  it("oslona administracyjna zna super administratora", () => {
    expect(BODIES.get("assert_event_admin_tenant") ?? "").toMatch(/is_super_admin/);
  });
});
