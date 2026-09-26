// Maskowanie poświadczeń w adresach wysyłanych do analityki i telemetrii.
//
// Tokeny przekazania biletu, kody certyfikatów, kody zaproszeń i tokeny
// subskrypcji kalendarza mają 32 znaki - reguła `LONG_B64` (>= 40) z
// `redact.ts` ich nie łapie. Każda reguła ma tu przypadek pozytywny i
// kontrprzykład (podobna ścieżka BEZ sekretu zostaje nietknięta).
import { describe, expect, it } from "vitest";

import {
  redactCredentialPath,
  redactTrackedHref,
  redactTrackedPath,
} from "@/lib/analytics/redactTrackedUrl";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

describe("redactCredentialPath", () => {
  it.each([
    [`/tickets/transfer/${TOKEN}`, "/tickets/transfer/[redacted]"],
    [`/en/tickets/transfer/${TOKEN}`, "/en/tickets/transfer/[redacted]"],
    ["/certificates/ABCD-EFGH-JKMN-PQRS", "/certificates/[redacted]"],
    ["/en/certificates/ABCD-EFGH-JKMN-PQRS", "/en/certificates/[redacted]"],
    ["/events/invite/kod-zaproszenia", "/events/invite/[redacted]"],
    ["/en/events/invite/kod-zaproszenia/extra", "/en/events/invite/[redacted]/extra"],
    [`/api/public/calendar/${TOKEN}/plan.ics`, "/api/public/calendar/[redacted]/plan.ics"],
    // Ostrożniej niż minimum ze specyfikacji: token kalendarza maskujemy także
    // bez końcowego ukośnika (adres ucięty w logu nadal niesie sekret).
    [`/api/public/calendar/${TOKEN}`, "/api/public/calendar/[redacted]"],
  ])("%s -> %s", (input, output) => {
    expect(redactCredentialPath(input)).toBe(output);
  });

  it.each([
    "/tickets",
    "/tickets/transfer",
    "/tickets/transfer/",
    "/events/forum",
    "/events/forum/invite/x",
    "/pl/tickets/transfer/x",
    "/api/public/calendar",
    "/api/public/events/forum/calendar.ics",
  ])("kontrprzykład %s zostaje", (input) => {
    expect(redactCredentialPath(input)).toBe(input);
  });
});

describe("redactTrackedPath", () => {
  it("parametry token/t/code maskowane (wielkość liter bez znaczenia), reszta zostaje", () => {
    expect(redactTrackedPath("/events/forum/manage?token=abc&page=2&T=x&Code=y&tab=me")).toBe(
      "/events/forum/manage?token=[redacted]&page=2&T=[redacted]&Code=[redacted]&tab=me",
    );
  });

  it("tylko dokładna nazwa parametru - `tokens`, `ts`, `codex` zostają", () => {
    expect(redactTrackedPath("/x?tokens=1&ts=2&codex=3&t=4")).toBe(
      "/x?tokens=1&ts=2&codex=3&t=[redacted]",
    );
  });

  it("parametr bez wartości zostaje, pusty segment też", () => {
    expect(redactTrackedPath("/x?token&&a=1")).toBe("/x?token&&a=1");
  });

  it("fragment odcięty w całości (link gościa #t=)", () => {
    expect(redactTrackedPath("/events/forum/follow-up#t=sekret")).toBe("/events/forum/follow-up");
    expect(redactTrackedPath("/events/forum?page=1#t=sekret")).toBe("/events/forum?page=1");
  });

  it("ścieżka i zapytanie razem", () => {
    expect(redactTrackedPath(`/tickets/transfer/${TOKEN}?utm_source=mail&t=x`)).toBe(
      "/tickets/transfer/[redacted]?utm_source=mail&t=[redacted]",
    );
  });

  it("puste zapytanie po `?` znika, zwykła ścieżka bez zmian", () => {
    expect(redactTrackedPath("/events?")).toBe("/events");
    expect(redactTrackedPath("/events")).toBe("/events");
    expect(redactTrackedPath("")).toBe("");
  });
});

describe("redactTrackedHref", () => {
  it("pełny adres: origin + maskowana ścieżka", () => {
    expect(redactTrackedHref(`https://example.org/tickets/transfer/${TOKEN}?t=1#t=2`)).toBe(
      "https://example.org/tickets/transfer/[redacted]?t=[redacted]",
    );
  });

  it("adres względny zostaje względny", () => {
    expect(redactTrackedHref("/certificates/ABCD?code=x")).toBe(
      "/certificates/[redacted]?code=[redacted]",
    );
  });

  it("adres bez ścieżki i adres z nietypowym hostem", () => {
    expect(redactTrackedHref("https://example.org")).toBe("https://example.org");
    expect(redactTrackedHref("http://[zly/tickets/transfer/abc?token=1")).toBe(
      "http://[zly/tickets/transfer/[redacted]?token=[redacted]",
    );
  });
});
