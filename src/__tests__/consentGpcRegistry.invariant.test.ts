/**
 * Bramka inwariantu: REJESTR ZGÓD MA ZNACZNIK GPC I NIEPODRABIALNĄ ŚCIEŻKĘ ZAPISU.
 *
 * PRZYCZYNA ŹRÓDŁOWA (audyt „Zgody / prywatność", punkt otwarty w trzech
 * wydaniach z rzędu: „Brak GPC / »do not sell« - zero wystąpień `Sec-GPC`").
 * Rejestr `user_consents` / `user_consent_events` zapisywał IP, UA, wersję,
 * język i źródło - wszystko poza stanem ogólnego sygnału sprzeciwu. Zamyka to
 * migracja 20260803140001.
 *
 * Test jest STATYCZNY (bez bazy), bo migracje są forward-only: o stanie końcowym
 * decyduje OSTATNIA instrukcja dotykająca danego obiektu. Sama obecność migracji
 * naprawczej nic nie gwarantuje - dowolna późniejsza migracja mogłaby przywrócić
 * klientowi INSERT do rejestru (i wtedy `gpc = false` dałoby się sobie wpisać
 * ręcznie, obchodząc sygnał) albo usunąć kolumnę. Bramka pilnuje STANU
 * KOŃCOWEGO, nie faktu istnienia poprawki - dokładnie ta klasa regresji
 * powtarzała się w audycie (patrz `accountDeletionRetention.invariant.test.ts`).
 *
 * INWARIANTY:
 *   A. `user_consents` i `user_consent_events` mają kolumnę `gpc` oraz `tenant_id`.
 *   B. `set_user_consent` istnieje w sygnaturze przyjmującej `p_gpc` i zapisuje
 *      go do OBU tabel.
 *   C. Rola kliencka (`anon` / `authenticated`) nie ma na tych tabelach ani
 *      GRANT-u INSERT/UPDATE/DELETE, ani polityki INSERT-capable - zapis idzie
 *      wyłącznie przez SECURITY DEFINER RPC.
 *   D. `p_gpc` nie ma wartości domyślnej: sygnał prawny nie może być milcząco
 *      zakładany jako nieobecny.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const REGISTRY_TABLES = ["user_consents", "user_consent_events"] as const;

/**
 * Usuwa komentarze liniowe `--`, zachowując podział na linie. Bez tego bramka
 * trafiałaby we WŁASNY nagłówek migracji naprawczej, która cytuje naprawiany
 * wzorzec („grant INSERT/UPDATE/DELETE") - i raportowała regresję, której nie ma.
 * Literały w apostrofach są respektowane, żeby `'--'` w treści nie ucinał kodu.
 */
function stripLineComments(sql: string): string {
  let out = "";
  let inSingle = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (!inSingle && ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) break;
      i = nl - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

interface Migration {
  readonly file: string;
  readonly sql: string;
}

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: stripLineComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
    }));
}

const migrations = loadMigrations();
const allSql = migrations.map((m) => m.sql).join("\n");

/** Ostatnia migracja, w której dany wzorzec występuje (stan końcowy). */
function lastMatch(re: RegExp): Migration | null {
  let found: Migration | null = null;
  for (const migration of migrations) {
    re.lastIndex = 0;
    if (re.test(migration.sql)) found = migration;
  }
  return found;
}

describe("inwariant A - kolumny rejestru zgód", () => {
  for (const table of REGISTRY_TABLES) {
    it(`${table} ma kolumnę gpc`, () => {
      const added = new RegExp(
        `ALTER\\s+TABLE\\s+public\\.${table}[\\s\\S]{0,400}?ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?gpc\\s+boolean`,
        "i",
      );
      expect(added.test(allSql), `brak ADD COLUMN gpc na public.${table}`).toBe(true);
    });

    it(`${table} ma stempel tenant_id (ewidencja per administrator danych)`, () => {
      const added = new RegExp(
        `ALTER\\s+TABLE\\s+public\\.${table}[\\s\\S]{0,400}?ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?tenant_id\\s+uuid`,
        "i",
      );
      expect(added.test(allSql), `brak ADD COLUMN tenant_id na public.${table}`).toBe(true);
    });

    it(`kolumna gpc na ${table} nigdy nie zostaje usunięta`, () => {
      const dropped = new RegExp(
        `ALTER\\s+TABLE\\s+public\\.${table}[\\s\\S]{0,200}?DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?gpc\\b`,
        "i",
      );
      expect(dropped.test(allSql)).toBe(false);
    });
  }
});

describe("inwariant B/D - set_user_consent przyjmuje i zapisuje p_gpc", () => {
  it("istnieje sygnatura z parametrem p_gpc", () => {
    const withGpc =
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.set_user_consent\s*\([^)]*p_gpc\s+boolean/i;
    expect(withGpc.test(allSql), "brak sygnatury set_user_consent z p_gpc").toBe(true);
  });

  it("p_gpc jest WYMAGANY (bez DEFAULT) - sygnał prawny nie ma cichego domyślnego", () => {
    const definitions = allSql.match(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.set_user_consent\s*\([^)]*\)/gi,
    );
    expect(definitions, "brak definicji set_user_consent").not.toBeNull();
    const withGpc = (definitions ?? []).filter((d) => /p_gpc/i.test(d));
    expect(withGpc.length).toBeGreaterThan(0);
    for (const definition of withGpc) {
      expect(
        /p_gpc\s+boolean\s+DEFAULT/i.test(definition),
        "p_gpc nie może mieć DEFAULT (patrz uzasadnienie w migracji: jednoznaczność PostgREST)",
      ).toBe(false);
    }
  });

  it("zapisuje gpc do stanu ORAZ do audit-logu", () => {
    const definition = lastMatch(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.set_user_consent\s*\([^)]*p_gpc/i,
    );
    expect(definition, "brak migracji definiującej set_user_consent z p_gpc").not.toBeNull();
    const sql = definition?.sql ?? "";
    for (const table of REGISTRY_TABLES) {
      const insert = new RegExp(
        `INSERT\\s+INTO\\s+public\\.${table}[\\s\\S]{0,400}?\\bgpc\\b`,
        "i",
      );
      expect(insert.test(sql), `INSERT do public.${table} nie zapisuje kolumny gpc`).toBe(true);
    }
  });
});

describe("inwariant C - rejestr pisze wyłącznie set_user_consent", () => {
  for (const table of REGISTRY_TABLES) {
    it(`${table}: rola kliencka nie ma GRANT-u zapisu jako stanu końcowego`, () => {
      const grant = new RegExp(
        `GRANT\\s+([A-Z,\\s]*?)\\s+ON\\s+(?:TABLE\\s+)?public\\.${table}\\s+TO\\s+([A-Za-z0-9_,\\s]+)`,
        "gi",
      );
      const revoke = new RegExp(
        `REVOKE\\s+([A-Z,\\s]*?)\\s+ON\\s+(?:TABLE\\s+)?public\\.${table}\\s+FROM\\s+([A-Za-z0-9_,\\s]+)`,
        "gi",
      );

      // Stan końcowy per (rola, uprawnienie): ostatnia instrukcja wygrywa.
      const state = new Map<string, boolean>();
      const apply = (re: RegExp, granted: boolean) => {
        for (const migration of migrations) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(migration.sql)) !== null) {
            const privileges = m[1]
              .split(",")
              .map((p) => p.trim().toUpperCase())
              .filter(Boolean);
            const roles = m[2]
              .split(",")
              .map((r) => r.trim().toLowerCase())
              .filter(Boolean);
            for (const role of roles) {
              if (role !== "anon" && role !== "authenticated" && role !== "public") continue;
              for (const privilege of privileges.length > 0 ? privileges : ["ALL"]) {
                if (privilege === "ALL") {
                  for (const p of ["INSERT", "UPDATE", "DELETE"]) {
                    state.set(`${role}:${p}`, granted);
                  }
                } else {
                  state.set(`${role}:${privilege}`, granted);
                }
              }
            }
          }
        }
      };
      // Kolejność chronologiczna dla obu rodzajów instrukcji naraz: iterujemy
      // migracje osobno dla GRANT i REVOKE, a REVOKE naszej migracji jest
      // ostatni - dlatego stosujemy go po GRANT-ach.
      apply(grant, true);
      apply(revoke, false);

      const leftover = [...state.entries()]
        .filter(([key, granted]) => granted && /:(INSERT|UPDATE|DELETE)$/.test(key))
        .map(([key]) => key);
      expect(
        leftover,
        `rola kliencka nie może mieć zapisu na public.${table} - zapis idzie przez set_user_consent`,
      ).toEqual([]);
    });

    it(`${table}: nie ma polityki INSERT-capable dla roli klienckiej`, () => {
      const created = new RegExp(
        `CREATE\\s+POLICY\\s+"?([A-Za-z0-9_]+)"?\\s+ON\\s+public\\.${table}\\s+FOR\\s+(INSERT|ALL)`,
        "gi",
      );
      const dropped = new RegExp(
        `DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?"?([A-Za-z0-9_]+)"?\\s+ON\\s+public\\.${table}`,
        "gi",
      );

      const alive = new Set<string>();
      for (const migration of migrations) {
        created.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = created.exec(migration.sql)) !== null) alive.add(m[1]);
        dropped.lastIndex = 0;
        while ((m = dropped.exec(migration.sql)) !== null) alive.delete(m[1]);
      }
      expect(
        [...alive],
        `polityka INSERT/ALL na public.${table} otwiera podrabianie wpisów rejestru`,
      ).toEqual([]);
    });
  }
});
