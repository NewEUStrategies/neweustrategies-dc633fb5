// Molekuły KLONU EDYCJI: ostrzeżenia/blokady, listy liczników, podgląd
// przesunięcia i podsumowanie wyniku na pulpicie.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. BLOKADA BEZ OGŁOSZENIA. Blokada zatrzymuje zapis - czytnik ekranu ma ją
//      ogłosić (`role="alert"`); ostrzeżenie nie może krzyczeć tak samo.
//   2. ZERO ZAMIAST „brak". Pusta lista pod nagłówkiem wygląda jak niedoczytany
//      ekran.
//   3. DATY W STREFIE PRZEGLĄDARKI. Podgląd formatuje w strefie NOWEJ edycji,
//      a dni giełdy (`date[]`) w UTC - w strefie na zachód od Greenwich dzień
//      cofnąłby się o jeden.
//   4. PODGLĄD ZNIKA PRZY LICZENIU. Stary wynik zostaje, a obok stoi „Liczę…".
//   5. PODSUMOWANIE NIE ZNIKA. Zamknięcie czyści wpis cache TEGO wydarzenia.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { axeViolations, summarize } from "@/test/axe";
import { freezeClock } from "@/test/time";
import { CLONE_NEW_ID, clonePreview, cloneResult } from "@/test/events/eventCloneFixtures";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-clone", () => ({ ensureCloneI18n: () => undefined }));

const { EventCloneNotices } = await import("@/components/admin/events/molecules/EventCloneNotices");
const { EventCloneItemList } =
  await import("@/components/admin/events/molecules/EventCloneItemList");
const { EventClonePreviewPanel } =
  await import("@/components/admin/events/molecules/EventClonePreviewPanel");
const { EventCloneResultCard } =
  await import("@/components/admin/events/molecules/EventCloneResultCard");
const { eventCloneKeys } = await import("@/lib/events/useEventClone");

freezeClock();

afterEach(() => cleanup());

describe("EventCloneNotices", () => {
  it("blokada jest alertem z nagłówkiem i zdaniem z liczbą", () => {
    render(
      <EventCloneNotices
        title="naglowek"
        notices={[
          { code: "sessions_outside_window", count: 3 },
          { code: "nowa", count: 1 },
        ]}
        tone="blocker"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("naglowek")).toBeInTheDocument();
    expect(
      within(alert).getByText("adminEventClone.blockers.sessionsOutsideWindow(count=3)"),
    ).toBeInTheDocument();
    expect(
      within(alert).getByText("adminEventClone.blockers.unknown(count=1)"),
    ).toBeInTheDocument();
  });

  it("ostrzeżenie NIE jest alertem; pusta lista nie rysuje niczego", () => {
    const { container, rerender } = render(
      <EventCloneNotices
        title="uwagi"
        notices={[{ code: "sales_closed", count: 2 }]}
        tone="warning"
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("adminEventClone.warnings.salesClosed(count=2)")).toBeInTheDocument();
    rerender(<EventCloneNotices title="uwagi" notices={[]} tone="warning" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("EventCloneItemList", () => {
  it("pozycje „Rzecz: N”, a pusta lista mówi „brak”", () => {
    const { rerender } = render(
      <EventCloneItemList
        title="skopiowane"
        entries={[{ id: "rooms", labelKey: "adminEventClone.items.rooms", count: 2 }]}
        emptyLabel="brak"
      />,
    );
    expect(
      screen.getByText("adminEventClone.count(count=2,label=adminEventClone.items.rooms)"),
    ).toBeInTheDocument();
    rerender(<EventCloneItemList title="skopiowane" entries={[]} emptyLabel="brak" />);
    expect(screen.getByText("brak")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("EventClonePreviewPanel", () => {
  it("rysuje przesunięcie, strefę, daty z bazy, blokady, ostrzeżenia i dane nieprzenoszone", async () => {
    const preview = clonePreview({ blockers: [{ code: "slug_taken", count: 1 }] });
    const { container } = render(
      <EventClonePreviewPanel preview={preview} isFetching={false} error={null} />,
    );
    expect(screen.getByText("adminEventClone.preview.shiftDays(count=365)")).toBeInTheDocument();
    expect(
      screen.getByText("adminEventClone.preview.zone(zone=Europe/Warsaw)"),
    ).toBeInTheDocument();
    // Wiersze: początek, koniec, otwarcie zapisów, start sprzedaży, pierwsza
    // i ostatnia sesja - puste daty (koniec sprzedaży, nabór) NIE są wierszami.
    for (const key of [
      "startsAt",
      "endsAt",
      "rsvpOpensAt",
      "salesFrom",
      "firstSession",
      "lastSession",
      "meetingDays",
    ]) {
      expect(screen.getByText(`adminEventClone.preview.rows.${key}`), key).toBeInTheDocument();
    }
    for (const key of ["salesTo", "cfpOpensAt", "cfpClosesAt"]) {
      expect(screen.queryByText(`adminEventClone.preview.rows.${key}`), key).toBeNull();
    }
    // Pierwsza sesja 08:30Z = 9:30 w Warszawie (CET) - format w strefie NOWEJ edycji.
    const first = screen.getByText("adminEventClone.preview.rows.firstSession").nextElementSibling;
    expect(first?.textContent).toMatch(/9:30/);
    // Dni giełdy jako DNI (UTC), zakres od-do.
    expect(
      screen.getByText(/adminEventClone\.preview\.meetingDaysRange\(from=.*20.*,to=.*21.*\)/),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "adminEventClone.blockers.slugTaken(count=1)",
    );
    expect(
      screen.getByText("adminEventClone.warnings.sponsorsUnpublished(count=2)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("adminEventClone.count(count=12,label=adminEventClone.items.registrations)"),
    ).toBeInTheDocument();
    // Zakładki sesji i bilety w portfelu też zostają w poprzedniej edycji.
    expect(
      screen.getByText("adminEventClone.count(count=3,label=adminEventClone.items.sessionSaves)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("adminEventClone.count(count=2,label=adminEventClone.items.walletPasses)"),
    ).toBeInTheDocument();
    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("brak celu czasowego i dni giełdy: kreska-słowo „brak”, bez wiersza giełdy", () => {
    const base = clonePreview();
    render(
      <EventClonePreviewPanel
        preview={clonePreview({
          target: { ...base.target, endsAt: null },
          dates: { ...base.dates, meetingDaysLast: null },
          notCopied: {},
        })}
        isFetching={false}
        error={null}
      />,
    );
    const end = screen.getByText("adminEventClone.preview.rows.endsAt").nextElementSibling;
    expect(end?.textContent).toBe("adminEventClone.preview.empty");
    expect(screen.queryByText("adminEventClone.preview.rows.meetingDays")).toBeNull();
    expect(screen.getByText("adminEventClone.preview.notCopiedEmpty")).toBeInTheDocument();
  });

  it("liczenie w toku zostawia stary wynik; błąd podglądu jest alertem ze zdaniem z mapy", () => {
    const { rerender } = render(
      <EventClonePreviewPanel preview={clonePreview()} isFetching error={null} />,
    );
    expect(screen.getByText("adminEventClone.preview.loading")).toBeInTheDocument();
    expect(screen.getByText("adminEventClone.preview.shiftDays(count=365)")).toBeInTheDocument();

    rerender(
      <EventClonePreviewPanel
        preview={null}
        isFetching={false}
        error={new Error("invalid_timezone: unknown time zone name")}
      />,
    );
    expect(screen.getByRole("alert").textContent).not.toBe("");
    expect(screen.queryByText("adminEventClone.preview.shiftDays(count=365)")).toBeNull();
    expect(screen.queryByText("adminEventClone.preview.loading")).toBeNull();
  });
});

describe("EventCloneResultCard", () => {
  function mount(value: unknown) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (value !== undefined) queryClient.setQueryData(eventCloneKeys.result(CLONE_NEW_ID), value);
    const utils = render(
      <QueryClientProvider client={queryClient}>
        <EventCloneResultCard eventId={CLONE_NEW_ID} />
      </QueryClientProvider>,
    );
    return { ...utils, queryClient };
  }

  it("bez wyniku w cache nie rysuje niczego", () => {
    const { container } = mount(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it("pokazuje ostrzeżenia, skopiowane i pominięte (bez zer); zamknięcie czyści wpis", async () => {
    const { queryClient, container } = mount(cloneResult());
    expect(
      screen.getByRole("heading", { name: "adminEventClone.result.title" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("adminEventClone.warnings.cancelledSessionsSkipped(count=1)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("adminEventClone.count(count=3,label=adminEventClone.items.sessions)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("adminEventClone.count(count=12,label=adminEventClone.items.registrations)"),
    ).toBeInTheDocument();
    // Ustawienia uczestnika przechodzą zawsze - wynik mówi o nich wprost.
    expect(
      screen.getByText(
        "adminEventClone.count(count=1,label=adminEventClone.items.participantSettings)",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("adminEventClone.count(count=4,label=adminEventClone.items.sessionSignups)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/adminEventClone\.items\.crmTasks/)).toBeNull();
    expect(summarize(await axeViolations(container))).toBe("");

    act(() =>
      fireEvent.click(screen.getByRole("button", { name: "adminEventClone.result.dismiss" })),
    );
    expect(queryClient.getQueryData(eventCloneKeys.result(CLONE_NEW_ID))).toBeNull();
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "adminEventClone.result.title" })).toBeNull(),
    );
  });

  it("pusty wynik mówi „brak” w obu listach", () => {
    mount(cloneResult({ copied: {}, skipped: {}, warnings: [] }));
    expect(screen.getAllByText("adminEventClone.result.nothing")).toHaveLength(2);
  });
});
