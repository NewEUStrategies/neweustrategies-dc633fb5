// Bramka: eksport danych osobowych nie może wypuścić wiersza cudzej osoby.
//
// CO TO ZA RYZYKO. `export.functions.ts` składa paczkę RODO z 33 zapytań. Wszystkie
// są dziś poprawnie zawężone - sprawdzone po jednym: 27 filtrem jawnym na kolumnie
// właściciela, dwa przez RLS. Problem nie jest w stanie obecnym, a w KSZTAŁCIE:
// dopisanie 34. sekcji to jedna linia, a brak w niej `.eq("<kolumna>", userId)`
// nie daje ani błędu typów, ani czerwonego testu - daje paczkę z wierszami
// wszystkich użytkowników. Konsekwencja jest prawna, nie funkcjonalna.
//
// DLACZEGO ASERCJA JEST STATYCZNA, A NIE INTEGRACYJNA. Test integracyjny musiałby
// mieć dwóch użytkowników z danymi w 33 tabelach i realną bazę. Ta bramka czyta
// KOD i wymaga, żeby każde zapytanie samo mówiło, po czyich danych chodzi -
// czyli przenosi dowód z czasu wykonania do czasu review.
//
// DWA WYJĄTKI SĄ JAWNE. `conversations` i `notifications` nie mają filtru w kodzie,
// bo zawęża je RLS (`notifications_select_own`: `auth.uid() = user_id AND tenant_id
// = current_tenant_id()`). Poleganie na RLS jest legalne, ale musi być DECYZJĄ:
// stąd lista `RLS_SCOPED` niżej i pgTAP `profile_export_rls_scope_test.sql`, który
// dowodzi, że te polityki naprawdę zawężają do właściciela. Bez tego drugiego
// lista byłaby obietnicą bez pokrycia.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = "src/lib/profile/export.functions.ts";

/**
 * Kolumny, które w tym repo oznaczają „właściciela wiersza". Każda z nich musi
 * być porównana z `userId` z kontekstu uwierzytelnienia - nie z parametrem
 * wejściowym, nie ze zmienną z zapytania.
 */
const OWNER_COLUMNS = [
  "user_id",
  "author_id",
  "endorser_id",
  "recipient_id",
  "reporter_id",
  "set_by",
  "blocker_id",
  "invited_by",
  "owner_id",
  "actor_id",
  "sender_id",
  "profile_id",
  "subject_user_id",
] as const;

/**
 * Tabele świadomie zawężone RLS-em, nie filtrem w kodzie. Dopisanie tu tabeli jest
 * decyzją do review - i wymaga asercji w `supabase/tests/profile_export_rls_scope_test.sql`,
 * bo inaczej lista mówi „jest RLS" bez żadnego dowodu.
 */
const RLS_SCOPED = new Set(["conversations", "notifications"]);

const src = readFileSync(SOURCE, "utf8");

interface Query {
  readonly table: string;
  readonly line: number;
  readonly body: string;
}

/** Każde `.from("tabela")` wraz z tekstem do następnego zapytania. */
function queries(): Query[] {
  const calls = [...src.matchAll(/\.from\("([a-z0-9_]+)"\)/g)];
  return calls.map((m, i) => {
    const end = i + 1 < calls.length ? calls[i + 1].index : src.length;
    return {
      table: m[1],
      line: src.slice(0, m.index).split("\n").length,
      body: src.slice(m.index + m[0].length, end),
    };
  });
}

const OWNER_FILTER = new RegExp(
  `\\.eq\\("(${OWNER_COLUMNS.join("|")})",\\s*(userId|context\\.userId)\\)`,
);

describe("eksport RODO - zakres właściciela", () => {
  const all = queries();

  it("skan realnie widzi zapytania - kanarek zasięgu", () => {
    // Bez tego bramka po refaktorze na inny klient bazy robi się pusta i zielona.
    expect(all.length).toBeGreaterThanOrEqual(30);
  });

  it("każde zapytanie jest zawężone do właściciela - filtrem albo jawnym RLS", () => {
    const offenders = all
      .filter((q) => !OWNER_FILTER.test(q.body) && !RLS_SCOPED.has(q.table))
      .map((q) => `${SOURCE}:${q.line} from("${q.table}") - brak filtru właściciela`);
    expect(offenders).toEqual([]);
  });

  it("lista RLS_SCOPED nie zawiera tabel, które MAJĄ filtr w kodzie", () => {
    // Wyjątek, który przestał być potrzebny, osłabia bramkę na przyszłość:
    // kolejna sekcja na tej samej tabeli przejdzie bez filtru.
    const redundant = [...RLS_SCOPED].filter((table) =>
      all.some((q) => q.table === table && OWNER_FILTER.test(q.body)),
    );
    expect(redundant).toEqual([]);
  });

  it("każda tabela z RLS_SCOPED jest wołana w eksporcie", () => {
    // Martwy wyjątek to przyszła furtka: nazwa zostaje, a wraz z nią zgoda
    // na brak filtru dla tabeli, której już nikt nie pamięta.
    const tables = new Set(all.map((q) => q.table));
    const stale = [...RLS_SCOPED].filter((table) => !tables.has(table));
    expect(stale).toEqual([]);
  });

  it("eksport bierze `userId` z kontekstu uwierzytelnienia, nie z wejścia", () => {
    // Gdyby `userId` przyszło parametrem, cały filtr wyżej byłby dekoracją:
    // wołający podałby cudze id i dostał cudze dane.
    expect(src).toMatch(/const \{[^}]*\buserId\b[^}]*\} = context;/);
    // `data:` to wejście od klienta w konwencji server functions TanStacka.
    const fromInput = /userId\s*[:=]\s*(data|input)\b/.test(src);
    expect({ userIdZWejscia: fromInput }).toEqual({ userIdZWejscia: false });
  });
});
