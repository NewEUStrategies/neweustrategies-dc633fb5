/**
 * Bramka inwariantu: USUNIĘCIE KONTA NIE MOŻE ANI NISZCZYĆ DOWODÓW, ANI
 * ZOSTAWIAĆ SUROWEGO IDENTYFIKATORA OSOBY.
 *
 * PRZYCZYNA ŹRÓDŁOWA - dwa przeciwne kierunki tego samego błędu, każdy w innej
 * tabeli transakcyjnej:
 *
 *   * `payment_orders.user_id` miało `ON DELETE CASCADE` od definicji tabeli
 *     (20260624172041). `auth.admin.deleteUser()` zabierał więc całą ewidencję
 *     transakcji, mimo że art. 74 ust. 2 ustawy o rachunkowości każe ją trzymać
 *     5 lat, a art. 17 ust. 3 lit. b RODO wprost wyłącza prawo do usunięcia
 *     w takim zakresie. Naprawia to 20260803090002.
 *
 *   * `user_purchases.user_id` był `uuid NOT NULL` BEZ ŻADNEGO klucza obcego
 *     (20260601051732). Nigdy nie kaskadował - i dokładnie dlatego umknął
 *     audytowi CASCADE trzy wydania z rzędu: nie było go na liście „miejsc,
 *     gdzie CASCADE niszczy dowody", bo CASCADE tam nie było. Po usunięciu
 *     konta wiersz ZOSTAWAŁ z identyfikatorem osoby w postaci surowej, bez
 *     podstawy i bez terminu (art. 5 ust. 1 lit. e RODO). Naprawia to
 *     20260805090100.
 *
 * Test jest STATYCZNY (bez bazy), bo migracje są forward-only: o stanie
 * końcowym decyduje OSTATNIA instrukcja dotykająca danego klucza obcego. Sama
 * obecność migracji naprawczej nic nie gwarantuje - dowolna późniejsza migracja
 * mogłaby przywrócić CASCADE albo zdjąć FK, a dokładnie ten scenariusz
 * powtarzał się w audycie. Bramka pilnuje stanu końcowego, nie faktu istnienia
 * poprawki.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

const REFERENTIAL_ACTIONS = "CASCADE|SET\\s+NULL|SET\\s+DEFAULT|RESTRICT|NO\\s+ACTION";

/** Zdarzenie zmieniające stan końcowy klucza obcego `<tabela>.user_id`. */
interface FkEvent {
  readonly file: string;
  readonly at: number;
  /** `add` = FK ustanowiony (inline albo ADD CONSTRAINT), `drop` = zdjęty. */
  readonly kind: "add" | "drop";
  /** Znormalizowana akcja `ON DELETE` (tylko dla `add`). */
  readonly action: string | null;
}

/** Zdarzenie zmieniające obowiązkowość kolumny `<tabela>.user_id`. */
interface NullabilityEvent {
  readonly file: string;
  readonly at: number;
  readonly notNull: boolean;
}

/**
 * Usuwa komentarze liniowe `--`, zachowując podział na linie. Bez tego bramka
 * trafiałaby we WŁASNY nagłówek migracji naprawczej, która cytuje naprawiany
 * wzorzec ("nadal ON DELETE CASCADE") - i raportowała regresję, której nie ma.
 * Literały w apostrofach są respektowane, żeby `'--'` w treści nie ucinał kodu.
 */
function stripLineComments(sql: string): string {
  let out = "";
  let inSingle = false;
  let inDollar = false;
  for (let i = 0; i < sql.length; i += 1) {
    if (!inSingle && !inDollar && sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (!inDollar && sql[i] === "'") inSingle = !inSingle;
    if (!inSingle && sql[i] === "$" && sql[i + 1] === "$") {
      inDollar = !inDollar;
      out += "$$";
      i += 1;
      continue;
    }
    out += sql[i];
  }
  return out;
}

function normalizeAction(raw: string): string {
  return raw.replace(/\s+/g, " ").toUpperCase();
}

/**
 * Dzieli migrację na instrukcje wraz z ich pozycją w pliku. Bez tego wzorce
 * przeskakiwałyby średnik i łączyły `DROP CONSTRAINT` z sąsiednim
 * `ADD CONSTRAINT` w jedno dopasowanie - a to właśnie ich KOLEJNOŚĆ rozstrzyga
 * stan końcowy klucza obcego. Ciała `$$ ... $$` są nierozdzielne.
 */
function statements(sql: string): ReadonlyArray<{ text: string; at: number }> {
  const out: { text: string; at: number }[] = [];
  let start = 0;
  let inSingle = false;
  let inDollar = false;
  for (let i = 0; i < sql.length; i += 1) {
    if (!inDollar && sql[i] === "'") inSingle = !inSingle;
    if (!inSingle && sql[i] === "$" && sql[i + 1] === "$") {
      inDollar = !inDollar;
      i += 1;
      continue;
    }
    if (!inSingle && !inDollar && sql[i] === ";") {
      out.push({ text: sql.slice(start, i + 1), at: start });
      start = i + 1;
    }
  }
  if (start < sql.length) out.push({ text: sql.slice(start), at: start });
  return out;
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Treść wszystkich migracji w kolejności stosowania, bez komentarzy. */
const MIGRATIONS: ReadonlyArray<{ file: string; sql: string }> = migrationFiles().map((file) => ({
  file,
  sql: stripLineComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
}));

const ALL_SQL = MIGRATIONS.map((m) => m.sql).join("\n");

function isAlterOf(table: string): RegExp {
  return new RegExp(`^\\s*ALTER\\s+TABLE\\s+(?:ONLY\\s+)?public\\.${table}\\b`, "i");
}

function isCreateOf(table: string): RegExp {
  return new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?public\\.${table}\\s*\\(([\\s\\S]*)\\)\\s*;?\\s*$`,
    "i",
  );
}

function collectFkEvents(table: string): FkEvent[] {
  const events: FkEvent[] = [];
  const isAlter = isAlterOf(table);
  const isCreate = isCreateOf(table);

  for (const { file, sql } of MIGRATIONS) {
    for (const { text, at } of statements(sql)) {
      // (a) Definicja inline w CREATE TABLE.
      const created = isCreate.exec(text);
      if (created) {
        const inline = new RegExp(
          `user_id\\s+uuid[^,]*?REFERENCES\\s+auth\\.users\\s*\\(\\s*id\\s*\\)\\s*ON\\s+DELETE\\s+(${REFERENTIAL_ACTIONS})`,
          "i",
        ).exec(created[1]);
        if (inline) {
          events.push({ file, at, kind: "add", action: normalizeAction(inline[1]) });
        }
        continue;
      }

      if (!isAlter.test(text)) continue;

      // (b) ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY (user_id).
      const added = new RegExp(
        `FOREIGN\\s+KEY\\s*\\(\\s*user_id\\s*\\)[\\s\\S]*?REFERENCES\\s+auth\\.users\\s*\\(\\s*id\\s*\\)[\\s\\S]*?ON\\s+DELETE\\s+(${REFERENTIAL_ACTIONS})`,
        "i",
      ).exec(text);
      if (added) {
        events.push({ file, at, kind: "add", action: normalizeAction(added[1]) });
        continue;
      }

      // (c) ALTER TABLE ... DROP CONSTRAINT <tabela>_user_id_fkey.
      if (
        new RegExp(`DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?${table}_user_id_fkey`, "i").test(
          text,
        )
      ) {
        events.push({ file, at, kind: "drop", action: null });
      }
    }
  }

  return events;
}

function collectNullabilityEvents(table: string): NullabilityEvent[] {
  const events: NullabilityEvent[] = [];
  const isAlter = isAlterOf(table);
  const isCreate = isCreateOf(table);

  for (const { file, sql } of MIGRATIONS) {
    for (const { text, at } of statements(sql)) {
      const created = isCreate.exec(text);
      if (created) {
        if (/user_id\s+uuid\s+NOT\s+NULL/i.test(created[1])) {
          events.push({ file, at, notNull: true });
        }
        continue;
      }
      if (!isAlter.test(text)) continue;
      const altered = /ALTER\s+COLUMN\s+user_id\s+(DROP|SET)\s+NOT\s+NULL/i.exec(text);
      if (altered) {
        events.push({ file, at, notNull: altered[1].toUpperCase() === "SET" });
      }
    }
  }

  return events;
}

/** Ostatnia definicja funkcji o podanej nazwie (stan końcowy forward-only). */
function latestFunctionBody(name: string): { file: string; source: string } | null {
  let found: { file: string; source: string } | null = null;
  for (const { file, sql } of MIGRATIONS) {
    const re = new RegExp(
      `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$\\s*;`,
      "gi",
    );
    for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
      found = { file, source: m[0] };
    }
  }
  return found;
}

/**
 * Wspólny kontrakt obu tabel dowodowych. Parametryzacja jest tu POINTĄ, nie
 * oszczędnością: `user_purchases` umknął audytowi dokładnie dlatego, że nikt nie
 * sprawdzał go tą samą miarą co `payment_orders`.
 */
const EVIDENCE_TABLES = [
  {
    table: "payment_orders",
    label: "zamówienia (ewidencja transakcji)",
    fixMigration: "20260803090002",
    anonymizer: "anonymize_payment_orders_for_user",
    purge: "purge_expired_payment_orders",
  },
  {
    table: "user_purchases",
    label: "uprawnienia zakupowe (dowody zakupu dostępu)",
    fixMigration: "20260805090100",
    anonymizer: "anonymize_user_purchases_for_user",
    purge: "purge_expired_user_purchases",
  },
] as const;

describe.each(EVIDENCE_TABLES)(
  "RODO x art. 74 uor: $table - $label",
  ({ table, fixMigration, anonymizer, purge }) => {
    it("stan końcowy FK <tabela>.user_id to ON DELETE SET NULL", () => {
      const events = collectFkEvents(table);
      expect(
        events.length,
        `nie znaleziono ŻADNEJ definicji FK ${table}.user_id - brak klucza obcego to ` +
          "nie luźne sprzężenie, tylko brak gwarancji: usunięcie konta zostawia surowy " +
          `identyfikator osoby (patrz ${fixMigration})`,
      ).toBeGreaterThan(0);

      const last = events[events.length - 1];
      expect(
        last.kind,
        `ostatnie zdarzenie FK to DROP w ${last.file} - tabela straciła klucz obcy zamiast go zmienić`,
      ).toBe("add");
      expect(
        last.action,
        `${last.file}: FK ${table}.user_id ma ON DELETE ${last.action}. ` +
          "CASCADE kasuje dowody razem z kontem (art. 74 ust. 2 uor). " +
          `Wymagane: SET NULL + anonimizacja (patrz ${fixMigration}).`,
      ).toBe("SET NULL");
    });

    it("po migracji naprawczej żadna migracja nie przywraca CASCADE", () => {
      const events = collectFkEvents(table);
      const fixIndex = events.findIndex((e) => e.action === "SET NULL");
      expect(fixIndex, "brak migracji ustawiającej SET NULL").toBeGreaterThanOrEqual(0);

      const regressions = events.slice(fixIndex).filter((e) => e.action === "CASCADE");
      expect(regressions.map((e) => e.file)).toEqual([]);
    });

    it("user_id jest nullowalny - inaczej SET NULL nie ma jak zadziałać", () => {
      const events = collectNullabilityEvents(table);
      expect(events.length).toBeGreaterThan(0);
      const last = events[events.length - 1];
      expect(
        last.notNull,
        `${last.file}: user_id jest NOT NULL, więc ON DELETE SET NULL rzuci błąd przy kasowaniu konta`,
      ).toBe(false);
    });

    it("anonimizacja jest SECURITY DEFINER i niedostępna dla ról klienckich", () => {
      const fn = latestFunctionBody(anonymizer);
      expect(fn, `brak funkcji public.${anonymizer}`).not.toBeNull();
      expect(fn!.source).toMatch(/SECURITY\s+DEFINER/i);
      expect(fn!.source).toMatch(/SET\s+search_path\s*=\s*public/i);

      // SECURITY DEFINER + dostęp dla `authenticated` = dowolny zalogowany
      // użytkownik anonimizuje dowody dowolnego innego. Musi być odebrane.
      expect(ALL_SQL).toMatch(
        new RegExp(
          `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${anonymizer}\\(uuid\\)\\s*\\n?\\s*FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`,
          "i",
        ),
      );
      expect(ALL_SQL).toMatch(
        new RegExp(
          `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${anonymizer}\\(uuid\\)\\s+TO\\s+service_role`,
          "i",
        ),
      );
    });

    it("retencja ma termin, stempel i sprzątanie - pseudonimizacja nie jest wieczysta", () => {
      // Art. 5 ust. 1 lit. e RODO: po wygaśnięciu podstawy prawnej dane muszą
      // zniknąć, więc "SET NULL + anonimizacja" bez terminu byłoby półśrodkiem.
      expect(ALL_SQL).toMatch(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.accounting_retention_until/i,
      );
      expect(ALL_SQL).toMatch(
        new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${purge}`, "i"),
      );
      expect(ALL_SQL).toMatch(
        new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}[\\s\\S]{0,400}?retention_until`, "i"),
      );
      expect(ALL_SQL).toMatch(
        new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}[\\s\\S]{0,400}?retention_hold`, "i"),
      );
    });

    it("kształt zanonimizowanego wiersza jest wymuszony przez CHECK", () => {
      // Pseudonim bez identyfikatora, nigdy jedno bez drugiego - inaczej
      // "anonimizacja" mogłaby zostawić oba albo żadnego.
      expect(ALL_SQL).toMatch(
        new RegExp(`CONSTRAINT\\s+${table}_anonymized_shape_chk\\s+CHECK`, "i"),
      );
    });
  },
);

describe("wspólny punkt wejścia retencji", () => {
  it("obie tabele są anonimizowane w JEDNEJ transakcji", () => {
    // Dwa osobne RPC to okno, w którym zamówienia są już pseudonimizowane,
    // a zakupy wciąż noszą surowy identyfikator - awaria w tym oknie zostawia
    // naruszenie w danych.
    const fn = latestFunctionBody("anonymize_accounting_evidence_for_user");
    expect(fn, "brak funkcji public.anonymize_accounting_evidence_for_user").not.toBeNull();
    expect(fn!.source).toMatch(/anonymize_payment_orders_for_user/);
    expect(fn!.source).toMatch(/anonymize_user_purchases_for_user/);
  });

  it("trigger BEFORE DELETE na auth.users domyka ścieżki poza aplikacją", () => {
    // Kasowanie konta z dashboardu / CLI nie przechodzi przez deleteMyAccount,
    // a i tak nie może zostawić na dowodzie danych osoby, która właśnie
    // skorzystała z prawa do usunięcia danych.
    const creations: string[] = [];
    const drops: string[] = [];
    for (const { file, sql } of MIGRATIONS) {
      if (
        /CREATE\s+TRIGGER\s+on_auth_user_deleted_retain_accounting\s+BEFORE\s+DELETE\s+ON\s+auth\.users/i.test(
          sql,
        )
      ) {
        creations.push(file);
      }
      // `DROP TRIGGER IF EXISTS` bezpośrednio przed CREATE to idempotencja,
      // nie usunięcie - liczy się tylko drop w migracji BEZ ponownego CREATE.
      if (
        /DROP\s+TRIGGER\s+IF\s+EXISTS\s+on_auth_user_deleted_retain_accounting/i.test(sql) &&
        !/CREATE\s+TRIGGER\s+on_auth_user_deleted_retain_accounting/i.test(sql)
      ) {
        drops.push(file);
      }
    }
    expect(creations.length).toBeGreaterThan(0);
    const lastCreation = creations[creations.length - 1];
    expect(drops.filter((f) => f > lastCreation)).toEqual([]);
  });

  it("trigger woła wspólny punkt wejścia, nie tylko zamówienia", () => {
    const fn = latestFunctionBody("tg_auth_user_deleted_retain_accounting");
    expect(fn).not.toBeNull();
    expect(
      fn!.source,
      "trigger anonimizuje tylko zamówienia - user_purchases zostałoby z surowym user_id",
    ).toMatch(/anonymize_accounting_evidence_for_user/);
  });

  it("pseudonim jest wspólny dla obu tabel (uzgodnienie ksiąg bez danych osobowych)", () => {
    for (const { anonymizer } of EVIDENCE_TABLES) {
      expect(latestFunctionBody(anonymizer)!.source).toMatch(/accounting_subject_ref/);
    }
  });
});

describe("deleteMyAccount: kolejność kroków", () => {
  const source = readFileSync("src/lib/account.functions.ts", "utf8");

  it("anonimizuje dowody PRZED skasowaniem użytkownika", () => {
    const retention = source.indexOf("retainAccountingEvidence");
    const deletion = source.indexOf("auth.admin.deleteUser");
    expect(retention, "deleteMyAccount nie woła retainAccountingEvidence").toBeGreaterThan(-1);
    expect(deletion).toBeGreaterThan(-1);
    expect(
      retention,
      "retencja dowodów musi wyprzedzać deleteUser - po skasowaniu konta nie ma czego anonimizować",
    ).toBeLessThan(deletion);
  });

  it("anulowanie subskrypcji wyprzedza retencję, a retencja - usunięcie", () => {
    const closure = source.indexOf("closeBillingForUser");
    const retention = source.indexOf("retainAccountingEvidence");
    expect(closure).toBeGreaterThan(-1);
    expect(closure).toBeLessThan(retention);
  });
});
