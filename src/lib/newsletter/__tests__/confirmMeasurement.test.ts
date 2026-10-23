// Kontrakt tras potwierdzenia double opt-in z kartą zgody na pomiar i języka
// strony pomiaru (I9d-Y2b, R1.19/R1.20): parsery i mapowania serwer <-> strona.
//
// CO TEN PLIK DOWODZI.
//   1. GET: stan karty z RPC jest FAIL-CLOSED (błąd, `invalid`, `inactive`,
//      `gone`, nieznany kształt -> `none`), a strona pokazuje kartę wyłącznie
//      przy `ok`/`already` + `offer` + poprawnym języku.
//   2. POST: ciało przechodzi tylko z poprawnym tokenem, decyzją i sekretem
//      skrzynki `m` (I9d-Y2b R1 - sam token DOI widział personel); każdy
//      wynik RPC ma jeden kod HTTP; nieznany kształt -> `null` (trasa: 500).
//   2a. Sekret skrzynki: kształt, link strony i endpointu z `m` tylko przy
//      poprawnym kształcie, ciało POST z `m`.
//   3. Strona pomiaru bierze język treści z odpowiedzi, nie z adresu.
//   4. Żadna odpowiedź zbudowana tu nie niesie adresu e-mail.
import { describe, expect, it } from "vitest";

import {
  DOI_MEASUREMENT_DECIDE_RESULTS,
  DOI_MEASUREMENT_DECISION_ERRORS,
  DOI_MEASUREMENT_PARAM,
  DOI_MEASUREMENT_STATE_RESULTS,
  doiMeasurementDecisionBody,
  doiMeasurementDecisionError,
  doiMeasurementDecisionReplyOf,
  doiMeasurementDecisionViewOf,
  doiMeasurementFieldsOf,
  isConfirmTokenFormat,
  isDoiMeasurementTokenFormat,
  measurementPageLangOf,
  NEWSLETTER_CONFIRM_API_PATH,
  newsletterConfirmApiUrl,
  newsletterConfirmViewOf,
  parseDoiMeasurementDecisionRequest,
  withDoiMeasurementSecret,
} from "../confirmMeasurement";

const TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
/** Kształt sekretu skrzynki `md:` (podpis sprawdza serwer - tu tylko kształt). */
const SECRET = `d${"0123456789abcdef".repeat(2)}0000ffff${"fedcba9876543210".repeat(2)}`;

describe("sekret skrzynki z maila DOI (I9d-Y2b R1)", () => {
  it("kształt: `d` + 72 znaki szesnastkowe; inne - nie", () => {
    expect(SECRET).toHaveLength(73);
    expect(DOI_MEASUREMENT_PARAM).toBe("m");
    expect(isDoiMeasurementTokenFormat(SECRET)).toBe(true);
    expect(isDoiMeasurementTokenFormat(SECRET.toUpperCase().replace(/^D/, "d"))).toBe(true);
    for (const bad of [
      TOKEN,
      `c${SECRET.slice(1)}`,
      SECRET.slice(0, 72),
      `${SECRET}0`,
      `d${"g".repeat(72)}`,
      "",
      null,
      7,
    ]) {
      expect(isDoiMeasurementTokenFormat(bad)).toBe(false);
    }
  });

  it("link strony i endpointu niesie `m` tylko w poprawnym kształcie (kodowany)", () => {
    expect(withDoiMeasurementSecret(`/newsletter/confirm?token=${TOKEN}`, SECRET)).toBe(
      `/newsletter/confirm?token=${TOKEN}&m=${SECRET}`,
    );
    expect(withDoiMeasurementSecret("/newsletter/confirm", SECRET)).toBe(
      `/newsletter/confirm?m=${SECRET}`,
    );
    for (const bad of [null, undefined, "", "d123", `${SECRET}&admin=1`]) {
      expect(withDoiMeasurementSecret(`/x?token=${TOKEN}`, bad)).toBe(`/x?token=${TOKEN}`);
    }
    expect(newsletterConfirmApiUrl(TOKEN, SECRET)).toBe(
      `${NEWSLETTER_CONFIRM_API_PATH}?token=${TOKEN}&m=${SECRET}`,
    );
    expect(newsletterConfirmApiUrl(TOKEN)).toBe(`${NEWSLETTER_CONFIRM_API_PATH}?token=${TOKEN}`);
  });

  it("ciało POST karty: token, decyzja i sekret - parser serwera je przyjmuje", () => {
    const body = doiMeasurementDecisionBody(TOKEN, SECRET, "grant");
    expect(body).toEqual({ token: TOKEN, decision: "grant", m: SECRET });
    expect(parseDoiMeasurementDecisionRequest(JSON.parse(JSON.stringify(body)))).toEqual({
      ok: true,
      request: body,
    });
  });
});

describe("format tokenu (reguła `isValidConfirmToken`)", () => {
  it("16-128 znaków szesnastkowych; inne typy i znaki - nie", () => {
    expect(NEWSLETTER_CONFIRM_API_PATH).toBe("/api/public/newsletter/confirm");
    expect(isConfirmTokenFormat(TOKEN)).toBe(true);
    expect(isConfirmTokenFormat("A".repeat(16))).toBe(true);
    expect(isConfirmTokenFormat("a".repeat(128))).toBe(true);
    for (const bad of ["a".repeat(15), "a".repeat(129), `${TOKEN}g`, "", null, 42, undefined]) {
      expect(isConfirmTokenFormat(bad)).toBe(false);
    }
  });
});

describe("GET - pola karty pomiaru z `newsletter_doi_measurement_state`", () => {
  it("offer/granted/declined/none przechodzą z językiem z RPC", () => {
    for (const result of ["offer", "granted", "declined", "none"] as const) {
      expect(doiMeasurementFieldsOf({ result, lang: "en" }, "pl")).toEqual({
        measurement: result,
        measurementLang: "en",
      });
    }
  });

  it("fail-closed: invalid/inactive/gone, błąd RPC (null) i nieznany kształt -> none", () => {
    expect(DOI_MEASUREMENT_STATE_RESULTS).toContain("inactive");
    for (const data of [
      { result: "invalid" },
      { result: "inactive" },
      { result: "gone" },
      { result: "OFFER" },
      { result: ["offer"] },
      [{ result: "offer" }],
      "offer",
      null,
      undefined,
    ]) {
      expect(doiMeasurementFieldsOf(data, "en")).toEqual({
        measurement: "none",
        measurementLang: "en",
      });
    }
    // Stan nieaktywny z językiem z RPC: nadal bez karty.
    expect(doiMeasurementFieldsOf({ result: "inactive", lang: "pl" }, "en")).toEqual({
      measurement: "none",
      measurementLang: "pl",
    });
  });

  it("brak albo zły język w RPC -> język wiersza (ta sama reguła co SQL)", () => {
    expect(doiMeasurementFieldsOf({ result: "offer" }, "en").measurementLang).toBe("en");
    expect(doiMeasurementFieldsOf({ result: "offer", lang: "de" }, "pl").measurementLang).toBe(
      "pl",
    );
  });
});

describe("GET - widok strony potwierdzenia", () => {
  it("ok z ofertą -> karta w języku subskrybenta", () => {
    expect(
      newsletterConfirmViewOf(200, { ok: true, measurement: "offer", measurementLang: "en" }),
    ).toEqual({ state: "ok", measurementCard: { lang: "en" }, detail: null });
    expect(
      newsletterConfirmViewOf(200, {
        ok: true,
        already: true,
        measurement: "offer",
        measurementLang: "pl",
      }),
    ).toEqual({ state: "already", measurementCard: { lang: "pl" }, detail: null });
  });

  it("bez karty: inny stan pomiaru, brak pól (stara trasa), zły język", () => {
    for (const body of [
      { ok: true, measurement: "granted", measurementLang: "pl" },
      { ok: true, measurement: "declined", measurementLang: "pl" },
      { ok: true, measurement: "none", measurementLang: "pl" },
      { ok: true },
      { ok: true, already: true },
      { ok: true, measurement: "offer" },
      { ok: true, measurement: "offer", measurementLang: "de" },
    ]) {
      expect(newsletterConfirmViewOf(200, body).measurementCard).toBeNull();
    }
    expect(newsletterConfirmViewOf(200, { ok: true }).state).toBe("ok");
  });

  it("błędy: expired bez karty, inne z kodem albo statusem HTTP", () => {
    expect(
      newsletterConfirmViewOf(410, { ok: false, error: "expired", measurement: "offer" }),
    ).toEqual({ state: "expired", measurementCard: null, detail: null });
    expect(newsletterConfirmViewOf(404, { ok: false, error: "not_found" })).toEqual({
      state: "error",
      measurementCard: null,
      detail: "not_found",
    });
    expect(newsletterConfirmViewOf(502, "<html>")).toEqual({
      state: "error",
      measurementCard: null,
      detail: "HTTP 502",
    });
    expect(newsletterConfirmViewOf(500, null).detail).toBe("HTTP 500");
  });
});

describe("POST - ciało decyzji", () => {
  it("poprawny token, decyzja i sekret skrzynki", () => {
    for (const decision of ["grant", "decline"] as const) {
      expect(
        parseDoiMeasurementDecisionRequest({ token: TOKEN, decision, m: SECRET, extra: 1 }),
      ).toEqual({
        ok: true,
        request: { token: TOKEN, decision, m: SECRET },
      });
    }
  });

  it("sam token DOI (bez sekretu albo z sekretem w złym kształcie) - invalid_token", () => {
    for (const m of [undefined, null, "", TOKEN, SECRET.slice(1), 42]) {
      expect(parseDoiMeasurementDecisionRequest({ token: TOKEN, decision: "grant", m })).toEqual({
        ok: false,
        error: "invalid_token",
      });
    }
  });

  it("najpierw token (invalid_token), potem decyzja (invalid_decision)", () => {
    for (const body of [null, "x", [], {}, { token: "zz" }, { token: 1, decision: "grant" }]) {
      expect(parseDoiMeasurementDecisionRequest(body)).toEqual({
        ok: false,
        error: "invalid_token",
      });
    }
    for (const decision of [undefined, "GRANT", true, "yes", ""]) {
      expect(parseDoiMeasurementDecisionRequest({ token: TOKEN, decision })).toEqual({
        ok: false,
        error: "invalid_decision",
      });
    }
  });
});

describe("POST - wynik RPC -> odpowiedź HTTP", () => {
  it("granted/declined/already -> 200 z wynikiem", () => {
    for (const result of ["granted", "declined", "already"] as const) {
      expect(doiMeasurementDecisionReplyOf({ result, lang: "pl" })).toEqual({
        status: 200,
        body: { ok: true, result },
      });
    }
  });

  it("kody błędów: invalid/gone 400, inactive 409, none 422", () => {
    expect(doiMeasurementDecisionReplyOf({ result: "invalid" })).toEqual({
      status: 400,
      body: { ok: false, error: "invalid_token" },
    });
    expect(doiMeasurementDecisionReplyOf({ result: "gone" })?.status).toBe(400);
    expect(doiMeasurementDecisionReplyOf({ result: "inactive", lang: "en" })).toEqual({
      status: 409,
      body: { ok: false, error: "inactive" },
    });
    expect(doiMeasurementDecisionReplyOf({ result: "none" })).toEqual({
      status: 422,
      body: { ok: false, error: "none" },
    });
  });

  it("każdy wynik RPC ma odpowiedź; nieznany kształt -> null (trasa: 500 update_failed)", () => {
    for (const result of DOI_MEASUREMENT_DECIDE_RESULTS) {
      expect(doiMeasurementDecisionReplyOf({ result })).not.toBeNull();
    }
    for (const data of [null, {}, { result: "offer" }, "granted", [{ result: "granted" }]]) {
      expect(doiMeasurementDecisionReplyOf(data)).toBeNull();
    }
    expect(doiMeasurementDecisionError("update_failed")).toEqual({
      status: 500,
      body: { ok: false, error: "update_failed" },
    });
  });

  it("statusy błędów są stałe", () => {
    expect(DOI_MEASUREMENT_DECISION_ERRORS).toEqual({
      unsupported_media_type: 415,
      invalid_token: 400,
      invalid_decision: 400,
      inactive: 409,
      none: 422,
      rate_limited: 429,
      update_failed: 500,
    });
  });

  it("odpowiedź nie niesie adresu e-mail ani niczego spoza kontraktu", () => {
    const reply = doiMeasurementDecisionReplyOf({
      result: "granted",
      lang: "pl",
      email: "ola@example.com",
    });
    expect(JSON.stringify(reply)).not.toContain("@");
    expect(Object.keys(reply?.body ?? {}).sort()).toEqual(["ok", "result"]);
  });
});

describe("POST - widok karty", () => {
  it("wyniki zapisu", () => {
    for (const result of ["granted", "declined", "already"] as const) {
      expect(doiMeasurementDecisionViewOf(200, { ok: true, result })).toBe(result);
    }
    expect(doiMeasurementDecisionViewOf(200, { ok: true, result: "offer" })).toBe("error");
  });

  it("kody błędów i fallback po statusie", () => {
    expect(doiMeasurementDecisionViewOf(400, { ok: false, error: "invalid_token" })).toBe(
      "invalid",
    );
    expect(doiMeasurementDecisionViewOf(400, { ok: false, error: "invalid_decision" })).toBe(
      "invalid",
    );
    expect(doiMeasurementDecisionViewOf(409, { ok: false, error: "inactive" })).toBe("inactive");
    expect(doiMeasurementDecisionViewOf(422, { ok: false, error: "none" })).toBe("none");
    expect(doiMeasurementDecisionViewOf(429, { ok: false, error: "rate_limited" })).toBe(
      "rateLimited",
    );
    expect(doiMeasurementDecisionViewOf(429, null)).toBe("rateLimited");
    expect(doiMeasurementDecisionViewOf(500, { ok: false, error: "update_failed" })).toBe("error");
    expect(doiMeasurementDecisionViewOf(415, "x")).toBe("error");
  });
});

describe("GET strony pomiaru - język subskrybenta", () => {
  it("język z odpowiedzi; brak albo spoza pl/en -> null", () => {
    expect(measurementPageLangOf({ ok: true, action: "confirm", lang: "en" })).toBe("en");
    expect(measurementPageLangOf({ ok: true, action: "withdraw", lang: "pl" })).toBe("pl");
    for (const body of [{ ok: true, action: "confirm" }, { lang: "de" }, null, "en", []]) {
      expect(measurementPageLangOf(body)).toBeNull();
    }
  });
});
