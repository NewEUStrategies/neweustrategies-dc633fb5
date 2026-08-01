// MeetingBookingView: pełny cykl akcji networkingu 1-1 - rezerwacja slotu,
// anulowanie własnej rezerwacji, publikacja i kasowanie slotu hosta (panel
// "Dodaj slot"), oraz mapowanie błędów RPC na komunikaty toast (slot zajęty /
// własny slot / błąd ogólny). Wszystko na zamockowanym RPC Supabase, żeby
// asertować dokładne parametry wywołań mutacji.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const db = vi.hoisted(() => ({
  slots: [] as unknown[],
  user: null as { id: string } | null,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcErrors: {} as Record<string, string>,
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ fn, args });
      if (db.rpcErrors[fn]) return { data: null, error: { message: db.rpcErrors[fn] } };
      if (fn === "get_public_meeting_slots") return { data: db.slots, error: null };
      return { data: null, error: null };
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: db.user }),
}));

import { MeetingBookingView } from "../MeetingBookingView";

function renderWithClient(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const futureIso = (hours: number): string => new Date(Date.now() + hours * 3_600_000).toISOString();

const slotRow = (over: Record<string, unknown> = {}) => ({
  id: "slot-1",
  host_user_id: "host-1",
  host_name: "Ewa Ekspertka",
  host_avatar_url: "https://cdn.example.com/ewa.png",
  host_slug: "ewa",
  event_id: null,
  starts_at: futureIso(24),
  ends_at: futureIso(24.5),
  location: null,
  is_booked: false,
  booked_by_me: false,
  is_mine: false,
  ...over,
});

const callsTo = (fn: string) => db.rpcCalls.filter((c) => c.fn === fn);

beforeEach(() => {
  db.slots = [];
  db.user = null;
  db.rpcCalls = [];
  db.rpcErrors = {};
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});
afterEach(cleanup);

describe("MeetingBookingView - rezerwacja slotu", () => {
  it("books a free slot via RPC and confirms with a toast", async () => {
    db.user = { id: "viewer-9" };
    db.slots = [slotRow({ location: "stolik B2" })];
    renderWithClient(<MeetingBookingView c={{ mode: "host", hostUserId: "host-1" }} lang="pl" />);

    // Wolny slot z lokalizacją jest klikalny dla zalogowanego.
    const chip = await screen.findByRole("button", { name: /stolik B2/ });
    expect(chip).toBeEnabled();
    fireEvent.click(chip);

    await waitFor(() =>
      expect(callsTo("book_meeting_slot")).toEqual([
        { fn: "book_meeting_slot", args: { p_slot_id: "slot-1", p_note: null } },
      ]),
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Spotkanie zarezerwowane."));
  });

  it("maps the 'already booked' RPC error to the dedicated Polish toast", async () => {
    db.user = { id: "viewer-9" };
    db.slots = [slotRow()];
    db.rpcErrors.book_meeting_slot = "slot already booked";
    renderWithClient(<MeetingBookingView c={{ mode: "host", hostUserId: "host-1" }} lang="pl" />);

    fireEvent.click(await screen.findByRole("button", { name: /-/ }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Ten slot został już zarezerwowany."),
    );
  });

  it("maps the 'own slot' error and the generic failure in EN", async () => {
    db.user = { id: "viewer-9" };
    db.slots = [slotRow()];
    db.rpcErrors.book_meeting_slot = "cannot book your own slot";
    const first = renderWithClient(
      <MeetingBookingView c={{ mode: "host", hostUserId: "host-1" }} lang="en" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /-/ }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("You cannot book your own slot."),
    );
    first.unmount();

    db.rpcErrors.book_meeting_slot = "boom";
    toastMock.error.mockClear();
    renderWithClient(<MeetingBookingView c={{ mode: "host", hostUserId: "host-1" }} lang="en" />);
    fireEvent.click(await screen.findByRole("button", { name: /-/ }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("The operation failed."));
  });
});

describe("MeetingBookingView - anulowanie mojej rezerwacji", () => {
  it("cancels via RPC and confirms in EN", async () => {
    db.user = { id: "viewer-9" };
    db.slots = [slotRow({ id: "slot-c", is_booked: true, booked_by_me: true })];
    renderWithClient(<MeetingBookingView c={{ mode: "host", hostUserId: "host-1" }} lang="en" />);

    fireEvent.click(await screen.findByRole("button", { name: /Cancel/ }));
    await waitFor(() =>
      expect(callsTo("cancel_my_meeting_booking")).toEqual([
        { fn: "cancel_my_meeting_booking", args: { p_slot_id: "slot-c" } },
      ]),
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Booking cancelled."));
  });
});

describe("MeetingBookingView - panel hosta (publikacja i kasowanie slotów)", () => {
  it("publishes a slot with date, time, duration and location", async () => {
    db.user = { id: "host-1" };
    renderWithClient(
      <MeetingBookingView
        c={{ mode: "host", hostUserId: "host-1", intro_pl: "Umów się na rozmowę" }}
        lang="pl"
      />,
    );

    expect(await screen.findByText("Opublikuj swój slot")).toBeInTheDocument();
    expect(screen.getByText("Umów się na rozmowę")).toBeInTheDocument();

    const addBtn = screen.getByRole("button", { name: /Dodaj slot/ });
    // Bez daty i godziny przycisk jest zablokowany.
    expect(addBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Godzina"), { target: { value: "10:30" } });
    fireEvent.change(screen.getByLabelText("Długość"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText(/Miejsce \/ link/), {
      target: { value: "  stolik A1  " },
    });
    expect(addBtn).toBeEnabled();
    fireEvent.click(addBtn);

    await waitFor(() => expect(callsTo("create_my_meeting_slot")).toHaveLength(1));
    const args = callsTo("create_my_meeting_slot")[0].args;
    const starts = new Date(args.p_starts_at as string).getTime();
    const ends = new Date(args.p_ends_at as string).getTime();
    // 45 minut różnicy między startem a końcem; lokalizacja przycięta.
    expect(ends - starts).toBe(45 * 60_000);
    expect(args.p_location).toBe("stolik A1");
    expect(args.p_event_id).toBeNull();
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Slot opublikowany."));
  });

  it("ignores an unparsable date instead of sending garbage to the RPC", async () => {
    db.user = { id: "host-1" };
    renderWithClient(<MeetingBookingView c={{ mode: "host", hostUserId: "host-1" }} lang="pl" />);
    await screen.findByText("Opublikuj swój slot");

    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "nie-data" } });
    fireEvent.change(screen.getByLabelText("Godzina"), { target: { value: "99:99" } });
    fireEvent.click(screen.getByRole("button", { name: /Dodaj slot/ }));

    await waitFor(() => expect(callsTo("create_my_meeting_slot")).toHaveLength(0));
  });

  it("publishes into the event and deletes an own slot (event mode manage rights)", async () => {
    db.user = { id: "anyone-5" };
    db.slots = [slotRow({ id: "slot-m", is_mine: true, event_id: "ev-7" })];
    renderWithClient(
      <MeetingBookingView
        c={{ mode: "event", eventId: "ev-7", heading_en: "Networking EN" }}
        lang="en"
      />,
    );

    // Tryb event: każdy zalogowany może zarządzać własnymi slotami.
    expect(await screen.findByText("Publish your slot")).toBeInTheDocument();
    expect(screen.getByText("Networking EN")).toBeInTheDocument();
    expect(await screen.findByText("your slot")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-02" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("button", { name: /Add slot/ }));
    await waitFor(() => expect(callsTo("create_my_meeting_slot")[0]?.args.p_event_id).toBe("ev-7"));

    // Kasowanie własnego slotu.
    fireEvent.click(screen.getByRole("button", { name: "Delete slot" }));
    await waitFor(() =>
      expect(callsTo("delete_my_meeting_slot")).toEqual([
        { fn: "delete_my_meeting_slot", args: { p_slot_id: "slot-m" } },
      ]),
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Slot deleted."));
  });

  it("hides the manage panel when allowHostManage is off and marks my booked slot", async () => {
    db.user = { id: "host-1" };
    db.slots = [slotRow({ is_mine: true, is_booked: true })];
    renderWithClient(
      <MeetingBookingView
        c={{ mode: "host", hostUserId: "host-1", allowHostManage: "0", accentColor: "#123456" }}
        lang="pl"
      />,
    );

    // Slot hosta zarezerwowany przez kogoś -> etykieta "zarezerwowany".
    expect(await screen.findByText("zarezerwowany")).toBeInTheDocument();
    // Wyłączone zarządzanie -> brak panelu i brak przycisku kasowania.
    expect(screen.queryByText("Opublikuj swój slot")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usuń slot" })).not.toBeInTheDocument();
  });
});

describe("MeetingBookingView - prezentacja slotów w trybie event", () => {
  it("shows the host badge on free chips only when showHost allows it", async () => {
    db.user = { id: "viewer-9" };
    db.slots = [slotRow({ event_id: "ev-7" })];
    const v1 = renderWithClient(
      <MeetingBookingView c={{ mode: "event", eventId: "ev-7" }} lang="pl" />,
    );
    expect(await screen.findByText("Ewa Ekspertka")).toBeInTheDocument();
    v1.unmount();

    renderWithClient(
      <MeetingBookingView c={{ mode: "event", eventId: "ev-7", showHost: "0" }} lang="pl" />,
    );
    await screen.findByRole("button", { name: /-/ });
    expect(screen.queryByText("Ewa Ekspertka")).not.toBeInTheDocument();
  });

  it("shows the EN empty state for a configured event without slots", async () => {
    db.user = null;
    db.slots = [];
    renderWithClient(<MeetingBookingView c={{ mode: "event", eventId: "ev-7" }} lang="en" />);
    expect(await screen.findByText("No available slots.")).toBeInTheDocument();
    expect(screen.getByText(/Sign in to book a 1-1 meeting/)).toBeInTheDocument();
  });
});
