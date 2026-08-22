// Rejestr capabilities: kontrakt "które flagi są egzekwowane". Test pilnuje,
// żeby zestaw egzekwowanych flag nie rozjechał się po cichu (np. ktoś oznaczy
// benefit jako enforced bez realnej bramki) i żeby podział enforced/decorative
// był zgodny z audytem kodu.
import { describe, it, expect } from "vitest";
import {
  TIER_CAPABILITIES,
  capabilityMeta,
  enabledFeatureKeys,
  isEnforcedCapability,
  splitTierFeatures,
} from "@/lib/billing/capabilities";

// Dokładnie te flagi mają dziś realną bramkę (SQL / RLS / server fn).
//
// Ta lista jest kontraktem CZYTANYM PRZEZ LUDZI - świadomą decyzją, co sprzedajemy
// jako egzekwowane. Prawdę maszynową (czy jakakolwiek bramka faktycznie czyta
// flagę) sprawdza osobno bramka parytetu snapshotu bramek:
// src/lib/authz/__tests__/authzSnapshotParity.test.ts. Dwa niezależne testy z
// dwóch stron: ten pilnuje ludzkiej decyzji, tamten - zgodności ze SQL-em.
//
// `chat_inmail_quota_2` / `chat_inmail_quota_5` dopisane po audycie: były
// egzekwowane przez my_inmail_quota / send_expert_inmail, ale rejestr o nich
// milczał - dokładnie ten rodzaj rozjazdu, który wykryła bramka parytetu.
// `early_access` i `chatham_house_events` dopisane przy wdrożeniu korekt audytu
// katalogu v6.1. Obie były wcześniej po przeciwnych stronach tego samego długu:
// `early_access` figurowała w rejestrze jako dekoracja, choć katalog ją
// sprzedawał, a `chatham_house_events` nie istniała mimo kolumny
// `events.chatham_house` w bazie. Dziś obie mają bramkę - odpowiednio politykę
// „Early access reads scheduled posts" i rsvp_event/get_event_access.
const EXPECTED_ENFORCED = [
  "premium_content",
  "regulatory_monitoring",
  "pro_briefings",
  "recordings",
  "qa_priority",
  "chat_enabled",
  "chat_direct_gated",
  "chat_inmail_quota_2",
  "chat_inmail_quota_5",
  "early_access",
  "chatham_house_events",
  "gift_links",
].sort();

describe("rejestr capabilities", () => {
  it("zestaw egzekwowanych flag jest dokładnie ten zweryfikowany w kodzie", () => {
    const enforced = TIER_CAPABILITIES.filter((c) => c.enforced)
      .map((c) => c.key)
      .sort();
    expect(enforced).toEqual(EXPECTED_ENFORCED);
  });

  it("każda pozycja ma opis punktu egzekwowania w obu językach", () => {
    for (const cap of TIER_CAPABILITIES) {
      expect(cap.where_pl.trim().length).toBeGreaterThan(0);
      expect(cap.where_en.trim().length).toBeGreaterThan(0);
      // Flaga bez bramki nie może deklarować obszaru egzekwowania.
      if (!cap.enforced) expect(cap.gate).toBe("none");
      else expect(cap.gate).not.toBe("none");
    }
  });

  it("klucze są unikalne", () => {
    const keys = TIER_CAPABILITIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("isEnforcedCapability: znane egzekwowane / dekoracyjne / nieznane", () => {
    expect(isEnforcedCapability("premium_content")).toBe(true);
    expect(isEnforcedCapability("regulatory_monitoring")).toBe(true);
    expect(isEnforcedCapability("member_library")).toBe(false);
    expect(isEnforcedCapability("nieistniejaca_flaga")).toBe(false);
    expect(capabilityMeta("nieistniejaca_flaga")).toBeUndefined();
  });

  it("enabledFeatureKeys bierze tylko klucze === true, ignoruje śmieci", () => {
    expect(enabledFeatureKeys({ premium_content: true, x: false, y: 1, z: "true" }).sort()).toEqual(
      ["premium_content"],
    );
    expect(enabledFeatureKeys(null)).toEqual([]);
    expect(enabledFeatureKeys([1, 2])).toEqual([]);
    expect(enabledFeatureKeys("nope")).toEqual([]);
  });

  it("splitTierFeatures dzieli flagi warstwy na egzekwowane i dekoracyjne", () => {
    const features = {
      premium_content: true,
      qa_priority: true,
      member_library: true,
      working_groups: true,
      off: false,
    };
    const { enforced, decorative } = splitTierFeatures(features);
    expect(enforced.sort()).toEqual(["premium_content", "qa_priority"]);
    expect(decorative.sort()).toEqual(["member_library", "working_groups"]);
  });
});
