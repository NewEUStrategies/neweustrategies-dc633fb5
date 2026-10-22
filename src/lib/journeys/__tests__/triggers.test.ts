// Katalog wyzwalaczy ścieżek (S5). Warunek wyzwalacza to `payload @>
// condition` - literówka w kluczu nie daje błędu, tylko ścieżkę, która nigdy
// nikogo nie zapisze. Dlatego: każdy wyzwalacz jest typem z
// `DOMAIN_EVENT_TYPES`, każdy klucz ładunku występuje w migracji emitera tego
// zdarzenia (S1-S4), a pola warunku są kluczami ładunku.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOMAIN_EVENT_TYPES } from "@/lib/realtime/domainEvents";
import { PAYMENT_FAILED_EVENT } from "../graph";
import {
  JOURNEY_TRIGGERS,
  TriggerConditionError,
  buildTriggerCondition,
  isJourneyTrigger,
  journeyTrigger,
} from "../triggers";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"));

describe("katalog", () => {
  it("każdy wyzwalacz jest typem zdarzenia szyny, bez duplikatów", () => {
    const known: readonly string[] = DOMAIN_EVENT_TYPES;
    const types = JOURNEY_TRIGGERS.map((t) => t.eventType);
    for (const type of types) expect(known, type).toContain(type);
    expect(new Set(types).size).toBe(types.length);
  });

  it("klucze ładunku występują w migracji emitera (kontrakt S1-S4)", () => {
    for (const trigger of JOURNEY_TRIGGERS) {
      const emitters = SQL.filter((sql) => sql.includes(`'${trigger.eventType}'`));
      expect(emitters.length, `brak emitera SQL ${trigger.eventType}`).toBeGreaterThan(0);
      const source = emitters.join("\n");
      for (const key of trigger.payloadKeys) {
        expect(source.includes(`'${key}'`), `${trigger.eventType}: klucz ${key}`).toBe(true);
      }
    }
  });

  it("pola warunku to klucze ładunku; enum ma opcje", () => {
    for (const trigger of JOURNEY_TRIGGERS) {
      for (const field of trigger.conditionFields) {
        expect(trigger.payloadKeys, `${trigger.eventType}.${field.key}`).toContain(field.key);
        if (field.type === "enum") expect(field.options?.length).toBeGreaterThan(0);
      }
    }
  });

  it("mail zakazany wyłącznie przy windykacji (payment_failed)", () => {
    const forbidden = JOURNEY_TRIGGERS.filter((t) => t.emailForbidden).map((t) => t.eventType);
    expect(forbidden).toEqual([PAYMENT_FAILED_EVENT]);
  });

  it("wyszukiwanie po typie", () => {
    expect(journeyTrigger("checkout.abandoned.v1")?.group).toBe("funnel");
    expect(journeyTrigger("nie.ma.v1")).toBeNull();
    expect(isJourneyTrigger("account.registered.v1")).toBe(true);
    expect(isJourneyTrigger("post.published.v1")).toBe(false);
  });
});

describe("warunek `payload @> condition`", () => {
  it("buduje płaski obiekt z pól katalogu; puste pola znikają", () => {
    expect(
      buildTriggerCondition("checkout.abandoned.v1", {
        kind: "subscription",
        tier_key: "  pro ",
        has_coupon: false,
        currency: undefined,
        plan_id: null,
        event_id: "",
      }),
    ).toEqual({ kind: "subscription", tier_key: "pro", has_coupon: false });
    expect(buildTriggerCondition("metering.quota_exhausted.v1", {})).toEqual({});
  });

  it("nieznany wyzwalacz, pole spoza katalogu, zły typ, wartość spoza opcji = błąd", () => {
    const attempt = (event: string, values: Record<string, unknown>) => {
      try {
        buildTriggerCondition(event, values);
        return null;
      } catch (err) {
        expect(err).toBeInstanceOf(TriggerConditionError);
        return (err as TriggerConditionError).field;
      }
    };
    expect(attempt("nie.ma.v1", {})).toBe("eventType");
    expect(attempt("checkout.abandoned.v1", { order_id: "x" })).toBe("order_id");
    expect(attempt("checkout.abandoned.v1", { has_coupon: "tak" })).toBe("has_coupon");
    expect(attempt("checkout.abandoned.v1", { kind: "bundle" })).toBe("kind");
    expect(attempt("checkout.abandoned.v1", { tier_key: "x".repeat(201) })).toBe("tier_key");
    expect(attempt("checkout.abandoned.v1", { tier_key: 5 })).toBe("tier_key");
  });
});
