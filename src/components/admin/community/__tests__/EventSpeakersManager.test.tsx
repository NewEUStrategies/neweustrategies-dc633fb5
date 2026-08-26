// Ekran prelegentow wydarzenia - kontrakt renderu.
//
// CO TEN PLIK DOWODZI. Ten ekran byl przedmiotem zgloszenia „nie da sie dodac
// prelegenta ze szczegolami", wiec test pilnuje dokladnie tych rzeczy, ktore to
// zgloszenie wywolaly, i tych, ktore po naprawie latwo cicho zepsuc:
//
//   1. DWIE SCIEZKI DODANIA SA WIDOCZNE NARAZ. Droplista jest wyszukiwarka
//      ISTNIEJACYCH KONT platformy; przycisk „Nowy prelegent" jest jedyna
//      droga dla osoby BEZ konta - a to przypadek TYPOWY (21 z 21 osob
//      w danych referencyjnych wzorca). Ukrycie przycisku wraca do stanu,
//      w ktorym funkcja jest niedostepna z definicji.
//   2. BLAD ODCZYTU NIE JEST PUSTA LISTA. Odmowa RLS wygladala identycznie jak
//      wydarzenie bez prelegentow („Brak prelegentow"), czyli komunikat
//      o bledzie byl podany jako fakt.
//   3. SZKIC MA OSTRZEZENIE. Publiczna projekcja filtruje po
//      `status = 'published'`, wiec na szkicu lista NIE JEST widoczna
//      publicznie. Bez tego zdania redaktor uznaje, ze funkcja nie dziala.
//   4. OSOBA BEZ KONTA JEST OZNACZONA i NIE MA przycisku profilu scenicznego -
//      tamte trzy RPC przyjmuja `p_user_id`, wiec dla niej nie maja czego
//      szukac. Przycisk ma byc UKRYTY, nie martwy.
//   5. USUNIECIE OSOBY Z KONTEM zdejmuje TAKZE rzad legacy: bez `user_id`
//      w payloadzie osoba wracalaby po odswiezeniu z drugiego rejestru.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EventSpeakerEntry } from "@/lib/admin/community";

const fetchEventSpeakers = vi.fn();
const addEventSpeaker = vi.fn();
const removeEventSpeaker = vi.fn();
const setEventSpeakerOrder = vi.fn();

vi.mock("@/lib/admin/community", () => ({
  fetchEventSpeakers: (...a: unknown[]) => fetchEventSpeakers(...a),
  addEventSpeaker: (...a: unknown[]) => addEventSpeaker(...a),
  removeEventSpeaker: (...a: unknown[]) => removeEventSpeaker(...a),
  setEventSpeakerOrder: (...a: unknown[]) => setEventSpeakerOrder(...a),
  fetchAdminSpeakerProfile: () => Promise.resolve(null),
  upsertAdminSpeakerProfile: () => Promise.resolve({ id: null, crm_lead_id: null }),
  deleteAdminSpeakerProfile: () => Promise.resolve(true),
}));

// Popup zakladania osoby ma wlasny plik testowy - tutaj liczy sie tylko to, ze
// ekran go montuje i ze przycisk go otwiera.
vi.mock("@/components/admin/community/EventSpeakerCreateDialog", () => ({
  EventSpeakerCreateDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-dialog" /> : null,
}));

vi.mock("@/components/admin/community/MemberPicker", () => ({
  MemberPicker: ({ labels }: { labels: { placeholder: string } }) => (
    <div data-testid="member-picker">{labels.placeholder}</div>
  ),
}));

const detailState = {
  data: { id: "ev-1", status: "published" } as { id: string; status: string } | null,
};
vi.mock("@/lib/events/useAdminEventDetail", () => ({
  useAdminEventDetail: () => detailState,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ensureI18n as ensureCommunityEventsI18n } from "@/lib/i18n-admin-community-events";

const { EventSpeakersManager } = await import("@/components/admin/community/EventSpeakersManager");

ensureCommunityEventsI18n();

function speaker(overrides: Partial<EventSpeakerEntry> = {}): EventSpeakerEntry {
  return {
    entry_id: "en-1",
    speaker_profile_id: "sp-1",
    user_id: null,
    person_id: "pe-1",
    display_name: "Lech Kurkliński",
    avatar_url: null,
    job_title: "Profesor",
    company: "Szkoła Główna Handlowa",
    email: "lech@example.com",
    is_public: true,
    sort_order: 0,
    is_legacy: false,
    ...overrides,
  };
}

function renderManager() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EventSpeakersManager eventId="ev-1" />
    </QueryClientProvider>,
  );
}

describe("EventSpeakersManager", () => {
  beforeEach(() => {
    fetchEventSpeakers.mockReset();
    addEventSpeaker.mockReset();
    removeEventSpeaker.mockReset();
    setEventSpeakerOrder.mockReset();
    detailState.data = { id: "ev-1", status: "published" };
  });

  it("pokazuje OBIE sciezki dodania: przycisk osoby bez konta i wyszukiwarke kont", async () => {
    fetchEventSpeakers.mockResolvedValue([]);
    renderManager();

    await waitFor(() => expect(screen.getByTestId("member-picker")).toBeInTheDocument());
    const button = screen.getByRole("button", { name: /Nowy prelegent/ });
    expect(button).toBeInTheDocument();
    // Wyszukiwarka kont dostaje wlasna etykiete: bez niej redaktor nie wie,
    // ze droplista NIE zaklada nikogo nowego.
    expect(screen.getByText(/MA konto na platformie/)).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getByTestId("create-dialog")).toBeInTheDocument();
  });

  it("blad odczytu ma wlasny komunikat z trescia wyjatku, a NIE zdanie o pustej liscie", async () => {
    fetchEventSpeakers.mockRejectedValue(new Error("forbidden: admin role required"));
    renderManager();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toContain("forbidden: admin role required");
    expect(document.body.textContent ?? "").not.toContain("Brak prelegentów");
    expect(screen.getByRole("button", { name: /Spróbuj ponownie/ })).toBeInTheDocument();
  });

  it("szkic dostaje ostrzezenie o braku widocznosci publicznej, opublikowane NIE", async () => {
    fetchEventSpeakers.mockResolvedValue([speaker()]);
    detailState.data = { id: "ev-1", status: "draft" };
    const { unmount } = renderManager();
    await waitFor(() =>
      expect(screen.getByText(/nie jest widoczna publicznie/)).toBeInTheDocument(),
    );
    unmount();

    detailState.data = { id: "ev-1", status: "published" };
    renderManager();
    await waitFor(() => expect(screen.getByText("Lech Kurkliński")).toBeInTheDocument());
    expect(screen.queryByText(/nie jest widoczna publicznie/)).toBeNull();
  });

  it("osoba bez konta: plakietka „Bez konta” i BRAK przycisku profilu scenicznego", async () => {
    fetchEventSpeakers.mockResolvedValue([speaker()]);
    renderManager();

    await waitFor(() => expect(screen.getByText("Lech Kurkliński")).toBeInTheDocument());
    expect(screen.getByText("Bez konta")).toBeInTheDocument();
    // Stanowisko i instytucja sa na liscie - to te same dwie linie, ktore
    // trafiaja na karte publiczna, wiec redaktor widzi, co zobaczy gosc.
    expect(screen.getByText(/Profesor, Szkoła Główna Handlowa/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Profil prelegenta/ })).toBeNull();
  });

  it("osoba z kontem: brak plakietki i JEST przycisk profilu scenicznego", async () => {
    fetchEventSpeakers.mockResolvedValue([
      speaker({ user_id: "u-1", person_id: null, display_name: "Anna Konto" }),
    ]);
    renderManager();

    await waitFor(() => expect(screen.getByText("Anna Konto")).toBeInTheDocument());
    expect(screen.queryByText("Bez konta")).toBeNull();
    expect(screen.getByRole("button", { name: /Profil prelegenta/ })).toBeInTheDocument();
  });

  it("usuniecie osoby Z KONTEM podaje takze user_id (rzad legacy)", async () => {
    fetchEventSpeakers.mockResolvedValue([
      speaker({ user_id: "u-1", person_id: null, display_name: "Anna Konto", is_legacy: true }),
    ]);
    removeEventSpeaker.mockResolvedValue(true);
    renderManager();

    await waitFor(() => expect(screen.getByText("Anna Konto")).toBeInTheDocument());
    expect(screen.getByText("Stary rejestr")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Usuń z wydarzenia"));

    await waitFor(() => expect(removeEventSpeaker).toHaveBeenCalledTimes(1));
    expect(removeEventSpeaker).toHaveBeenCalledWith("ev-1", {
      speakerProfileId: "sp-1",
      userId: "u-1",
    });
  });

  it("usuniecie osoby BEZ konta idzie po speaker_profile_id, bez user_id", async () => {
    fetchEventSpeakers.mockResolvedValue([speaker()]);
    removeEventSpeaker.mockResolvedValue(true);
    renderManager();

    await waitFor(() => expect(screen.getByText("Lech Kurkliński")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle("Usuń z wydarzenia"));

    await waitFor(() => expect(removeEventSpeaker).toHaveBeenCalledTimes(1));
    expect(removeEventSpeaker).toHaveBeenCalledWith("ev-1", {
      speakerProfileId: "sp-1",
      userId: undefined,
    });
  });

  it("zmiana kolejnosci wysyla CALA liste w nowej kolejnosci, nie parę wartosci", async () => {
    const first = speaker({ speaker_profile_id: "sp-1", display_name: "Pierwszy", sort_order: 0 });
    const second = speaker({
      speaker_profile_id: "sp-2",
      entry_id: "en-2",
      person_id: "pe-2",
      display_name: "Drugi",
      sort_order: 1,
    });
    fetchEventSpeakers.mockResolvedValue([first, second]);
    setEventSpeakerOrder.mockResolvedValue(2);
    renderManager();

    await waitFor(() => expect(screen.getByText("Drugi")).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle("Wyżej")[1]);

    await waitFor(() => expect(setEventSpeakerOrder).toHaveBeenCalledTimes(1));
    const [eventId, items] = setEventSpeakerOrder.mock.calls[0] as [string, EventSpeakerEntry[]];
    expect(eventId).toBe("ev-1");
    expect(items.map((i) => i.speaker_profile_id)).toEqual(["sp-2", "sp-1"]);
  });

  it("nie wypuszcza surowych kluczy i18n", async () => {
    fetchEventSpeakers.mockResolvedValue([speaker()]);
    renderManager();
    await waitFor(() => expect(screen.getByText("Lech Kurkliński")).toBeInTheDocument());
    expect(document.body.textContent ?? "").not.toContain("adminCommunityEvents.");
  });
});
