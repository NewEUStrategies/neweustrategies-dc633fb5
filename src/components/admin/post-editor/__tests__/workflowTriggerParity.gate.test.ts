// BRAMKA PARYTETU: selektor statusu w edytorze MUSI mówić to samo, co trigger
// `enforce_post_workflow` w bazie.
//
// Reguła workflow redakcyjnego jest egzekwowana POTRÓJNIE - w UI
// (`evaluateTransition` / `statusOptionsFor`), w server fn (`updatePost`)
// i w triggerze DB. Trzy niezależne kopie tej samej decyzji to trzy okazje do
// rozjazdu, a rozjazd jest tu asymetrycznie kosztowny:
//
//   * UI luźniejsze niż baza -> redaktor klika „Publikuj", czeka, i dostaje
//     surowy błąd 42501 z PostgreSQL-a. Zapis nie przechodzi, ale nie wiadomo
//     dlaczego - komunikat jest o roli, nie o tym, że przycisk nie powinien
//     był być klikalny.
//   * UI ostrzejsze niż baza -> opcja znika z selektora, choć uprawnienie
//     istnieje. Nikt tego nie zgłosi jako błędu, bo wygląda jak decyzja
//     produktowa; funkcja po prostu cicho przestaje istnieć.
//
// Bramka czyta OSTATNIĄ definicję funkcji triggera z katalogu migracji
// (`CREATE OR REPLACE` - wygrywa najpóźniejsza) i porównuje ją z tablicą
// decyzyjną modułu domenowego. Nie odtwarza semantyki PL/pgSQL - wyciąga
// z niej trzy fakty, które MUSZĄ się zgadzać, i wprost zgłasza, gdy
// któregoś nie umie odczytać (cisza byłaby gorsza niż czerwień).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POST_STATUSES, evaluateTransition } from "@/lib/content/workflow";

const MIGRATIONS_DIR = "supabase/migrations";

/** Ciało ostatniej definicji `enforce_post_workflow()` w katalogu migracji. */
function latestTriggerBody(): { file: string; body: string } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let found: { file: string; body: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const at = sql.indexOf("CREATE OR REPLACE FUNCTION public.enforce_post_workflow()");
    if (at < 0) continue;
    const end = sql.indexOf("$$;", at);
    found = { file, body: sql.slice(at, end < 0 ? sql.length : end) };
  }
  if (!found)
    throw new Error("Nie znaleziono definicji public.enforce_post_workflow() w migracjach");
  return found;
}

/** Tabele, do których podpięto trigger wołający tę funkcję. */
function guardedTables(): Set<string> {
  const tables = new Set<string>();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const pattern =
      /CREATE TRIGGER\s+\w+\s+BEFORE[^;]*?ON\s+public\.(\w+)[^;]*?EXECUTE FUNCTION public\.enforce_post_workflow\(\)/gs;
    for (const match of sql.matchAll(pattern)) tables.add(match[1]);
  }
  return tables;
}

const trigger = latestTriggerBody();

describe("parytet UI <-> trigger enforce_post_workflow", () => {
  it("statusy bramkowane w bazie to DOKŁADNIE te, których UI nie daje bez uprawnienia", () => {
    // Z SQL-a: lista w `NEW.status IN (...)` przy warunku z can_publish_content.
    const inList = trigger.body.match(
      /NEW\.status IN \(([^)]*)\)[\s\S]*?NOT public\.can_publish_content/,
    );
    expect(inList, `nie odczytano listy statusów bramkowanych w ${trigger.file}`).not.toBeNull();
    const fromSql = [...inList![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

    // Z TS-a: statusy, do których wejście z `draft` odmawia autorowi.
    const fromTs = POST_STATUSES.filter(
      (to) =>
        to !== "draft" &&
        evaluateTransition({ canPublish: false }, "draft", to, "2026-09-01T10:00:00.000Z").ok ===
          false,
    ).sort();

    expect(fromTs, `rozjazd UI <-> ${trigger.file}`).toEqual(fromSql);
  });

  it("baza bramkuje WEJŚCIE w status, nie samo jego posiadanie - tak jak UI", () => {
    // `OLD.status IS DISTINCT FROM NEW.status` jest warunkiem, bez którego
    // autor nie mógłby zapisać poprawki literówki we WŁASNYM opublikowanym
    // wpisie - każdy zapis wyglądałby dla triggera jak próba publikacji.
    expect(
      /OLD\.status IS DISTINCT FROM NEW\.status/.test(trigger.body),
      `trigger w ${trigger.file} bramkuje każdy zapis, nie samo przejście`,
    ).toBe(true);

    // Ta sama reguła po stronie UI: ponowny zapis bez zmiany statusu przechodzi.
    expect(evaluateTransition({ canPublish: false }, "published", "published")).toEqual({
      ok: true,
    });
    expect(
      evaluateTransition({ canPublish: false }, "scheduled", "scheduled", "2026-09-01T00:00:00Z"),
    ).toEqual({
      ok: true,
    });
  });

  it("wymóg publish_at dla `scheduled` obowiązuje w OBU warstwach", () => {
    expect(
      /NEW\.status = 'scheduled'[\s\S]{0,80}NEW\.publish_at IS NULL/.test(trigger.body),
      `trigger w ${trigger.file} nie wymaga publish_at dla scheduled`,
    ).toBe(true);

    expect(evaluateTransition({ canPublish: true }, "draft", "scheduled", null)).toEqual({
      ok: false,
      reason: "requires_publish_at",
    });
  });

  it("zapisy bez tożsamości (service_role, cron) świadomie omijają bramkę", () => {
    // To NIE jest luka: `publish_due_posts()` i zadania serwerowe działają bez
    // `auth.uid()`, a publikacja z harmonogramu musi się udać także wtedy, gdy
    // autor wpisu nie ma prawa publikować. Warunek jest tu przypięty, żeby jego
    // usunięcie było widoczną decyzją, a nie skutkiem ubocznym refaktoru.
    expect(/IF auth\.uid\(\) IS NULL THEN\s*RETURN NEW;/.test(trigger.body)).toBe(true);
  });

  it("bramka pilnuje obu bytów redakcyjnych: wpisów i stron", () => {
    // `pages_workflow_guard` REUŻYWA tej samej funkcji. Gdyby któryś byt
    // wypadł, jego status dałoby się przestawić z pominięciem reguły -
    // a UI nadal pokazywałoby ten sam selektor.
    const tables = guardedTables();
    expect([...tables].sort()).toEqual(["pages", "posts"]);
  });

  it("odmowa publikacji ma kod uprawnień, a brak terminu - kod naruszenia więzu", () => {
    // Kody rozróżniają dwie różne przyczyny odmowy. Klient mapuje je na różne
    // komunikaty; zrównanie ich zamieniłoby „nie masz uprawnień" i „uzupełnij
    // termin" w jeden nieczytelny błąd.
    expect(trigger.body).toMatch(/requires an admin role'\s*\n?\s*USING ERRCODE = '42501'/);
    expect(trigger.body).toMatch(/requires publish_at'\s*\n?\s*USING ERRCODE = '23514'/);
  });
});
