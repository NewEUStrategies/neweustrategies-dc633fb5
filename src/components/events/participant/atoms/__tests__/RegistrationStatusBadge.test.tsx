// PLAKIETKA STANU ZGŁOSZENIA panelu „Moje" (D0-5).
//
// CO TEN PLIK DOWODZI:
//  1. KAŻDY status z CHECK `event_registrations.status` ma swój ton - a status
//     `approved` / `attended` jest AKTYWNY. Dawna plakietka pytała o
//     `confirmed` / `registered` / `paid`, których tabela nie zna, więc
//     zaakceptowane zgłoszenie świeciło jako „oczekujące".
//  2. Brak zgłoszenia i status nieznany NIE rysują plakietki - obietnica stanu
//     na podstawie wartości, której nie znamy, jest gorsza niż jej brak.
//  3. Mapa tonów ma cztery pełne literały kluczy. Prawdziwe zdania (render
//     z `i18nReal`) sprawdza wspólny plik map etykiet F1-F5
//     (`src/components/events/__tests__/participantEnumMapsI18n.test.tsx`).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const { RegistrationStatusBadge } =
  await import("@/components/events/participant/atoms/RegistrationStatusBadge");
const { REGISTRATION_STATUS_TONE, REGISTRATION_STATUS_TONE_LABEL_KEYS, registrationStatusTone } =
  await import("@/lib/events/participantSurface");

const OCZEKIWANE: readonly (readonly [status: string, tone: string])[] = [
  ["approved", "active"],
  ["attended", "active"],
  ["pending", "pending"],
  ["draft", "pending"],
  ["waitlist", "waitlist"],
  ["cancelled", "closed"],
  ["rejected", "closed"],
  ["no_show", "closed"],
];

describe("registrationStatusTone - status -> ton", () => {
  it.each(OCZEKIWANE)("%s -> %s", (status, tone) => {
    expect(registrationStatusTone(status)).toBe(tone);
  });

  it("mapa obejmuje DOKŁADNIE statusy tabeli - ani jednego więcej", () => {
    expect(Object.keys(REGISTRATION_STATUS_TONE).sort()).toEqual(
      OCZEKIWANE.map(([status]) => status).sort(),
    );
  });

  it("każdy ton ma pełny literał klucza pod `eventParticipant.status`", () => {
    expect(REGISTRATION_STATUS_TONE_LABEL_KEYS).toEqual({
      active: "eventParticipant.status.active",
      pending: "eventParticipant.status.pending",
      waitlist: "eventParticipant.status.waitlist",
      closed: "eventParticipant.status.closed",
    });
  });

  it("status nieznany (także dawne `confirmed`/`paid` i nazwy z prototypu) to brak tonu", () => {
    for (const status of ["confirmed", "registered", "paid", "unknown", "constructor", ""]) {
      expect(registrationStatusTone(status)).toBeNull();
    }
  });
});

describe("RegistrationStatusBadge - render", () => {
  it.each(OCZEKIWANE)("status %s pokazuje zdanie tonu %s", (status, tone) => {
    render(<RegistrationStatusBadge status={status} />);

    expect(screen.getByText(`eventParticipant.status.${tone}`)).toBeTruthy();
  });

  it("brak zgłoszenia to BRAK plakietki", () => {
    const { container } = render(<RegistrationStatusBadge status={null} />);

    expect(container.innerHTML).toBe("");
  });

  it("status spoza mapy to BRAK plakietki, a nie „oczekujące”", () => {
    const { container } = render(<RegistrationStatusBadge status="confirmed" />);

    expect(container.innerHTML).toBe("");
  });

  it("plakietka nie ma naruszeń axe", async () => {
    const { container } = render(<RegistrationStatusBadge status="approved" />);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
