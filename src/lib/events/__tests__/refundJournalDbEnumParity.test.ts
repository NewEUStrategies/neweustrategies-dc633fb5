// BRAMKA (REG-03, REG-06): stałe dziennika zwrotów i sufity tekstów decyzji
// zgadzają się z bazą.
//
// PO CO. Kolumny `origin`, `review_reason` i `state` zleceń zwrotu są typu
// `text` z CHECK-iem, a sufity `participant_reason` (1000) i `decision_note`
// (2000) żyją w CHECK-ach i odmowach `admin_event_registration_decide`.
// Typ generowany z bazy to `string`/`number` - kompilator nie zobaczy, że
// parser dziennika odrzuca wartość, którą baza zapisuje (dziennik pokazałby
// „błąd wczytania" zamiast zleceń), albo że licznik w oknie decyzji obiecuje
// inny limit niż ten, którym baza odmawia (AGENTS.md: wspólne sufity pól,
// odmowa zamiast przycięcia).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REFUND_REVIEW_REASONS } from "@/lib/events/cancellationPreview";
import {
  REFUND_JOB_ORIGINS,
  REFUND_JOB_REVIEW_REASONS,
  REFUND_JOB_STATES,
} from "@/lib/events/registrationRefundJournal";
import {
  DECISION_NOTE_MAX_LENGTH,
  DECISION_NOTE_MIN_LENGTH,
  PARTICIPANT_REASON_MAX_LENGTH,
} from "@/lib/events/registrationRows";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Wszystkie migracje po kolei - ostatnia definicja wygrywa. */
function migrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
}

/** Literały z OSTATNIEJ definicji nazwanego CHECK-u (także z `kol IS NULL OR kol IN`). */
function constraintValues(name: string): string[] {
  let found: string[] | null = null;
  const re = new RegExp(`CONSTRAINT\\s+${name}\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*\\)`, "gi");
  for (const sql of migrations()) {
    for (const m of sql.matchAll(re)) {
      found = [...m[1].matchAll(/'([a-z_]+)'/g)].map((v) => v[1]);
    }
  }
  if (found === null) throw new Error(`brak ograniczenia ${name} w supabase/migrations`);
  return found;
}

/** Ostatnie ciało `admin_event_registration_decide` z łańcucha migracji. */
function latestDecideBody(): string {
  let body = "";
  for (const sql of migrations()) {
    const start = sql.indexOf("FUNCTION public.admin_event_registration_decide(p_payload jsonb)");
    if (start !== -1) body = sql.slice(start, sql.indexOf("$$;", start));
  }
  return body;
}

describe("dziennik zwrotów - parytet z CHECK", () => {
  it("pochodzenie zlecenia: dokładnie wartości `event_refund_jobs_origin_values`", () => {
    expect([...REFUND_JOB_ORIGINS].sort()).toEqual(
      constraintValues("event_refund_jobs_origin_values").sort(),
    );
  });

  it("powód przeglądu w dzienniku: dokładnie wartości `event_refund_jobs_review_reason_values`", () => {
    // Scalenie z main (20261012120000): jeden CHECK zna powody zamknięcia
    // (REG-03) i powody eskalacji kolejki - dziennik czyta oba.
    expect([...REFUND_JOB_REVIEW_REASONS].sort()).toEqual(
      constraintValues("event_refund_jobs_review_reason_values").sort(),
    );
  });

  it("powód z podglądu rezygnacji jest wartością, którą baza zapisze w zleceniu", () => {
    const allowed = constraintValues("event_refund_jobs_review_reason_values");
    for (const reason of REFUND_REVIEW_REASONS) expect(allowed).toContain(reason);
  });

  it("stan zlecenia: dokładnie wartości CHECK kolumny `state`", () => {
    const sql = migrations().join("\n");
    const m = sql.match(
      /CREATE TABLE IF NOT EXISTS public\.event_registration_refund_jobs[\s\S]*?state text[^\n]*CHECK \(state IN \(([^)]*)\)\)/,
    );
    expect(m, "brak CHECK kolumny state").not.toBeNull();
    const values = [...(m?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((v) => v[1]).sort();
    expect([...REFUND_JOB_STATES].sort()).toEqual(values);
  });
});

describe("sufity tekstów decyzji - te same liczby co baza (REG-06)", () => {
  it("powód dla uczestnika: CHECK i odmowa `participant_reason_too_long`", () => {
    const sql = migrations().join("\n");
    expect(sql).toContain(`char_length(participant_reason) <= ${PARTICIPANT_REASON_MAX_LENGTH}`);
    expect(latestDecideBody()).toContain(
      `char_length(v_reason) > ${PARTICIPANT_REASON_MAX_LENGTH}`,
    );
  });

  it("notatka wewnętrzna: CHECK `note_len` i odmowa `note_too_long`", () => {
    const sql = migrations().join("\n");
    expect(sql).toContain(`char_length(decision_note) <= ${DECISION_NOTE_MAX_LENGTH}`);
    expect(latestDecideBody()).toContain(`char_length(v_note) > ${DECISION_NOTE_MAX_LENGTH}`);
  });

  it("minimum uzasadnienia: to samo, czego wymaga `reason_required`", () => {
    expect(latestDecideBody()).toContain(`char_length(v_note) < ${DECISION_NOTE_MIN_LENGTH}`);
  });

  it("bez backfillu: żadna migracja nie przepisuje notatki wewnętrznej w powód dla uczestnika", () => {
    for (const sql of migrations()) {
      expect(sql).not.toMatch(/participant_reason\s*=\s*[^;,]*decision_note/);
    }
  });
});
