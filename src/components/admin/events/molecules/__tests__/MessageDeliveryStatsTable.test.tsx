// DZIENNIK DORĘCZEŃ panelu „Komunikacja".
//
// CO TEN PLIK DOWODZI:
//  1. Każdy wiersz ma etykietę rodzaju i kanału z JAWNYCH map
//     (`participantDeliveryKinds.ts`), a cztery liczniki stoją w kolumnach
//     stanów w stałej kolejności (w kolejce, wysłane, pominięte, nieudane).
//  2. Tabela ma podpis (dla czytnika ekranu) i nagłówki kolumn.
//  3. Pusty dziennik to zdanie, a nie pusta tabela.
//  4. „Ostatnia wysyłka" stoi w strefie WYDARZENIA, ze skrótem strefy - i nie
//     pojawia się wcale, gdy nic jeszcze nie wyszło albo data jest nieczytelna.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { MessageDeliveryStats } from "@/lib/events/participantSettingsApi";
import { axeViolations, summarize } from "@/test/axe";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-participant", () => ({ ensureI18n: () => {} }));

const { MessageDeliveryStatsTable } =
  await import("@/components/admin/events/molecules/MessageDeliveryStatsTable");

const STATS: MessageDeliveryStats = {
  rows: [
    { kind: "event_reminder", channel: "email", claimed: 1, sent: 40, skipped: 3, failed: 2 },
    { kind: "waitlist_offer", channel: "sms", claimed: 0, sent: 5, skipped: 1, failed: 0 },
  ],
  lastSentAt: "2026-09-15T08:30:00.000Z",
};

describe("MessageDeliveryStatsTable", () => {
  it("wiersz = rodzaj i kanał z jawnych map + cztery liczniki w stałej kolejności", () => {
    render(<MessageDeliveryStatsTable stats={STATS} timezone="Europe/Warsaw" />);

    const rows = screen.getAllByRole("row");
    // nagłówek + dwa wiersze danych
    expect(rows).toHaveLength(3);
    const cells = within(rows[1] as HTMLElement)
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
    expect(cells).toEqual([
      "adminEventParticipant.deliveries.kind.eventReminder",
      "adminEventParticipant.deliveries.channel.email",
      "1",
      "40",
      "3",
      "2",
    ]);
    expect(within(rows[2] as HTMLElement).getAllByRole("cell")[1]?.textContent).toBe(
      "adminEventParticipant.deliveries.channel.sms",
    );
  });

  it("ma podpis tabeli i nagłówki kolumn - rodzaj, kanał, cztery stany", () => {
    render(<MessageDeliveryStatsTable stats={STATS} timezone="Europe/Warsaw" />);

    expect(
      screen.getByRole("table", {
        name: "adminEventParticipant.communications.deliveries.caption",
      }),
    ).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "adminEventParticipant.communications.deliveries.columns.kind",
      "adminEventParticipant.communications.deliveries.columns.channel",
      "adminEventParticipant.deliveries.status.claimed",
      "adminEventParticipant.deliveries.status.sent",
      "adminEventParticipant.deliveries.status.skipped",
      "adminEventParticipant.deliveries.status.failed",
    ]);
  });

  it("„ostatnia wysyłka” stoi w strefie WYDARZENIA ze skrótem strefy", () => {
    render(<MessageDeliveryStatsTable stats={STATS} timezone="Europe/Warsaw" />);

    const line = screen.getByText(/adminEventParticipant\.communications\.deliveries\.lastSent/);
    expect(line.textContent).toContain("10:30");
    expect(line.textContent).toMatch(/GMT\+2|CEST/);
  });

  it("ta sama chwila w innej strefie wydarzenia daje inną godzinę", () => {
    render(<MessageDeliveryStatsTable stats={STATS} timezone="America/New_York" />);

    expect(
      screen.getByText(/adminEventParticipant\.communications\.deliveries\.lastSent/).textContent,
    ).toContain("04:30");
  });

  it("bez żadnej wysyłki linii „ostatnia wysyłka” nie ma", () => {
    render(<MessageDeliveryStatsTable stats={{ ...STATS, lastSentAt: null }} timezone={null} />);

    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByText(/deliveries\.lastSent/)).toBeNull();
  });

  it("nieczytelna data nie daje „Invalid Date” - linii po prostu nie ma", () => {
    render(
      <MessageDeliveryStatsTable stats={{ ...STATS, lastSentAt: "nie-data" }} timezone={null} />,
    );

    expect(screen.queryByText(/deliveries\.lastSent/)).toBeNull();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it("pusty dziennik to zdanie, a nie pusta tabela", () => {
    render(<MessageDeliveryStatsTable stats={{ rows: [], lastSentAt: null }} timezone={null} />);

    expect(screen.getByText("adminEventParticipant.communications.deliveries.empty")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("nie ma naruszeń axe", async () => {
    const { container } = render(
      <MessageDeliveryStatsTable stats={STATS} timezone="Europe/Warsaw" />,
    );

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
