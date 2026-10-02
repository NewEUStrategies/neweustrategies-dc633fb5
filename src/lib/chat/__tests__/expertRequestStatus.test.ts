// Mapa akcja -> status zapytania do eksperta: klucz toastu po decyzji MUSI
// istnieć w obu słownikach. Testy komponentów chodzą na atrapie i18n, która
// oddaje sam klucz - więc nie widzą, że klucza nie ma, i tak właśnie przez
// suitę przeszło `expertRequest.status.decline` (toast z surowym kluczem po
// odrzuceniu zapytania w profilu).
import { describe, expect, it } from "vitest";
import { EXPERT_REQUEST_RESULT_STATUS } from "../expertRequestStatus";
import { expertRequestEn, expertRequestPl } from "@/lib/i18n-expert-request";

describe("EXPERT_REQUEST_RESULT_STATUS", () => {
  it.each(Object.entries(EXPERT_REQUEST_RESULT_STATUS))(
    "akcja %s daje status %s, który ma etykietę PL i EN",
    (_action, status) => {
      expect(expertRequestPl.expertRequest.status[status]).toEqual(expect.any(String));
      expect(expertRequestEn.expertRequest.status[status]).toEqual(expect.any(String));
    },
  );

  it("odrzucenie to `declined`, a nie nazwa akcji", () => {
    expect(EXPERT_REQUEST_RESULT_STATUS.decline).toBe("declined");
    expect(expertRequestPl.expertRequest.status).not.toHaveProperty("decline");
  });
});
