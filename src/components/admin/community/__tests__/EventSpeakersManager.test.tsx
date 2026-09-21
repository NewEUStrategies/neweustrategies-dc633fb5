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
//
// CO DOSZLO W DRUGIM PODEJSCIU (pakiet E2). Powyzsze piec punktow opisuje
// LISTE; polowa ekranu - dialog PROFILU SCENICZNEGO i obie sciezki zapisu -
// nie miala ani jednej asercji, mimo ze to tam powstaja dane widoczne na
// stronie publicznej i tam stoi jedyna w tym ekranie OPERACJA NISZCZACA.
// Dochodza wiec:
//
//   6. DROPLISTA NAPRAWDE DODAJE, i tylko raz. `onChange` woła RPC wyłącznie
//      dla osoby, ktorej NIE MA jeszcze na liscie - bez tego strażnika drugie
//      wybranie tej samej osoby leci do bazy po blad klucza glownego.
//   7. PROFIL SCENICZNY: zasiew formularza z odczytu, NORMALIZACJA przy zapisie
//      (lista po przecinku -> tablica, jezyki malymi literami, ocena przycieta
//      do 0-5, liczniki nieujemne) i komunikat zalezny od tego, czy powstal
//      lead CRM. Kazda z tych regul jest cicha: zla wartosc nie rzuca wyjatku,
//      tylko zapisuje sie do bazy.
//   8. USUNIECIE PROFILU PYTA O POTWIERDZENIE. To jedyne miejsce tego ekranu,
//      ktore kasuje dane, a przycisk stoi w stopce obok „Zapisz". Test dowodzi
//      OBU stron: odmowa w oknie potwierdzenia NIE kasuje niczego.
//   9. TRZY DROGI BLEDU KONCZA SIE KOMUNIKATEM BAZY, nie cisza: dodanie,
//      usuniecie z wydarzenia i zapis profilu.
import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  AdminSpeakerProfile,
  EventSpeakerEntry,
  EventSpeakerUpsertResult,
} from "@/lib/admin/community";

const fetchEventSpeakers = vi.fn();
const addEventSpeaker = vi.fn();
const removeEventSpeaker = vi.fn();
const setEventSpeakerOrder = vi.fn();
const fetchAdminSpeakerProfile = vi.fn();
const upsertAdminSpeakerProfile = vi.fn();
const deleteAdminSpeakerProfile = vi.fn();

vi.mock("@/lib/admin/community", () => ({
  fetchEventSpeakers: (...a: unknown[]) => fetchEventSpeakers(...a),
  addEventSpeaker: (...a: unknown[]) => addEventSpeaker(...a),
  removeEventSpeaker: (...a: unknown[]) => removeEventSpeaker(...a),
  setEventSpeakerOrder: (...a: unknown[]) => setEventSpeakerOrder(...a),
  fetchAdminSpeakerProfile: (...a: unknown[]) => fetchAdminSpeakerProfile(...a),
  upsertAdminSpeakerProfile: (...a: unknown[]) => upsertAdminSpeakerProfile(...a),
  deleteAdminSpeakerProfile: (...a: unknown[]) => deleteAdminSpeakerProfile(...a),
}));

// Odnosnik do kartoteki CRM jest jedynym miejscem, w ktorym ten ekran dotyka
// routera. Atrapa oddaje zwykla kotwice z rozwinietym parametrem - dowodem
// jest ADRES, pod ktory redaktor trafi, a nie mechanika nawigacji TanStacka.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactNode;
    className?: string;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
      className={className}
    >
      {children}
    </a>
  ),
}));

// Popup zakladania osoby ma wlasny plik testowy - tutaj liczy sie tylko to, ze
// ekran go montuje i ze przycisk go otwiera.
vi.mock("@/components/admin/community/EventSpeakerCreateDialog", () => ({
  EventSpeakerCreateDialog: ({
    open,
    onCreated,
  }: {
    open: boolean;
    onCreated: (result: EventSpeakerUpsertResult, displayName: string) => void;
  }) =>
    open ? (
      <div data-testid="create-dialog">
        {/* Atrapa oddaje TYLKO wynik - reszta popupu ma wlasny plik testowy.
            Ten guzik jest tu po to, zeby dowiesc, co ekran robi PO zalozeniu
            osoby: uniewaznia liste i potwierdza to nazwiskiem. */}
        <button
          type="button"
          data-testid="create-dialog-emit"
          onClick={() =>
            onCreated(
              {
                entry_id: "en-9",
                speaker_profile_id: "sp-9",
                person_id: "pe-9",
                user_id: null,
              },
              "Halszka Borowik",
            )
          }
        >
          emit
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/admin/community/MemberPicker", () => ({
  // Wyszukiwarka kont ma wlasny plik testowy; tutaj potrzebny jest wylacznie
  // jej KONTRAKT WYJSCIA - `onChange(userId)` - zeby dowiesc, co ekran robi
  // z wybranym identyfikatorem.
  MemberPicker: ({
    value,
    onChange,
    labels,
  }: {
    value: string;
    onChange: (userId: string) => void;
    labels: { placeholder: string };
  }) => (
    <div data-testid="member-picker">
      {labels.placeholder}
      <span data-testid="member-picker-value">{value}</span>
      <button type="button" data-testid="pick-u-1" onClick={() => onChange("u-1")}>
        pick 1
      </button>
      <button type="button" data-testid="pick-u-2" onClick={() => onChange("u-2")}>
        pick 2
      </button>
      <button type="button" data-testid="pick-none" onClick={() => onChange("")}>
        pick none
      </button>
    </div>
  ),
}));

const detailState = {
  data: { id: "ev-1", status: "published" } as { id: string; status: string } | null,
};
vi.mock("@/lib/events/useAdminEventDetail", () => ({
  useAdminEventDetail: () => detailState,
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

import { ensureI18n as ensureCommunityEventsI18n } from "@/lib/i18n-admin-community-events";

const { EventSpeakersManager } = await import("@/components/admin/community/EventSpeakersManager");

ensureCommunityEventsI18n();

function speaker(overrides: Partial<EventSpeakerEntry> = {}): EventSpeakerEntry {
  return {
    entry_id: "en-1",
    speaker_profile_id: "sp-1",
    user_id: null,
    person_id: "pe-1",
    display_name: "Halszka Borowik",
    avatar_url: null,
    job_title: "Profesor",
    company: "Wyższa Szkoła Spraw Zmyślonych",
    email: "halszka.borowik@example.com",
    is_public: true,
    sort_order: 0,
    is_legacy: false,
    ...overrides,
  };
}

/** Wspolny reset atrap - te same warunki poczatkowe dla kazdego bloku. */
function resetAll(): void {
  fetchEventSpeakers.mockReset();
  addEventSpeaker.mockReset();
  removeEventSpeaker.mockReset();
  setEventSpeakerOrder.mockReset();
  fetchAdminSpeakerProfile.mockReset().mockResolvedValue(null);
  upsertAdminSpeakerProfile.mockReset().mockResolvedValue({ id: "pr-1", crm_lead_id: null });
  deleteAdminSpeakerProfile.mockReset().mockResolvedValue(true);
  toasts.success.mockReset();
  toasts.error.mockReset();
  detailState.data = { id: "ev-1", status: "published" };
}

function renderManager() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <EventSpeakersManager eventId="ev-1" />
      </QueryClientProvider>,
    ),
  };
}

describe("EventSpeakersManager", () => {
  beforeEach(() => {
    fetchEventSpeakers.mockReset();
    addEventSpeaker.mockReset();
    removeEventSpeaker.mockReset();
    setEventSpeakerOrder.mockReset();
    fetchAdminSpeakerProfile.mockReset().mockResolvedValue(null);
    upsertAdminSpeakerProfile.mockReset().mockResolvedValue({ id: "pr-1", crm_lead_id: null });
    deleteAdminSpeakerProfile.mockReset().mockResolvedValue(true);
    toasts.success.mockReset();
    toasts.error.mockReset();
    detailState.data = { id: "ev-1", status: "published" };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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
    await waitFor(() => expect(screen.getByText("Halszka Borowik")).toBeInTheDocument());
    expect(screen.queryByText(/nie jest widoczna publicznie/)).toBeNull();
  });

  it("osoba bez konta: plakietka „Bez konta” i BRAK przycisku profilu scenicznego", async () => {
    fetchEventSpeakers.mockResolvedValue([speaker()]);
    renderManager();

    await waitFor(() => expect(screen.getByText("Halszka Borowik")).toBeInTheDocument());
    expect(screen.getByText("Bez konta")).toBeInTheDocument();
    // Stanowisko i instytucja sa na liscie - to te same dwie linie, ktore
    // trafiaja na karte publiczna, wiec redaktor widzi, co zobaczy gosc.
    expect(screen.getByText(/Profesor, Wyższa Szkoła Spraw Zmyślonych/)).toBeInTheDocument();
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

    await waitFor(() => expect(screen.getByText("Halszka Borowik")).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText("Halszka Borowik")).toBeInTheDocument());
    expect(document.body.textContent ?? "").not.toContain("adminCommunityEvents.");
  });
});

// --- DODANIE OSOBY, KTORA MA KONTO -----------------------------------------

describe("EventSpeakersManager - droplista kont", () => {
  beforeEach(() => {
    resetAll();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("wybor osoby spoza listy wysyla RPC i czysci droplistę po zapisie", async () => {
    fetchEventSpeakers.mockResolvedValue([]);
    addEventSpeaker.mockResolvedValue({
      entry_id: "en-2",
      speaker_profile_id: "sp-2",
      person_id: null,
      user_id: "u-1",
    });
    renderManager();
    await waitFor(() => expect(screen.getByTestId("member-picker")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("pick-u-1"));
    await waitFor(() => expect(addEventSpeaker).toHaveBeenCalledWith("ev-1", "u-1"));
    // Droplista wraca do stanu pustego: bez tego kolejny wybor tej samej osoby
    // wyglada jak „nic sie nie stalo", bo pole nadal pokazuje poprzedni wybor.
    await waitFor(() => expect(screen.getByTestId("member-picker-value").textContent).toBe(""));
  });

  it("osoba JUZ NA LISCIE nie leci do bazy drugi raz", async () => {
    fetchEventSpeakers.mockResolvedValue([
      speaker({ user_id: "u-1", person_id: null, display_name: "Konto Istniejące" }),
    ]);
    renderManager();
    await waitFor(() => expect(screen.getByText("Konto Istniejące")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("pick-u-1"));
    // Klucz glowny `(event_id, user_id)` odrzucilby to bledem - straznik po
    // stronie ekranu zamienia go w brak akcji.
    expect(addEventSpeaker).not.toHaveBeenCalled();
    // Ale sam wybor jest zapamietany, wiec pole nie „gubi" kliknięcia.
    expect(screen.getByTestId("member-picker-value").textContent).toBe("u-1");
  });

  it("wyczyszczenie droplisty nie wysyla pustego identyfikatora", async () => {
    fetchEventSpeakers.mockResolvedValue([]);
    renderManager();
    await waitFor(() => expect(screen.getByTestId("member-picker")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("pick-none"));
    expect(addEventSpeaker).not.toHaveBeenCalled();
  });

  it("odmowa RPC pokazuje NAZWANY blad bazy, nie „nie udalo sie”", async () => {
    fetchEventSpeakers.mockResolvedValue([]);
    addEventSpeaker.mockRejectedValue(new Error("forbidden: cross-tenant user"));
    renderManager();
    await waitFor(() => expect(screen.getByTestId("member-picker")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("pick-u-2"));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("forbidden: cross-tenant user"));
  });

  it("zalozenie osoby bez konta uniewaznia liste i potwierdza nazwiskiem", async () => {
    fetchEventSpeakers.mockResolvedValue([]);
    const { client } = renderManager();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await waitFor(() => expect(screen.getByTestId("member-picker")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Nowy prelegent/ }));
    fireEvent.click(screen.getByTestId("create-dialog-emit"));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-event-speakers", "ev-1"] });
    expect(toasts.success).toHaveBeenCalledWith("Dodano prelegenta: Halszka Borowik");
  });
});

// --- LISTA: STANY, KOLEJNOSC, BLEDY ----------------------------------------

describe("EventSpeakersManager - stany listy", () => {
  beforeEach(() => {
    resetAll();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("pusta lista mowi to wprost i nie rysuje ani jednego wiersza", async () => {
    fetchEventSpeakers.mockResolvedValue([]);
    const { container } = renderManager();
    await waitFor(() => expect(screen.getByText(/Brak prelegentów/)).toBeInTheDocument());
    expect(container.querySelectorAll("ul li")).toHaveLength(0);
  });

  it("„Spróbuj ponownie” faktycznie ponawia odczyt", async () => {
    fetchEventSpeakers.mockRejectedValueOnce(new Error("network refused"));
    fetchEventSpeakers.mockResolvedValue([speaker()]);
    renderManager();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Spróbuj ponownie/ }));

    await waitFor(() => expect(screen.getByText("Halszka Borowik")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchEventSpeakers.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("wydarzenie bez wczytanego detalu NIE straszy plakietka szkicu", async () => {
    // `null` znaczy „jeszcze nie wiem", a nie „szkic": ostrzezenie pokazane
    // przedwczesnie na wydarzeniu opublikowanym jest komunikatem falszywym.
    detailState.data = null;
    fetchEventSpeakers.mockResolvedValue([speaker()]);
    renderManager();
    await waitFor(() => expect(screen.getByText("Halszka Borowik")).toBeInTheDocument());
    expect(screen.queryByText(/nie jest widoczna publicznie/)).toBeNull();
  });

  it("przesuniecie w dol tez wysyla CALA liste, a strzalki brzegowe sa wylaczone", async () => {
    const first = speaker({ speaker_profile_id: "sp-1", display_name: "Pierwszy" });
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

    // Brzegi: pierwszy nie ma dokad w gore, ostatni w dol.
    expect(screen.getAllByTitle("Wyżej")[0]).toBeDisabled();
    expect(screen.getAllByTitle("Niżej")[1]).toBeDisabled();

    fireEvent.click(screen.getAllByTitle("Niżej")[0]);
    await waitFor(() => expect(setEventSpeakerOrder).toHaveBeenCalledTimes(1));
    const [, items] = setEventSpeakerOrder.mock.calls[0] as [string, EventSpeakerEntry[]];
    expect(items.map((i) => i.speaker_profile_id)).toEqual(["sp-2", "sp-1"]);
  });

  it("nieudana zmiana kolejnosci wraca komunikatem bazy", async () => {
    fetchEventSpeakers.mockResolvedValue([
      speaker({ speaker_profile_id: "sp-1", display_name: "Pierwszy" }),
      speaker({ speaker_profile_id: "sp-2", entry_id: "en-2", display_name: "Drugi" }),
    ]);
    setEventSpeakerOrder.mockRejectedValue(new Error("row level security"));
    renderManager();
    await waitFor(() => expect(screen.getByText("Drugi")).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle("Wyżej")[1]);
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("row level security"));
  });

  it("nieudane usuniecie z wydarzenia wraca komunikatem bazy", async () => {
    fetchEventSpeakers.mockResolvedValue([speaker()]);
    removeEventSpeaker.mockRejectedValue(new Error("speaker not found"));
    renderManager();
    await waitFor(() => expect(screen.getByText("Halszka Borowik")).toBeInTheDocument());

    fireEvent.click(screen.getByTitle("Usuń z wydarzenia"));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("speaker not found"));
  });

  it("wiersz bez nazwy pokazuje identyfikator profilu, a nie puste miejsce", async () => {
    fetchEventSpeakers.mockResolvedValue([
      speaker({ display_name: null, job_title: null, company: null }),
    ]);
    renderManager();
    await waitFor(() => expect(screen.getByText("sp-1")).toBeInTheDocument());
  });
});

// --- PROFIL SCENICZNY (dialog) ---------------------------------------------

/**
 * Profil sceniczny osoby, ktora MA konto. Wartosci sa jawnie fikcyjne, a adres
 * poczty w domenie `example.com` - to sa dane osobowe prelegenta i nie mogą byc
 * prawdziwe nawet w atrapie.
 */
function profileRow(overrides: Partial<AdminSpeakerProfile> = {}): AdminSpeakerProfile {
  return {
    user_id: "u-1",
    headline_pl: "Analityczka rynków zmyślonych",
    headline_en: "Fictional markets analyst",
    bio_pl: "Bada regulacje, których nie ma.",
    bio_en: "Researches regulations that do not exist.",
    topics_pl: ["bankowość", "regulacje"],
    topics_en: ["banking"],
    languages: ["pl", "en"],
    talks_count: 12,
    rating: 4.5,
    reviews_count: 7,
    is_public: false,
    crm_lead_id: null,
    ...overrides,
  };
}

/** Kontrolka pola formularza - etykiety sa i18n-owane, wiec idziemy po tekscie. */
function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const wrapper = screen.getByText(label).closest("div");
  if (wrapper === null) throw new Error(`test: brak pola "${label}"`);
  const control = wrapper.querySelector("input, textarea");
  if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLTextAreaElement)) {
    throw new Error(`test: pole "${label}" bez kontrolki`);
  }
  return control;
}

/** Montuje ekran i otwiera dialog profilu pierwszej osoby Z KONTEM. */
async function openProfile(profile: AdminSpeakerProfile | null = profileRow()) {
  fetchAdminSpeakerProfile.mockResolvedValue(profile);
  fetchEventSpeakers.mockResolvedValue([
    speaker({ user_id: "u-1", person_id: null, display_name: "Halszka Borowik" }),
  ]);
  const utils = renderManager();
  await waitFor(() => expect(screen.getByText("Halszka Borowik")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /Profil prelegenta/ }));
  // Czekamy na ZASIEW, nie na sam dialog: stopka z „Zapisz profil" stoi tam
  // takze w trakcie odczytu, wiec asercja na nia przepuszczalaby test na
  // formularzu, ktorego jeszcze nie ma.
  await waitFor(() => expect(screen.getByText("Rola sceniczna PL")).toBeInTheDocument());
  return utils;
}

describe("EventSpeakersManager - profil sceniczny", () => {
  /** happy-dom nie ma `window.confirm`, a produkcja na nim stoi. */
  let confirmSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetAll();
    confirmSpy = vi.fn(() => true);
    Object.defineProperty(window, "confirm", {
      configurable: true,
      writable: true,
      value: confirmSpy,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "confirm");
  });

  it("odczyt zasiewa formularz, a listy wracaja jako tekst po przecinku", async () => {
    await openProfile(profileRow({ crm_lead_id: "lead-7" }));

    expect(fetchAdminSpeakerProfile).toHaveBeenCalledWith("u-1");
    expect(screen.getByText("Profil prelegenta: Halszka Borowik")).toBeInTheDocument();
    expect(field("Rola sceniczna PL").value).toBe("Analityczka rynków zmyślonych");
    expect(field("Rola sceniczna EN").value).toBe("Fictional markets analyst");
    expect(field("Bio prelegenta PL").value).toBe("Bada regulacje, których nie ma.");
    // Tablica z bazy -> jedno pole tekstowe: separator MUSI byc ten sam, co
    // rozdzielacz przy zapisie, inaczej edycja bez zmian gubi tematy.
    expect(field("Tematy PL (po przecinku)").value).toBe("bankowość, regulacje");
    expect(field("Języki").value).toBe("pl, en");
    expect(field("Wystąpienia").value).toBe("12");
    expect(field("Ocena (0-5)").value).toBe("4.5");
    expect(field("Opinie").value).toBe("7");
    // Lead z odczytu jest linkiem do kartoteki, nie samym identyfikatorem.
    expect(screen.getByRole("link", { name: "lead-7" })).toHaveAttribute(
      "href",
      "/admin/crm/lead-7",
    );
  });

  it("edycja bez zmian zapisuje TE SAME wartosci - obieg tam i z powrotem nic nie gubi", async () => {
    await openProfile();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz profil" }));

    await waitFor(() => expect(upsertAdminSpeakerProfile).toHaveBeenCalledTimes(1));
    expect(upsertAdminSpeakerProfile).toHaveBeenCalledWith({
      userId: "u-1",
      headlinePl: "Analityczka rynków zmyślonych",
      headlineEn: "Fictional markets analyst",
      bioPl: "Bada regulacje, których nie ma.",
      bioEn: "Researches regulations that do not exist.",
      topicsPl: ["bankowość", "regulacje"],
      topicsEn: ["banking"],
      languages: ["pl", "en"],
      talksCount: 12,
      rating: 4.5,
      reviewsCount: 7,
      isPublic: false,
      syncCrm: true,
    });
  });

  it("zapis NORMALIZUJE: puste elementy list precz, jezyki malymi, liczby w zakresie", async () => {
    await openProfile(profileRow({ is_public: true }));

    fireEvent.change(field("Tematy PL (po przecinku)"), {
      target: { value: " bankowość , ,  regulacje ,, " },
    });
    fireEvent.change(field("Języki"), { target: { value: "PL, En, DE" } });
    // Ocena spoza skali i ujemna liczba wystapien: baza ma CHECK, ale komunikat
    // o naruszeniu ograniczenia to nie jest odpowiedz dla redaktora.
    fireEvent.change(field("Ocena (0-5)"), { target: { value: "9.5" } });
    fireEvent.change(field("Wystąpienia"), { target: { value: "-3" } });
    fireEvent.change(field("Opinie"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz profil" }));

    await waitFor(() => expect(upsertAdminSpeakerProfile).toHaveBeenCalledTimes(1));
    const payload = upsertAdminSpeakerProfile.mock.calls[0][0] as Record<string, unknown>;
    // Pusty chip na profilu publicznym jest nie do usuniecia z panelu.
    expect(payload.topicsPl).toEqual(["bankowość", "regulacje"]);
    // Kody jezykow czyta widget publiczny - tylko male litery.
    expect(payload.languages).toEqual(["pl", "en", "de"]);
    expect(payload.rating).toBe(5);
    expect(payload.talksCount).toBe(0);
    expect(payload.reviewsCount).toBe(0);
  });

  it("kazde pole trafia do WLASNEJ kolumny - para PL/EN nie zamienia sie miejscami", async () => {
    // Sześć pól tekstowych stoi parami PL/EN w siatce dwukolumnowej. Zamiana
    // dwóch `onChange` w takiej parze nie daje ani wyjątku, ani złego układu -
    // wychodzi dopiero na stronie publicznej, angielskim bio pod polską flagą.
    // Dlatego każde pole dostaje TU inną, rozpoznawalną wartość.
    await openProfile();
    fireEvent.change(field("Rola sceniczna PL"), { target: { value: "rola-pl" } });
    fireEvent.change(field("Rola sceniczna EN"), { target: { value: "rola-en" } });
    fireEvent.change(field("Bio prelegenta PL"), { target: { value: "bio-pl" } });
    fireEvent.change(field("Bio prelegenta EN"), { target: { value: "bio-en" } });
    fireEvent.change(field("Tematy PL (po przecinku)"), { target: { value: "temat-pl" } });
    fireEvent.change(field("Tematy EN (po przecinku)"), { target: { value: "temat-en" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz profil" }));

    await waitFor(() => expect(upsertAdminSpeakerProfile).toHaveBeenCalledTimes(1));
    const payload = upsertAdminSpeakerProfile.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.headlinePl).toBe("rola-pl");
    expect(payload.headlineEn).toBe("rola-en");
    expect(payload.bioPl).toBe("bio-pl");
    expect(payload.bioEn).toBe("bio-en");
    expect(payload.topicsPl).toEqual(["temat-pl"]);
    expect(payload.topicsEn).toEqual(["temat-en"]);
  });

  it("Escape zamyka dialog profilu bez zapisu", async () => {
    await openProfile();
    // Radix zamyka warstwę klawiszem Escape - to jedyne wyjscie, ktore ma
    // uzytkownik klawiatury, a idzie inna sciezka niz przycisk „Zamknij".
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByText("Rola sceniczna PL")).toBeNull());
    expect(upsertAdminSpeakerProfile).not.toHaveBeenCalled();
  });

  it("przelaczniki jada do zapisu, a nie tylko zmieniaja wyglad", async () => {
    await openProfile(profileRow({ is_public: true }));
    const [isPublic, syncCrm] = screen.getAllByRole("switch");
    fireEvent.click(isPublic);
    fireEvent.click(syncCrm);
    fireEvent.click(screen.getByRole("button", { name: "Zapisz profil" }));

    await waitFor(() => expect(upsertAdminSpeakerProfile).toHaveBeenCalledTimes(1));
    const payload = upsertAdminSpeakerProfile.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.isPublic).toBe(false);
    // Wylaczona synchronizacja to swiadoma decyzja redaktora - domyslnie CRM
    // dostaje lead, ale prelegent-jednorazowy nie musi trafiac do sprzedazy.
    expect(payload.syncCrm).toBe(false);
  });

  it("powstanie leadu CRM zmienia komunikat i dokłada odnosnik do kartoteki", async () => {
    upsertAdminSpeakerProfile.mockResolvedValue({ id: "pr-1", crm_lead_id: "lead-42" });
    await openProfile();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz profil" }));

    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith("Zapisano profil i zsynchronizowano z CRM"),
    );
    expect(screen.getByRole("link", { name: "lead-42" })).toHaveAttribute(
      "href",
      "/admin/crm/lead-42",
    );
  });

  it("zapis bez leadu potwierdza sam zapis i nie klamie o CRM", async () => {
    await openProfile();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz profil" }));

    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Zapisano profil prelegenta"));
    expect(screen.queryByText(/Powiązany lead CRM/)).toBeNull();
  });

  it("blad zapisu wraca komunikatem bazy, a dialog zostaje otwarty", async () => {
    upsertAdminSpeakerProfile.mockRejectedValue(new Error("rating out of range"));
    await openProfile();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz profil" }));

    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("rating out of range"));
    // Zamkniecie po bledzie skasowaloby kilkanascie wpisanych pol.
    expect(screen.getByRole("button", { name: "Zapisz profil" })).toBeInTheDocument();
  });

  it("brak wiersza profilu: pusty formularz i BRAK przycisku usuwania", async () => {
    await openProfile(null);

    expect(field("Rola sceniczna PL").value).toBe("");
    expect(field("Wystąpienia").value).toBe("0");
    // Nie ma czego usuwac - przycisk operacji niszczacej nie moze byc martwy.
    expect(screen.queryByRole("button", { name: "Usuń profil" })).toBeNull();
    expect(screen.getByRole("button", { name: "Zapisz profil" })).toBeEnabled();
  });

  it("USUNIECIE PYTA O POTWIERDZENIE - odmowa nie kasuje niczego", async () => {
    confirmSpy.mockReturnValue(false);
    await openProfile();

    fireEvent.click(screen.getByRole("button", { name: "Usuń profil" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Usunąć profil prelegenta? Wpisy event_speakers i lead CRM pozostaną.",
    );
    expect(deleteAdminSpeakerProfile).not.toHaveBeenCalled();
    // Dialog zostaje otwarty: „Anuluj" w oknie potwierdzenia to powrot do
    // edycji, nie wyjscie z formularza.
    expect(screen.getByRole("button", { name: "Zapisz profil" })).toBeInTheDocument();
  });

  it("potwierdzone usuniecie woła RPC, potwierdza toastem i zamyka dialog", async () => {
    await openProfile();

    fireEvent.click(screen.getByRole("button", { name: "Usuń profil" }));

    await waitFor(() => expect(deleteAdminSpeakerProfile).toHaveBeenCalledWith("u-1"));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Usunięto profil prelegenta"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Zapisz profil" })).toBeNull());
    // Usuniecie NAKLADKI scenicznej nie zdejmuje osoby z wydarzenia - wiersz
    // zostaje na liscie, dokladnie jak mowi tresc potwierdzenia.
    expect(screen.getByText("Halszka Borowik")).toBeInTheDocument();
  });

  it("nieudane usuniecie wraca komunikatem bazy i NIE zamyka dialogu", async () => {
    deleteAdminSpeakerProfile.mockRejectedValue(new Error("profile is referenced"));
    await openProfile();

    fireEvent.click(screen.getByRole("button", { name: "Usuń profil" }));

    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("profile is referenced"));
    expect(screen.getByRole("button", { name: "Zapisz profil" })).toBeInTheDocument();
  });

  it("„Zamknij” wychodzi bez zapisu", async () => {
    await openProfile();
    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Zapisz profil" })).toBeNull());
    expect(upsertAdminSpeakerProfile).not.toHaveBeenCalled();
  });

  it("w trakcie odczytu formularza nie ma - i nie da sie zapisac pustki", async () => {
    // Zapis przed zasiewem nadpisalby profil pustymi polami.
    fetchAdminSpeakerProfile.mockReturnValue(new Promise(() => {}));
    fetchEventSpeakers.mockResolvedValue([
      speaker({ user_id: "u-1", person_id: null, display_name: "Halszka Borowik" }),
    ]);
    renderManager();
    await waitFor(() => expect(screen.getByText("Halszka Borowik")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Profil prelegenta/ }));

    expect(await screen.findByText("Ładowanie…")).toBeInTheDocument();
    expect(screen.queryByText("Rola sceniczna PL")).toBeNull();
    expect(screen.getByRole("button", { name: "Zapisz profil" })).toBeDisabled();
  });

  it("dialog profilu nie wypuszcza surowych kluczy i18n", async () => {
    await openProfile(profileRow({ crm_lead_id: "lead-7" }));
    expect(document.body.textContent ?? "").not.toContain("adminCommunityEvents.");
  });
});
