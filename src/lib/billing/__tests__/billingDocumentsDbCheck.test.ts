// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// BRAMKA (audyt INV-04): zbiory dokumentu rozliczeniowego w TS = CHECK-i
// migracji `billing_documents`. Kolumny `status` i `billing_plane` są `text` +
// `CHECK (... IN (...))`, więc typ generowany to `string` - kompilator nie
// zobaczy, że zapis wysyła stan, którego baza nie przyjmie. Dokładnie tak
// znikały zakupy jednorazowe: sesja Checkout nie niosła stanu, zapis wysyłał
// domyślne `pending`, CHECK odrzucał wiersz (23514), a kod logował to jako
// „wyścig". Atrapa bazy w testach modułu przyjmuje każdą wartość, więc tylko
// ten plik zestawia TS z tym, co naprawdę wykona Postgres.
//
// Migracja jest jedynym źródłem prawdy o CHECK-ach - czytamy WSZYSTKIE pliki
// `supabase/migrations`, bo tabela powstaje w dwóch migracjach
// (`CREATE TABLE IF NOT EXISTS`), a CHECK może kiedyś zmienić `ALTER TABLE`.
import { describe, expect, expectTypeOf, it } from "vitest";

import { nodeMigrationFs } from "@/lib/ci/migrationSize";
import { SUPABASE_MIGRATIONS_DIR } from "@/lib/ci/migrationSplitPlan";
import { BILLING_DOCUMENT_PLANES } from "@/lib/billing/billingDocumentSnapshot.server";
import {
  BILLING_DOCUMENT_STATUSES,
  billingDocumentStatus,
  isBillingDocumentStatus,
} from "@/lib/billing/billingDocumentStatus";
import type { CheckoutBillingPlane } from "@/lib/billing/checkoutSettings";
import type { BillingDocumentStatus } from "@/lib/billing/types";

interface DdlStatement {
  readonly file: string;
  readonly sql: string;
}

/** Komentarze `--` precz: średnik albo „CHECK" w prozie nie może udawać DDL-a. */
const withoutComments = (sql: string): string => sql.replace(/--[^\n]*/g, "");

/** Instrukcje `CREATE TABLE` / `ALTER TABLE` na `public.billing_documents` ze wszystkich migracji. */
function billingDocumentsDdl(): DdlStatement[] {
  const out: DdlStatement[] = [];
  const files = nodeMigrationFs
    .list(SUPABASE_MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = withoutComments(nodeMigrationFs.read(`${SUPABASE_MIGRATIONS_DIR}/${file}`) ?? "");
    const head =
      /(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE(?: IF EXISTS)?(?: ONLY)?)\s+public\.billing_documents\b/gi;
    for (const match of sql.matchAll(head)) {
      const end = sql.indexOf(";", match.index);
      out.push({ file, sql: sql.slice(match.index, end === -1 ? undefined : end) });
    }
  }
  return out;
}

/** Wartości z każdego `CHECK (<kolumna> IN ('a', 'b'))` w instrukcjach DDL. */
function checkSets(statements: readonly DdlStatement[], column: string): string[][] {
  const pattern = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)\\s*\\)`, "gi");
  return statements.flatMap((statement) =>
    [...statement.sql.matchAll(pattern)].map((match) =>
      [...match[1].matchAll(/'([^']*)'/g)].map((value) => value[1]),
    ),
  );
}

const DDL = billingDocumentsDdl();

describe("parytet zbiorów billing_documents z CHECK-ami migracji", () => {
  it("skan widzi obie migracje zakładające tabelę i migrację migawki", () => {
    // Kanarek zasięgu: pusty skan dałby „zgodność" bez sprawdzenia czegokolwiek.
    const files = new Set(DDL.map((statement) => statement.file));
    expect(files).toContain("20260723060905_fbebf12d-317c-44af-8038-08cab05a076b.sql");
    expect(files).toContain("20260723151000_billing_documents_plan_change.sql");
    expect(files).toContain("20261012110000_billing_documents_snapshot.sql");
  });

  it("KAŻDY CHECK statusu w historii migracji to dokładnie BILLING_DOCUMENT_STATUSES", () => {
    const sets = checkSets(DDL, "status");

    expect(sets.length).toBeGreaterThanOrEqual(2);
    for (const set of sets) expect(set).toEqual([...BILLING_DOCUMENT_STATUSES]);
  });

  it("CHECK płaszczyzny rozliczeń to dokładnie BILLING_DOCUMENT_PLANES", () => {
    const sets = checkSets(DDL, "billing_plane");

    expect(sets).toHaveLength(1);
    expect(sets[0]).toEqual([...BILLING_DOCUMENT_PLANES]);
  });

  it("żaden CHECK na tych kolumnach nie ma postaci, której skan nie umie przeczytać", () => {
    // `CHECK (status = ANY (ARRAY[...]))` przeszedłby obok wzorca i bramka
    // milczałaby przy realnej zmianie zbioru. Każda wzmianka kolumny w CHECK-u
    // musi więc dać się odczytać jako `IN (...)`.
    for (const column of ["status", "billing_plane"]) {
      const mentions = DDL.flatMap((statement) => [
        ...statement.sql.matchAll(new RegExp(`CHECK\\s*\\(\\s*${column}\\b`, "gi")),
      ]);
      expect(mentions.length, column).toBe(checkSets(DDL, column).length);
    }
  });

  it("zbiory TS są tym samym co typy domenowe (kompilator pilnuje obu kierunków)", () => {
    expectTypeOf<
      (typeof BILLING_DOCUMENT_STATUSES)[number]
    >().toEqualTypeOf<BillingDocumentStatus>();
    expectTypeOf<(typeof BILLING_DOCUMENT_PLANES)[number]>().toEqualTypeOf<CheckoutBillingPlane>();
  });
});

describe("billingDocumentStatus - stan operatora -> stan z CHECK-a", () => {
  const cases: ReadonlyArray<readonly [provider: string, expected: BillingDocumentStatus]> = [
    // Faktura Stripe (`invoice.status`).
    ["paid", "paid"],
    ["open", "open"],
    ["draft", "open"],
    ["uncollectible", "open"],
    ["void", "void"],
    // Sesja Checkout (`payment_status`).
    ["no_payment_required", "paid"],
    ["unpaid", "open"],
    // Zwrot i słownik domenowy dyspozytora.
    ["refunded", "refunded"],
    ["completed", "paid"],
    ["past_due", "open"],
  ];

  it.each(cases)("%s -> %s", (provider, expected) => {
    expect(billingDocumentStatus(provider)).toBe(expected);
  });

  it("każdy wynik mapowania należy do zbioru z CHECK-a", () => {
    for (const [provider] of cases) {
      expect(isBillingDocumentStatus(billingDocumentStatus(provider))).toBe(true);
    }
  });

  it("wielkość liter i białe znaki nie zmieniają wyniku", () => {
    expect(billingDocumentStatus("  PAID ")).toBe("paid");
  });

  it("brak stanu i stan nieznany to `null` - nigdy dosłowna wartość operatora", () => {
    // Dawny zapis przepisywał `pending`/`past_due` dosłownie i rozbijał się na
    // CHECK-u. `null` zostawia decyzję wołającemu (nowy dokument: `open`).
    expect(billingDocumentStatus(null)).toBeNull();
    expect(billingDocumentStatus("pending")).toBeNull();
    expect(billingDocumentStatus("constructor")).toBeNull();
  });

  it("zawężenie wartości z bazy odrzuca wszystko spoza zbioru", () => {
    expect(BILLING_DOCUMENT_STATUSES.every(isBillingDocumentStatus)).toBe(true);
    expect(isBillingDocumentStatus("pending")).toBe(false);
    expect(isBillingDocumentStatus(null)).toBe(false);
  });
});
