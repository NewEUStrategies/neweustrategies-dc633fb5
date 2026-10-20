// PARYTET: lista poczty związanej z kontem albo zapisem (I9c-X1) w TS
// (`ACCOUNT_BOUND_EMAIL_LABELS` - dren kolejki) i w SQL
// (`_hub_account_bound_email_labels()` - anulowanie przy usunięciu konta
// i `email_queue_send_recheck`), migracja 20261020160900.
//
// Rozjazd w jedną stronę zostawia w kolejce maile, których podstawa wygasła
// z kontem; w drugą - dren pyta bazę o etykietę, której baza nie zna, i dostaje
// „ok" bez sprawdzenia zapisu. Fragmenty SQL budowane są ze stałych TS i muszą
// wystąpić w migracji DOSŁOWNIE (po wycięciu komentarzy i sprowadzeniu
// białych znaków do zapisu kanonicznego).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stripSqlComments } from "@/lib/ci/ownership";
import {
  ACCOUNT_BOUND_EMAIL_LABELS,
  ACCOUNT_DELETED_CANCEL_REASON,
  emailCategoryForLabel,
  isAccountBoundEmailLabel,
  REDACTED_RECIPIENT,
  TX_EMAIL_CATEGORY,
} from "../suppressionPolicy";

const MIGRACJA = "supabase/migrations/20261020160900_account_erasure_staff_mail_queue.sql";

const kanon = (sql: string) =>
  sql
    .replace(/\s+/g, " ")
    .replace(/\s*([(),\][])\s*/g, "$1")
    .trim();

function migracja(): string {
  expect(existsSync(MIGRACJA), `brak migracji: ${MIGRACJA}`).toBe(true);
  return kanon(stripSqlComments(readFileSync(MIGRACJA, "utf8")));
}

const lista = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(",");

describe("poczta związana z kontem - parytet TS ⇄ SQL", () => {
  it("_hub_account_bound_email_labels() zwraca dokładnie listę TS", () => {
    expect(migracja()).toContain(
      kanon(`SELECT ARRAY[${lista(ACCOUNT_BOUND_EMAIL_LABELS)}]::text[]`),
    );
  });

  it("powód anulowania i odbiorca bez adresu są tymi samymi napisami", () => {
    expect(migracja()).toContain(`c_reason constant text := '${ACCOUNT_DELETED_CANCEL_REASON}'`);
    expect(migracja()).toContain(`c_redacted constant text := '${REDACTED_RECIPIENT}'`);
  });

  it("gałąź ścieżek w SQL wymienia wszystkie etykiety ścieżek z listy", () => {
    const sciezki = ACCOUNT_BOUND_EMAIL_LABELS.filter((l) => l.startsWith("journey"));
    expect(migracja()).toContain(kanon(`IF v_label IN (${lista(sciezki)}) THEN`));
  });
});

describe("poczta związana z kontem - zakres", () => {
  it("rozpoznaje etykiety bez względu na wielkość liter i białe znaki", () => {
    expect(isAccountBoundEmailLabel(" Journey ")).toBe(true);
    expect(isAccountBoundEmailLabel("digest_weekly")).toBe(true);
    expect(isAccountBoundEmailLabel(null)).toBe(false);
  });

  it("żaden typ maila transakcyjnego nie jest na liście (potwierdzenia, rozliczenia, bilety zostają)", () => {
    for (const type of Object.keys(TX_EMAIL_CATEGORY)) {
      expect(isAccountBoundEmailLabel(type), type).toBe(false);
    }
  });

  it("każda etykieta z listy ma jawną kategorię w polityce (żadna nie spada na domyślne `bulk`)", () => {
    expect(ACCOUNT_BOUND_EMAIL_LABELS.map((l) => [l, emailCategoryForLabel(l)])).toEqual([
      ["journey", "bulk"],
      ["journey_service", "transactional"],
      ["journey_test", "transactional"],
      ["digest_daily", "bulk"],
      ["digest_weekly", "bulk"],
    ]);
  });
});
