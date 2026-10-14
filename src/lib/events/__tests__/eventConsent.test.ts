// Kształty odpowiedzi zgód uczestnika (`eventConsent.ts`) - parsery i token
// z fragmentu adresu (REG-02 / REG-14).
//
// CO PSUJE SIĘ BEZ TYCH TESTÓW:
//   * token z maila czytany z zapytania zamiast z fragmentu - poświadczenie
//     w logach dostępu i nagłówku `Referer`;
//   * nieznany stan bazy udaje znany (np. „open" dla stanu, którego interfejs
//     nie zna - przycisk potwierdzenia przy linku, którego nie da się użyć);
//   * odpowiedź wycofania z bazy przepuszczona dalej z dodatkowymi kluczami
//     (wyrocznia stanu cudzych zgód).
import { describe, expect, it } from "vitest";

import {
  eventConsentConfirmPath,
  hasActiveGrant,
  parseEventConsentConfirm,
  parseEventConsentPreview,
  parseEventConsentWithdraw,
  parseMyEventConsentState,
  readConsentFragmentToken,
} from "@/lib/events/eventConsent";

const TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";

describe("token linku DOI - fragment adresu", () => {
  it("ścieżka z maila niesie token we fragmencie, a odczyt go z niego bierze", () => {
    const path = eventConsentConfirmPath(TOKEN);
    expect(path).toBe(`/event-consent/confirm#token=${TOKEN}`);
    expect(readConsentFragmentToken(path.slice(path.indexOf("#")))).toBe(TOKEN);
    expect(readConsentFragmentToken(`token=${TOKEN}`)).toBe(TOKEN);
  });

  it("zły kształt i brak tokenu = null (nie idzie do sieci)", () => {
    expect(readConsentFragmentToken("")).toBeNull();
    expect(readConsentFragmentToken("#token=krotki")).toBeNull();
    expect(readConsentFragmentToken(`#t=${TOKEN}`)).toBeNull();
    expect(readConsentFragmentToken(`#token=${TOKEN}x`)).toBeNull();
  });
});

describe("parsery odpowiedzi bazy", () => {
  it("podgląd: nieznany stan = not_found, cele i teksty spoza listy pomijane", () => {
    expect(
      parseEventConsentPreview({
        state: "inny",
        purposes: ["marketing", "data_processing", 5],
        texts: [
          { purpose: "marketing", body: "Tekst" },
          { purpose: "data_processing", body: "Inny" },
        ],
      }),
    ).toEqual({
      state: "not_found",
      purposes: ["marketing"],
      lang: null,
      expiresAt: null,
      event: null,
      texts: [{ purpose: "marketing", body: "Tekst" }],
    });
  });

  it("potwierdzenie: tylko confirmed/already to sukces; reszta to stan odmowy", () => {
    expect(
      parseEventConsentConfirm({ ok: true, state: "confirmed", purposes: ["marketing"] }),
    ).toEqual({ ok: true, state: "confirmed", purposes: ["marketing"] });
    expect(parseEventConsentConfirm({ ok: true, state: "open" })).toEqual({
      ok: false,
      state: "error",
    });
    expect(parseEventConsentConfirm(null)).toEqual({ ok: false, state: "error" });
  });

  it("wycofanie: sukces to ZAWSZE nowy obiekt `{ok:true}` (nic z bazy się nie dokleja)", () => {
    expect(parseEventConsentWithdraw({ ok: true, had_marketing: true })).toEqual({ ok: true });
    expect(parseEventConsentWithdraw({ ok: false, error: "invalid_payload" })).toEqual({
      ok: false,
      reason: "invalid_payload",
    });
    expect(parseEventConsentWithdraw("x")).toEqual({ ok: false, reason: "error" });
  });

  it("stan zgód: projekcja, otwarty link, księga; hasActiveGrant", () => {
    const parsed = parseMyEventConsentState({
      linked: true,
      email: "a@x.pl",
      consents: { marketing_at: null, partner_sharing_at: "2026-10-01T00:00:00Z" },
      open_confirmation: { purposes: ["marketing"], expires_at: "2026-10-08T00:00:00Z" },
      ledger: [],
    });
    expect(parsed.openConfirmation).toEqual({
      purposes: ["marketing"],
      createdAt: null,
      expiresAt: "2026-10-08T00:00:00Z",
    });
    expect(hasActiveGrant(parsed.consents)).toBe(true);
    expect(hasActiveGrant(parseMyEventConsentState({ linked: false }).consents)).toBe(false);
  });
});
