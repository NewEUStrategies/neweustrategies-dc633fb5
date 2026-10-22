// Zdarzenie `contact_message.submitted.v1` (I9, Z-S5-01) - parytet katalogu
// wyzwalaczy ścieżek z emiterem SQL (NAJNOWSZA definicja
// `tg_contact_messages_submitted_emit`) i szablon B2B.
//
// PO CO. Warunek wyzwalacza to `payload @> condition`: rodzaj formularza
// spoza białej listy emitera albo klucz, którego emiter nie wpisuje, daje
// ścieżkę, która nigdy nikogo nie zapisze - bez żadnego błędu.
import { describe, expect, it } from "vitest";
import { extractLatestDefinitions } from "../../../../scripts/lib/sqlMigrations";
import { CONTACT_MESSAGE_FORM_KINDS, buildTriggerCondition, journeyTrigger } from "../triggers";
import { JOURNEY_TEMPLATES, isTemplateAvailable } from "../templates";

const body = (): string => {
  const def = extractLatestDefinitions().get("public.tg_contact_messages_submitted_emit/0");
  expect(def, "brak definicji emitera").toBeDefined();
  return def!.body;
};

describe("contact_message.submitted.v1 - katalog ⇄ emiter SQL", () => {
  it("biała lista form_kind = wartości wpisywane przez emiter (CASE … THEN '<rodzaj>')", () => {
    const sql = body();
    const kinds = [...sql.matchAll(/(?:THEN|ELSE)\s+'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(kinds)].sort()).toEqual([...CONTACT_MESSAGE_FORM_KINDS].sort());
  });

  it("klucze ładunku katalogu = klucze jsonb_build_object emitera (bez danych osobowych)", () => {
    const sql = body();
    const build = /jsonb_build_object\(([\s\S]*?)\),\s*NULL\)/.exec(sql)?.[1] ?? "";
    const keys = [...build.matchAll(/'([a-z_]+)'\s*,/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...(journeyTrigger("contact_message.submitted.v1")?.payloadKeys ?? [])].sort());
    expect(keys).not.toContain("email");
    expect(keys).not.toContain("name");
  });

  it("kandydaci do pracy nie wychodzą na szynę", () => {
    expect(body()).toMatch(/form_id,\s*''\)\s*=\s*'careers'\s*THEN\s*RETURN NEW/);
  });
});

describe("szablon B2B (pricing_enquiry_b2b)", () => {
  const template = JOURNEY_TEMPLATES.pricing_enquiry_b2b;

  it("dostępny, startuje od wiadomości z cennika - warunek przechodzi przez katalog", () => {
    expect(isTemplateAvailable(template)).toBe(true);
    expect(template.settings.triggerEventType).toBe("contact_message.submitted.v1");
    expect(
      buildTriggerCondition(template.settings.triggerEventType, template.settings.triggerCondition),
    ).toEqual({ form_kind: "pricing" });
  });

  it("rodzaj spoza białej listy to błąd warunku, nie cicha ścieżka", () => {
    expect(() =>
      buildTriggerCondition("contact_message.submitted.v1", { form_kind: "careers" }),
    ).toThrow(/form_kind/);
  });
});
