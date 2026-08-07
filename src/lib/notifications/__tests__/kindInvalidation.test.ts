// Kontrakt mapy „powiadomienie -> co odświeżyć w innych modułach".
//
// Dlaczego to ma test, a nie tylko przebieg w przeglądarce: to JEDYNY kanał
// odświeżania kart sieci kontaktów. Ich tabele mają RLS zamykający bezpośredni
// odczyt (`pv_no_direct_read`) i zapisy wyłącznie przez RPC, więc nie da się na
// nich postawić subskrypcji Realtime. Klucz, który przestanie pasować do klucza
// zapytania modułu, NIE wywoła żadnego błędu - karta po prostu przestanie się
// odświeżać, a taka regresja jest niewidoczna aż do zgłoszenia „muszę robić F5".
import { describe, it, expect } from "vitest";
import {
  invalidationKeysForNotificationKind,
  notificationKindsWithSideEffects,
} from "../kindInvalidation";
import { NOTIFICATION_KINDS } from "../preferences";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";

describe("invalidationKeysForNotificationKind", () => {
  // Prefiksy muszą pokrywać się z kluczami hooków modułów - dlatego są tu
  // wypisane wprost (zmiana klucza w hooku bez zmiany mapy zapala ten test).
  const EXPECTED: Readonly<Record<string, readonly string[][]>> = {
    connection: [
      ["network", "requests"],
      ["network", "connections"],
      ["network", "counts"],
    ],
    // useMyIntroductions: ["network", "introductions", userId, role]
    introduction: [["network", "introductions"]],
    // useRecommendations: ["network", "recommendations", viewerId, recipientId]
    recommendation: [["network", "recommendations"]],
    // useSkillEndorsements: ["network", "endorsements", uid, recipientId]
    endorsement: [["network", "endorsements"]],
    // useMyProfileViewers / useMyProfileViewStats
    profile_view: [
      ["network", "profile-viewers"],
      ["network", "profile-view-stats"],
    ],
    // meetingSlotsQueryOptions: [WIDGET_QUERY_ROOTS.meetingSlots, input, viewerId]
    meeting_booking: [[WIDGET_QUERY_ROOTS.meetingSlots]],
  };

  it.each(Object.keys(EXPECTED))("odświeża klucze modułu dla rodzaju %s", (kind) => {
    expect(invalidationKeysForNotificationKind(kind)).toEqual(EXPECTED[kind]);
  });

  it("każdy rodzaj z katalogu ma rozstrzygniętą regułę (pusta lista to też decyzja)", () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(Array.isArray(invalidationKeysForNotificationKind(kind))).toBe(true);
    }
  });

  it("rodzaje bez własnego widoku listy nie odświeżają niczego poza skrzynką", () => {
    for (const kind of ["system", "security", "content", "comment", "message"]) {
      expect(invalidationKeysForNotificationKind(kind)).toEqual([]);
    }
  });

  it("nieznany rodzaj (nowszy backend, starszy bundle) nie wywraca konsumenta", () => {
    expect(invalidationKeysForNotificationKind("brand_new_kind")).toEqual([]);
  });

  it("każdy rodzaj z efektem ubocznym istnieje w katalogu rodzajów", () => {
    for (const kind of notificationKindsWithSideEffects()) {
      expect(NOTIFICATION_KINDS).toContain(kind);
    }
  });
});
