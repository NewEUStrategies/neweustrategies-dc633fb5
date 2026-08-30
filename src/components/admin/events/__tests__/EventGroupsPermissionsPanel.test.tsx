// Organizm „GRUPY I UPRAWNIENIA" - ekran, ktory odpowiada na jedno pytanie:
// KTO CO WIDZI w tym wydarzeniu.
//
// DWIE RZECZY NA JEDNYM EKRANIE, bo obie sa odpowiedzia na to samo pytanie:
// grupy dziela ZAPISANYCH na role z wlasnymi zdolnosciami, a tryb goscia
// rozstrzyga, co widzi ktos, kto nie jest zapisany WCALE. Gosc jest tu
// pelnoprawna grupa docelowa, a nie „stanem zerowym".
//
// CO TEN PLIK DOWODZI. Kazda regula jako PARA „moze / nie moze":
//   1. WIDOCZNOSC PUBLICZNA WYLACZONA znaczy, ze zakresu dla gosci NIE MA
//      z czego wybrac - karty wariantow znikaja, bo wydarzenie ukryte nie ma
//      „ile pokazac". Po wlaczeniu karty sa i mozna wybrac szerszy wariant.
//   2. WARIANT „UKRYTE" NIE STOI WSROD KART. Jest przelacznikiem powyzej,
//      wiec powtorzony na liscie dawalby dwa miejsca na te sama decyzje.
//   3. CHATHAM HOUSE WYGRYWA Z TRYBEM GOSCIA. Przy wlaczonej zasadzie ekran
//      mowi o tym wprost - a przy wylaczonej nie straszy ostrzezeniem, ktore
//      nie ma zastosowania.
//   4. PASEK ZAPISU POJAWIA SIE DOPIERO PRZY ZMIANIE. Przycisk zapisu nad
//      niezmienionym ekranem zaprasza do wyslania zadania, ktore niczego nie
//      zmienia - a kazde takie zadanie to wpis w dzienniku wydarzenia.
//   5. ZAPIS WYSYLA DOKLADNIE JEDNO POLE. Ekran uprawnien nie ma prawa
//      nadpisac tytulu, adresu ani dat wydarzenia.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Listy grup - `EventGroupsPanel` ma wlasny
// plik i jest tu ATRAPA; dowodzimy, ze organizm montuje ja dla TEGO wydarzenia.
// (2) Warstwy danych i kluczy pamieci podrecznej. (3) Slownika odmow bazy.
// (4) Zawezenia trybu goscia do zbioru bazy (`asEventGuestMode`) - funkcja jest
// tu PRAWDZIWA, bo dowodzimy jej wyniku na ekranie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { radixSwitchStub } from "@/test/reactStubs";
import { axeViolations, summarize } from "@/test/axe";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";

interface Wynik {
  onSuccess?: (value: string) => void;
  onError?: (error: Error) => void;
}

const h = vi.hoisted(() => ({
  /** Ladunki wyslane do `admin_event_general_save`. */
  payloads: [] as Record<string, string | string[]>[],
  saveFails: null as string | null,
  savePending: false,
  /** Wydarzenia, dla ktorych zamontowano liste grup. */
  listaGrup: [] as string[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-terms", () => ({ ensureTermsI18n: () => undefined }));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

vi.mock("@/lib/events/adminEventStudioErrors", () => ({
  adminEventStudioErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Lista grup jest osobnym organizmem z wlasnym plikiem testowym. Tutaj liczy
// sie WYLACZNIE to, ze organizm montuje ja dla TEGO wydarzenia - lista grup
// cudzego wydarzenia byla by wyciekiem uprawnien na ekran.
vi.mock("@/components/admin/events/organisms/EventGroupsPanel", () => ({
  EventGroupsPanel: ({ eventId }: { eventId: string }) => {
    h.listaGrup.push(eventId);
    return <div data-testid="lista-grup" />;
  },
}));

vi.mock("@/lib/events/useAdminEventDetail", () => ({
  useSaveEventGeneral: () => ({
    isPending: h.savePending,
    mutate: (payload: Record<string, string | string[]>, res: Wynik) => {
      h.payloads.push(payload);
      if (h.saveFails !== null) res.onError?.(new Error(h.saveFails));
      else res.onSuccess?.("event-1");
    },
  }),
}));

const { EventGroupsPermissionsPanel } =
  await import("@/components/admin/events/organisms/EventGroupsPermissionsPanel");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const P = "adminEvents.studio.groupsPage.";

/**
 * Wiersz studia - pelna sygnatura `admin_event_detail`. Ten ekran czyta z niej
 * trzy kolumny (`id`, `guest_mode`, `chatham_house`), reszta jest wypelniona
 * wartosciami pustymi, zeby ksztalt zgadzal sie z typem: atrapa wezsza od
 * sygnatury przestanie sie kompilowac przy pierwszej nowej kolumnie i to jest
 * ZALETA, nie koszt.
 */
function detailRow(overrides: Partial<AdminEventDetailRow> = {}): AdminEventDetailRow {
  return {
    branding: {},
    cancelled_at: "",
    capacity: 0,
    chatham_house: false,
    city: "Warszawa",
    country: "Polska",
    cover_url: "",
    created_at: "",
    description_en: "",
    description_pl: "",
    early_rsvp_rank: 0,
    ends_at: "2026-09-01T15:00:00.000Z",
    event_type_id: "",
    external_registration_url: "",
    features: {},
    format: "onsite",
    guest_mode: "teaser",
    has_recording: false,
    has_stream: false,
    home_design: "standard",
    id: EVENT_ID,
    join_url: "",
    kind: "in_person",
    languages: ["pl", "en"],
    location: "",
    min_tier_rank: 0,
    pages_display_mode: "list",
    postal_code: "",
    published_at: "",
    recording_url: "",
    region: "",
    registration_flow: "direct",
    registration_mode: "internal",
    root_page_id: "root",
    rsvp_opens_at: "",
    slug: "kongres",
    social_hashtag: "",
    starts_at: "2026-09-01T09:00:00.000Z",
    status: "published",
    street_address: "",
    support_email: "",
    ticket_currency: "PLN",
    ticket_price_cents: 0,
    timezone: "Europe/Warsaw",
    title_en: "Congress",
    title_pl: "Kongres",
    type_accent_color: "",
    type_icon: "",
    type_key: "in_person",
    type_name_en: "",
    type_name_pl: "",
    updated_at: "",
    video_header_id: "",
    video_header_platform: "youtube",
    visibility: "public",
    ...overrides,
  };
}

function renderuj(overrides: Partial<AdminEventDetailRow> = {}) {
  return render(<EventGroupsPermissionsPanel row={detailRow(overrides)} />);
}

/** Przelacznik widocznosci publicznej - jedyny, ktory ma dostepna nazwe. */
function przelacznik(): HTMLElement {
  return screen.getByLabelText(`${P}guestMode`);
}

/**
 * Karta wariantu widocznosci dla gosci - po identyfikatorze pola wyboru.
 *
 * Etykieta karty niesie ETYKIETE I OPIS w jednym `<label>`, wiec dostepna
 * nazwa pola to sklejka obu zdan. Identyfikator (`event-guest-<wariant>`) jest
 * jawnym kontraktem komponentu i nie zmienia sie razem z copy.
 */
function karta(mode: "teaser" | "full"): HTMLInputElement {
  const input = document.getElementById(`event-guest-${mode}`);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`brak karty wariantu „${mode}” na ekranie`);
  }
  return input;
}

/** Czy karta wariantu jest w ogole na ekranie. */
function kartaIstnieje(mode: "teaser" | "full" | "hidden"): boolean {
  return document.getElementById(`event-guest-${mode}`) !== null;
}

function zapisz(): void {
  fireEvent.click(screen.getByText("adminEvents.studio.actions.save"));
}

beforeEach(() => {
  h.payloads = [];
  h.saveFails = null;
  h.savePending = false;
  h.listaGrup = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("lista grup wydarzenia stoi na tym ekranie", () => {
  // LISTA GRUP CUDZEGO WYDARZENIA BYLABY WYCIEKIEM UPRAWNIEN NA EKRAN.
  it("organizm montuje liste grup dla TEGO wydarzenia", () => {
    renderuj();
    expect(h.listaGrup).toEqual([EVENT_ID]);
    expect(screen.getByTestId("lista-grup")).toBeTruthy();
  });
});

describe("widocznosc publiczna - para „wylaczona / wlaczona”", () => {
  // WYDARZENIE UKRYTE NIE MA „ILE POKAZAC". Karty wariantow w tym stanie
  // obiecywalyby wybor, ktory niczego nie zmienia.
  it("przy wydarzeniu ukrytym NIE MA kart wariantow", () => {
    renderuj({ guest_mode: "hidden" });
    expect((przelacznik() as HTMLInputElement).checked).toBe(false);
    expect(kartaIstnieje("teaser")).toBe(false);
    expect(kartaIstnieje("full")).toBe(false);
  });

  it("przy wydarzeniu widocznym karty wariantow SA", () => {
    renderuj({ guest_mode: "teaser" });
    expect((przelacznik() as HTMLInputElement).checked).toBe(true);
    expect(karta("teaser")).toBeTruthy();
    expect(karta("full")).toBeTruthy();
  });

  // WARIANT „UKRYTE" NIE STOI WSROD KART: jest przelacznikiem powyzej.
  // Powtorzony na liscie dawalby dwa miejsca na te sama decyzje, ktore mozna
  // ustawic sprzecznie.
  it("„ukryte” nie jest jedna z kart do wyboru", () => {
    renderuj({ guest_mode: "full" });
    expect(kartaIstnieje("hidden")).toBe(false);
  });

  it("wlaczenie widocznosci wraca na wariant najwezszy z widocznych", () => {
    renderuj({ guest_mode: "hidden" });
    fireEvent.click(przelacznik());
    expect(karta("teaser").checked).toBe(true);
    zapisz();
    expect(h.payloads).toEqual([{ id: EVENT_ID, guest_mode: "teaser" }]);
  });

  it("wylaczenie widocznosci wysyla wariant ukryty", () => {
    renderuj({ guest_mode: "full" });
    fireEvent.click(przelacznik());
    zapisz();
    expect(h.payloads).toEqual([{ id: EVENT_ID, guest_mode: "hidden" }]);
  });

  it("wybor szerszego wariantu jedzie do zapisu", () => {
    renderuj({ guest_mode: "teaser" });
    fireEvent.click(karta("full"));
    zapisz();
    expect(h.payloads).toEqual([{ id: EVENT_ID, guest_mode: "full" }]);
  });

  // WARTOSC SPOZA ZBIORU BAZY degraduje do wariantu domyslnego, zamiast
  // zostawiac ekran w stanie, ktorego zaden przycisk nie opisuje.
  it("tryb spoza zbioru bazy czyta sie jak zapowiedz, a nie jak stan pusty", () => {
    renderuj({ guest_mode: "wszystko" });
    expect((przelacznik() as HTMLInputElement).checked).toBe(true);
    expect(karta("teaser").checked).toBe(true);
  });
});

describe("zasada Chatham House - para „wlaczona / wylaczona”", () => {
  // CHATHAM HOUSE WYGRYWA Z TRYBEM GOSCIA: lista uczestnikow i nagranie nie
  // moga trafic do trybu gosci, a regule egzekwuje baza. Ekran musi o tym
  // powiedziec, zanim organizator ustawi wariant, ktory i tak nie zadziala.
  it("przy wlaczonej zasadzie ekran ostrzega wprost", () => {
    renderuj({ chatham_house: true });
    expect(screen.getByText(`${P}chathamWarning`)).toBeTruthy();
  });

  it("przy wylaczonej zasadzie ostrzezenia NIE MA", () => {
    renderuj({ chatham_house: false });
    expect(screen.queryByText(`${P}chathamWarning`)).toBeNull();
  });

  // OSTRZEZENIE DOTYCZY WYDARZENIA, NIE TRYBU: przy wydarzeniu ukrytym
  // zasada nadal obowiazuje, wiec komunikat zostaje.
  it("ostrzezenie zostaje takze przy wydarzeniu ukrytym", () => {
    renderuj({ chatham_house: true, guest_mode: "hidden" });
    expect(screen.getByText(`${P}chathamWarning`)).toBeTruthy();
  });
});

describe("pasek zapisu - para „nie ma czego zapisac / jest zmiana”", () => {
  // PRZYCISK ZAPISU NAD NIEZMIENIONYM EKRANEM zaprasza do wyslania zadania,
  // ktore niczego nie zmienia - a kazde takie zadanie zostawia slad w
  // dzienniku wydarzenia.
  it("bez zmiany paska zapisu NIE MA", () => {
    renderuj({ guest_mode: "teaser" });
    expect(screen.queryByText("adminEvents.studio.actions.save")).toBeNull();
  });

  it("po zmianie pasek zapisu sie pojawia", () => {
    renderuj({ guest_mode: "teaser" });
    fireEvent.click(karta("full"));
    expect(screen.getByText("adminEvents.studio.actions.save")).toBeTruthy();
  });

  it("porzucenie zmiany wraca do stanu zapisanego i chowa pasek", () => {
    renderuj({ guest_mode: "teaser" });
    fireEvent.click(karta("full"));
    fireEvent.click(screen.getByText("adminEvents.studio.actions.discard"));
    expect(karta("teaser").checked).toBe(true);
    expect(screen.queryByText("adminEvents.studio.actions.save")).toBeNull();
    expect(h.payloads).toEqual([]);
  });

  // POWROT DO WARTOSCI ZAPISANEJ TO BRAK ZMIANY. Pasek, ktory by zostal,
  // proponowalby zapis stanu identycznego z bazowym.
  it("powrot recznie do wariantu zapisanego chowa pasek", () => {
    renderuj({ guest_mode: "teaser" });
    fireEvent.click(karta("full"));
    fireEvent.click(karta("teaser"));
    expect(screen.queryByText("adminEvents.studio.actions.save")).toBeNull();
  });
});

describe("zapis trybu goscia", () => {
  // EKRAN UPRAWNIEN NIE MA PRAWA NADPISAC TYTULU, ADRESU ANI DAT. Ladunek
  // niesie identyfikator i JEDNO pole - asercja na pelnym obiekcie, bo to jest
  // kontrakt z funkcja zapisu.
  it("ladunek niesie identyfikator i DOKLADNIE jedno pole", () => {
    renderuj({ guest_mode: "teaser" });
    fireEvent.click(karta("full"));
    zapisz();
    expect(h.payloads).toEqual([{ id: EVENT_ID, guest_mode: "full" }]);
  });

  it("udany zapis mowi o tym wprost", () => {
    renderuj({ guest_mode: "teaser" });
    fireEvent.click(karta("full"));
    zapisz();
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.studio.toasts.visibilitySaved");
    expect(h.toastError).not.toHaveBeenCalled();
  });

  // ODMOWA NIE MOZE UDAWAC SUKCESU. Organizator, ktory zobaczy potwierdzenie,
  // odchodzi od ekranu w przekonaniu, ze wydarzenie jest juz publiczne.
  it("odmowa bazy dochodzi zdaniem i nie mowi o sukcesie", () => {
    h.saveFails = "forbidden: editor role required";
    renderuj({ guest_mode: "teaser" });
    fireEvent.click(karta("full"));
    zapisz();
    expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: editor role required");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  // ODMOWA ZOSTAWIA ZMIANE NA EKRANIE. Skasowanie wyboru po odmowie kazaloby
  // organizatorowi zgadywac, co wlasciwie probowal ustawic.
  it("odmowa zostawia wybrany wariant i pasek zapisu na ekranie", () => {
    h.saveFails = "forbidden: editor role required";
    renderuj({ guest_mode: "teaser" });
    fireEvent.click(karta("full"));
    zapisz();
    expect(karta("full").checked).toBe(true);
    expect(screen.getByText("adminEvents.studio.actions.save")).toBeTruthy();
  });

  it("trwajacy zapis gasi przycisk i drugie klikniecie nic nie wysyla", () => {
    h.savePending = true;
    renderuj({ guest_mode: "teaser" });
    fireEvent.click(karta("full"));
    const przycisk = screen.getByText("adminEvents.studio.actions.save").closest("button");
    expect(przycisk?.hasAttribute("disabled")).toBe(true);
    fireEvent.click(przycisk as HTMLElement);
    expect(h.payloads).toEqual([]);
  });
});

describe("dostepnosc", () => {
  it("ekran z widocznym wydarzeniem nie ma naruszen dostepnosci", async () => {
    const { container } = renderuj({ guest_mode: "teaser", chatham_house: true });
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("ekran z wydarzeniem ukrytym nie ma naruszen dostepnosci", async () => {
    const { container } = renderuj({ guest_mode: "hidden" });
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("ekran z widocznym paskiem zapisu nie ma naruszen dostepnosci", async () => {
    const { container } = renderuj({ guest_mode: "teaser" });
    fireEvent.click(karta("full"));
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
