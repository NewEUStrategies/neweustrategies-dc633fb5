// Stan zgody na pomiar w oknie subskrybenta (I9d-Y2b, R1.8; przegląd R1 -
// ui-r1-1): zawężenie surowej odpowiedzi `email_measurement_state`
// i strażnik najemcy. Okno nie może zgadywać - nieznany kształt to „nie
// udało się odczytać", a nie „brak zgody".
import { describe, expect, it } from "vitest";

import {
  declaredMeasurementView,
  subscriberMeasurementConsentOf,
} from "@/lib/newsletter/subscriberMeasurementState";

const TENANT = "tenant-1";

describe("subscriberMeasurementConsentOf", () => {
  it("wynik czytelnika w najemcy sesji - sama decyzja i przełącznik", () => {
    expect(
      subscriberMeasurementConsentOf(
        {
          result: "ok",
          consent: false,
          measured: false,
          enabled: true,
          tenant_id: TENANT,
          lang: "en",
        },
        TENANT,
      ),
    ).toEqual({ result: "ok", consent: false, enabled: true });
  });

  it("wiersz innego najemcy albo bez najemcy = `gone`", () => {
    expect(
      subscriberMeasurementConsentOf(
        { result: "ok", consent: true, enabled: true, tenant_id: "inny" },
        TENANT,
      ),
    ).toEqual({ result: "gone" });
    expect(
      subscriberMeasurementConsentOf({ result: "ok", consent: true, enabled: true }, TENANT),
    ).toEqual({ result: "gone" });
    expect(subscriberMeasurementConsentOf({ result: "gone" }, TENANT)).toEqual({
      result: "gone",
    });
  });

  it.each([
    null,
    "ok",
    [],
    { result: "invalid" },
    { result: "ok", consent: "tak", enabled: true, tenant_id: TENANT },
    { result: "ok", consent: true, tenant_id: TENANT },
  ])("nieznany kształt %j = `error`", (raw) => {
    expect(subscriberMeasurementConsentOf(raw, TENANT)).toEqual({ result: "error" });
  });
});

describe("declaredMeasurementView", () => {
  it("zgoda udzielona / brak zgody tylko z wyniku czytelnika", () => {
    expect(declaredMeasurementView({ result: "ok", consent: true, enabled: false })).toBe(
      "granted",
    );
    expect(declaredMeasurementView({ result: "ok", consent: false, enabled: true })).toBe(
      "notGranted",
    );
  });

  it("brak wyniku, błąd i brak wiersza - stan nieznany (etykieta neutralna)", () => {
    expect(declaredMeasurementView(undefined)).toBe("unknown");
    expect(declaredMeasurementView(null)).toBe("unknown");
    expect(declaredMeasurementView({ result: "error" })).toBe("unknown");
    expect(declaredMeasurementView({ result: "gone" })).toBe("unknown");
  });
});
