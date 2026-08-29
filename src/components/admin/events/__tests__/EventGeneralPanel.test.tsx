// Organizm „Informacje ogólne" wydarzenia - SKLEJENIE wiersza RPC, reguł
// szkicu, osiemnastu pól i paska zapisu.
//
// CO TEN PLIK DOWODZI.
//   1. NIEKOMPLETNY FORMULARZ NIE DOTYKA WARSTWY ZAPISU. Każde pole wymagane
//      jest sprawdzane OSOBNO, a asercja idzie na atrapie mutacji, nie na
//      wyglądzie ekranu: „czerwone zdanie się pokazało" i „nic nie poszło do
//      bazy" to dwa różne fakty, a tylko drugi chroni wydarzenie.
//   2. ŁADUNEK JEST TYM, CO ZOBACZY BAZA. Białe znaki obcięte, slug i adres
//      wsparcia małymi literami, hashtag bez krzyżyka, platforma wideo pusta
//      przy braku materiału, języki znormalizowane. Tego nie widać na ekranie,
//      więc asercje idą na argumentach mutacji.
//   3. STREFA CZASOWA JEST KOMPLETNA. Pełny katalog `Intl` NIE ZAWIERA `UTC`
//      ani nowoczesnej nazwy Kijowa, więc droplista, która brałaby wyłącznie
//      katalog, nie pozwoliłaby wybrać strefy, w której organizacja realnie
//      pracuje. Osobno: strefa JUŻ ZAPISANA, a spoza katalogu, nie może zniknąć
//      z pola - inaczej pierwszy zapis ustawień po cichu przestawia strefę
//      wydarzenia na cudzą.
//   4. TRWAJĄCY ZAPIS BLOKUJE PRZYCISK. Podwójne kliknięcie ma wysłać JEDEN
//      zapis; odmowa serwera zostawia całą pracę na ekranie.
//   5. ADRES PUBLICZNY JEST POD KŁÓDKĄ i wraca pod nią po udanym zapisie -
//      zmiana slugu psuje linki w wysłanych e-mailach.
//   6. PODGLĄD NA ŻYWO DOSTAJE SZKIC, nie odpowiedź z bazy.
//   7. OSTRZEŻENIA NIE BLOKUJĄ ZAPISU - brak adresu i brak okładki zmieniają
//      to, co zobaczy uczestnik, ale nie są powodem do zatrzymania redaktora.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Tabeli reguł szkicu
// (`validateEventGeneralDraft`, `eventGeneralPayload`, `eventGeneralWarnings`,
// `parseVideoId`) - jest w `lib/events/__tests__/eventGeneralDraft.test.ts`;
// tutaj dowodzimy, że organizm ich UŻYWA i że skutek widać na ekranie.
// (2) Katalogu stref (`lib/events/__tests__/timeZoneOptions.test.ts`) - tutaj
// sprawdzamy WYŁĄCZNIE to, co panel realnie oferuje w polu. (3) Mapowania
// odmów bazy (`adminEventStudioErrors`). (4) Wyboru okładki i kalendarza -
// mają własne komponenty; pod happy-dom nie ma dla nich pełnego API wskaźnika,
// więc stoją tu atrapy o tym samym kontrakcie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import { eventLanguageLabel } from "@/lib/events/eventLanguages";

const h = vi.hoisted(() => ({
  /** Ładunki wysłane do `admin_event_general_save`. */
  payloads: [] as Record<string, string | string[]>[],
  /** Domknięcie kończące trwający zapis; ustawia je atrapa mutacji. */
  settle: null as ((outcome: "ok" | "fail") => void) | null,
  /** Kolejne szkice, które panel wypchnął do doku podglądu. */
  preview: [] as Record<string, unknown>[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  writeText: vi.fn(() => Promise.resolve()),
  /** Język interfejsu panelu - sterowany z testu, jak realna instancja i18n. */
  lang: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

// Mapowanie odmów bazy ma własny plik testowy, a jego prawdziwa wersja ciągnie
// pełną instancję i18n. Tutaj liczy się wyłącznie to, że panel pokazuje TO,
// co mapowanie zwróciło.
vi.mock("@/lib/events/adminEventStudioErrors", () => ({
  adminEventStudioErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Dok podglądu nie renderuje niczego w tym drzewie - przedmiotem dowodu jest
// to, CO panel do niego wysyła.
vi.mock("@/components/admin/events/studio/EventStudioPreviewContext", () => ({
  useSyncEventPreview: (partial: Record<string, unknown>) => {
    h.preview.push(partial);
  },
}));

// Droplisty stoją na Radix Select (przez `FormSelect`), a ten pod happy-dom nie
// otwiera listy bez pełnego API wskaźnika. Atrapa jest natywna i ETYKIETOWANA,
// bo przedmiotem dowodu jest to, KTÓRE wartości panel oferuje i która dojedzie
// do ładunku - nie to, jak wygląda popup.
vi.mock("@/components/atoms/FormSelect", () => {
  const FormSelect = ({
    id,
    value,
    options,
    onValueChange,
    disabled,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (value: string) => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
  return { FormSelect, default: FormSelect };
});

// Kalendarz jest popoverem Radiksa - atrapa zostawia z niego KONTRAKT: napis
// ISO w środku i pusty napis jako „nie podano".
vi.mock("@/components/ui/datetime-picker", () => ({
  DateTimePicker: ({
    id,
    value,
    onChange,
    disabled,
  }: {
    id?: string;
    value: string | null;
    onChange: (iso: string | null) => void;
    disabled?: boolean;
  }) => (
    <input
      id={id}
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    />
  ),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...reszta
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
    [key: string]: unknown;
  }) => (
    <input
      {...reszta}
      type="checkbox"
      checked={checked ?? false}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

// Wybór okładki sięga do magazynu plików i do tenanta - pod happy-dom nie ma
// ani jednego, ani drugiego. Atrapa daje obie drogi: ustawienie adresu
// i ZDJĘCIE okładki, bo dopiero to drugie odsłania regułę „nagłówek wideo
// wymaga okładki".
vi.mock("@/components/admin/CoverImagePicker", () => ({
  CoverImagePicker: ({
    label,
    value,
    onChange,
    folder,
  }: {
    label?: string;
    value: string;
    onChange: (next: string) => void;
    folder?: string;
  }) => (
    <div data-testid="okladka" data-folder={folder} data-value={value}>
      <span>{label}</span>
      <button type="button" onClick={() => onChange("https://cdn.test/nowa.png")}>
        atrapa: wybierz okładkę
      </button>
      <button type="button" onClick={() => onChange("")}>
        atrapa: zdejmij okładkę
      </button>
    </div>
  ),
}));

// Atrapa warstwy zapisu trzyma STAN OCZEKIWANIA w Reakcie, a nie w zmiennej
// modułu: tylko wtedy pierwsze kliknięcie realnie przerysowuje pasek zapisu
// i drugie kliknięcie ma o co się odbić.
vi.mock("@/lib/events/useAdminEventDetail", async () => {
  const { useState } = await import("react");
  return {
    useSaveEventGeneral: () => {
      const [pending, setPending] = useState(false);
      return {
        isPending: pending,
        mutate: (
          payload: Record<string, string | string[]>,
          opts?: { onSuccess?: (value: string) => void; onError?: (error: Error) => void },
        ) => {
          h.payloads.push(payload);
          setPending(true);
          h.settle = (outcome) => {
            setPending(false);
            if (outcome === "ok") opts?.onSuccess?.("event-1");
            else opts?.onError?.(new Error("slug_taken: another event already uses this address"));
          };
        },
      };
    },
  };
});

const { EventGeneralPanel } = await import("@/components/admin/events/organisms/EventGeneralPanel");

const EVENT_ID = "3f1a0c8e-0000-4000-8000-000000000042";
const G = "adminEvents.studio.general.";

/**
 * Wiersz studia - 49 kolumn sygnatury `admin_event_detail`, z których ten ekran
 * czyta dwadzieścia. Reszta jest wypełniona wartościami pustymi, żeby kształt
 * zgadzał się z typem: atrapa węższa od sygnatury przestałaby się kompilować
 * przy pierwszej nowej kolumnie i to jest ZALETA, nie koszt.
 */
function detailRow(overrides: Partial<AdminEventDetailRow> = {}): AdminEventDetailRow {
  return {
    branding: {},
    cancelled_at: "",
    capacity: 0,
    chatham_house: false,
    city: "Warszawa",
    country: "Polska",
    cover_url: "https://cdn.test/okladka.png",
    created_at: "",
    description_en: "Expert breakfast on energy.",
    description_pl: "Śniadanie eksperckie o energetyce.",
    early_rsvp_rank: 0,
    ends_at: "2026-09-01T15:00:00.000Z",
    event_type_id: "",
    external_registration_url: "",
    features: {},
    format: "onsite",
    guest_mode: "full",
    has_recording: false,
    has_stream: false,
    home_design: "standard",
    id: EVENT_ID,
    join_url: "",
    kind: "in_person",
    languages: ["pl", "en"],
    location: "Centrum Konferencyjne",
    min_tier_rank: 0,
    pages_display_mode: "list",
    postal_code: "00-001",
    published_at: "",
    recording_url: "",
    region: "mazowieckie",
    registration_flow: "direct",
    registration_mode: "internal",
    root_page_id: "root",
    rsvp_opens_at: "",
    slug: "kongres-energetyczny",
    social_hashtag: "NES2026",
    starts_at: "2026-09-01T09:00:00.000Z",
    status: "published",
    street_address: "Aleje Jerozolimskie 1",
    support_email: "kontakt@nes.eu",
    ticket_currency: "PLN",
    ticket_price_cents: 0,
    timezone: "Europe/Warsaw",
    title_en: "Energy Congress",
    title_pl: "Kongres Energetyczny",
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

function panel(overrides: Partial<AdminEventDetailRow> = {}) {
  return render(<EventGeneralPanel row={detailRow(overrides)} />);
}

/** Pole formularza po kluczu etykiety - dokładnie tak, jak znajduje je czytnik. */
function pole(labelKey: string): HTMLInputElement | HTMLTextAreaElement {
  const found = screen.getByLabelText(`${G}${labelKey}`);
  if (!(found instanceof HTMLInputElement) && !(found instanceof HTMLTextAreaElement)) {
    throw new Error(`test: ${labelKey} nie jest polem tekstowym`);
  }
  return found;
}

function wpisz(labelKey: string, value: string): void {
  fireEvent.change(pole(labelKey), { target: { value } });
}

function droplista(labelKey: string): HTMLSelectElement {
  const found = screen.getByLabelText(`${G}${labelKey}`);
  if (!(found instanceof HTMLSelectElement))
    throw new Error(`test: ${labelKey} nie jest droplistą`);
  return found;
}

/** Pole wyboru języka treści - etykietą jest NAZWA języka, nie jego kod. */
function jezyk(code: string): HTMLElement {
  return screen.getByLabelText(eventLanguageLabel(code, "pl"));
}

function przyciskZapisu(): HTMLButtonElement {
  const found = screen.getByRole("button", { name: "adminEvents.studio.actions.save" });
  if (!(found instanceof HTMLButtonElement)) throw new Error("test: zapis nie jest przyciskiem");
  return found;
}

function zapiszKliknij(): void {
  fireEvent.click(przyciskZapisu());
}

/** Widoczne powody odrzucenia - tyle, ile ich jest, i pod jakim kluczem. */
function komunikaty(): string[] {
  return screen.queryAllByRole("alert").map((node) => node.textContent ?? "");
}

function ostatniLadunek(): Record<string, string | string[]> {
  const last = h.payloads.at(-1);
  if (last === undefined) throw new Error("test: warstwa zapisu nie dostała nic");
  return last;
}

beforeEach(() => {
  cleanup();
  h.lang = "pl";
  h.payloads = [];
  h.settle = null;
  h.preview = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: h.writeText },
  });
});

describe("EventGeneralPanel - wiersz z bazy wchodzi do pól", () => {
  it("każde pole pokazuje SWOJĄ wartość z wiersza", () => {
    panel();

    expect(pole("nameLabel").value).toBe("Kongres Energetyczny");
    expect(pole("urlLabel").value).toBe("kongres-energetyczny");
    expect(pole("venueLabel").value).toBe("Centrum Konferencyjne");
    expect(pole("streetLabel").value).toBe("Aleje Jerozolimskie 1");
    expect(pole("cityLabel").value).toBe("Warszawa");
    expect(pole("regionLabel").value).toBe("mazowieckie");
    expect(pole("postalLabel").value).toBe("00-001");
    expect(pole("countryLabel").value).toBe("Polska");
    expect(pole("supportLabel").value).toBe("kontakt@nes.eu");
    expect(pole("informationLabel").value).toBe("Śniadanie eksperckie o energetyce.");
    expect(droplista("timeZoneLabel").value).toBe("Europe/Warsaw");
    // Krzyżyk jest PREZENTACJĄ - w bazie hashtag stoi bez niego.
    expect(pole("hashtagLabel").value).toBe("NES2026");
  });

  it("format z wiersza jest zaznaczony, a pozostałe karty NIE są", () => {
    panel();
    expect(screen.getByLabelText("adminEvents.formats.onsite")).toBeChecked();
    expect(screen.getByLabelText("adminEvents.formats.online")).not.toBeChecked();
    expect(screen.getByLabelText("adminEvents.formats.hybrid")).not.toBeChecked();
  });

  it("języki z wiersza są zaznaczone, a niewybrany język NIE jest", () => {
    panel();
    expect(jezyk("pl")).toBeChecked();
    expect(jezyk("en")).toBeChecked();
    expect(jezyk("de")).not.toBeChecked();
  });

  it("PASEK ZAPISU JEST NIEWIDOCZNY, dopóki nikt nic nie zmienił", () => {
    // Pasek stojący zawsze uczy, żeby go nie zauważać - a wtedy nie zauważa się
    // go także wtedy, gdy naprawdę jest coś do zapisania.
    panel();
    expect(screen.queryByRole("button", { name: "adminEvents.studio.actions.save" })).toBeNull();
    wpisz("nameLabel", "Kongres Energetyczny 2026");
    expect(przyciskZapisu()).toBeTruthy();
  });

  it("okładka jedzie z katalogu wydarzeń i pokazuje adres z wiersza", () => {
    panel();
    const picker = screen.getByTestId("okladka");
    expect(picker.getAttribute("data-folder")).toBe("events");
    expect(picker.getAttribute("data-value")).toBe("https://cdn.test/okladka.png");
  });
});

describe("EventGeneralPanel - przełącznik języka treści", () => {
  it("przełącznik pokazuje wersję ANGIELSKĄ tytułu i opisu naraz", () => {
    // Jeden przełącznik na dwie sekcje: przełączenie przy tytule ma przestawić
    // także opis, inaczej redaktor pisze opis angielski pod polskim tytułem
    // i nie widzi, że jest w innym języku.
    panel();
    fireEvent.click(screen.getAllByRole("button", { name: "en" })[0]);

    expect(pole("nameLabel").value).toBe("Energy Congress");
    expect(pole("informationLabel").value).toBe("Expert breakfast on energy.");
  });

  it("wpisanie przy włączonym EN zmienia wersję angielską, a polskiej NIE RUSZA", () => {
    panel();
    fireEvent.click(screen.getAllByRole("button", { name: "en" })[0]);
    wpisz("nameLabel", "Energy Congress 2026");
    wpisz("informationLabel", "Updated English description.");
    zapiszKliknij();

    expect(ostatniLadunek().title_en).toBe("Energy Congress 2026");
    expect(ostatniLadunek().title_pl).toBe("Kongres Energetyczny");
    expect(ostatniLadunek().description_en).toBe("Updated English description.");
    expect(ostatniLadunek().description_pl).toBe("Śniadanie eksperckie o energetyce.");
  });

  it("wpisanie przy włączonym PL zmienia wersję polską, a angielskiej NIE RUSZA", () => {
    // Kontrapunkt dla testu wyżej: bez niego „opis zapisuje się pod językiem
    // przełącznika" przechodziłoby na panelu, który zawsze pisze do wersji
    // angielskiej.
    panel();
    wpisz("informationLabel", "Nowy opis polski.");
    zapiszKliknij();

    expect(ostatniLadunek().description_pl).toBe("Nowy opis polski.");
    expect(ostatniLadunek().description_en).toBe("Expert breakfast on energy.");
  });

  it("redaktor pracujący po ANGIELSKU widzi domyślnie treść angielską", () => {
    // Przełącznik startuje w języku INTERFEJSU: panel otwarty po angielsku
    // z polskim tytułem w polu wygląda tak, jakby tłumaczenia nie było wcale.
    h.lang = "en";
    panel();

    expect(pole("nameLabel").value).toBe("Energy Congress");
    expect(pole("informationLabel").value).toBe("Expert breakfast on energy.");
  });

  it("powrót na PL wraca do treści polskiej, a nie do pustego pola", () => {
    panel();
    const przelacznik = () => screen.getAllByRole("button", { name: /^(pl|en)$/ });
    fireEvent.click(screen.getAllByRole("button", { name: "en" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "pl" })[0]);

    expect(pole("nameLabel").value).toBe("Kongres Energetyczny");
    // Stan przełącznika jest ogłoszony czytnikowi ekranu, nie tylko kolorem.
    const wcisniete = przelacznik().filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(wcisniete.map((b) => b.textContent)).toEqual(["pl", "pl"]);
  });
});

describe("EventGeneralPanel - walidacja: każde pole osobno", () => {
  it("PUSTY tytuł polski nie dociera do warstwy zapisu", () => {
    panel();
    wpisz("nameLabel", "   ");
    zapiszKliknij();

    expect(h.payloads).toHaveLength(0);
    expect(komunikaty()).toContain("adminEvents.general.errors.titleRequired");
  });

  it("PUSTY tytuł angielski zatrzymuje zapis tak samo jak polski", () => {
    // Bez tego przypadku „tytuł wymagany" przechodziłoby na panelu, który pyta
    // wyłącznie o polski - a wydarzenie bez tytułu angielskiego ma pustą kartę
    // w serwisie anglojęzycznym.
    panel();
    fireEvent.click(screen.getAllByRole("button", { name: "en" })[0]);
    wpisz("nameLabel", "");
    zapiszKliknij();

    expect(h.payloads).toHaveLength(0);
    expect(komunikaty()).toContain("adminEvents.general.errors.titleRequired");
  });

  it("adres publiczny niezgodny ze wzorcem nie dociera do warstwy zapisu", () => {
    panel();
    fireEvent.click(screen.getByLabelText(`${G}editUrl`));
    wpisz("urlLabel", "ala ma kota");
    zapiszKliknij();

    expect(h.payloads).toHaveLength(0);
    expect(komunikaty()).toContain("adminEvents.general.errors.slugInvalid");
    // Podpowiedź ustępuje miejsca komunikatowi - dwa zdania pod jednym polem
    // każą zgadywać, które jest aktualne.
    expect(screen.queryByText(`${G}urlHint`)).toBeNull();
  });

  it("BRAK terminu rozpoczęcia nie dociera do warstwy zapisu", () => {
    panel();
    wpisz("beginsLabel", "");
    zapiszKliknij();

    expect(h.payloads).toHaveLength(0);
    expect(komunikaty()).toContain("adminEvents.general.errors.startsAtRequired");
  });

  it("koniec PRZED początkiem nie dociera do warstwy zapisu", () => {
    panel();
    wpisz("endsLabel", "2026-09-01T08:00:00.000Z");
    zapiszKliknij();

    expect(h.payloads).toHaveLength(0);
    expect(komunikaty()).toContain("adminEvents.general.errors.endsBeforeStart");
  });

  it("adres wsparcia bez małpy nie dociera do warstwy zapisu", () => {
    panel();
    wpisz("supportLabel", "kontakt.nes.eu");
    zapiszKliknij();

    expect(h.payloads).toHaveLength(0);
    expect(komunikaty()).toContain("adminEvents.general.errors.supportEmailInvalid");
  });

  it("hashtag ze spacją nie dociera do warstwy zapisu", () => {
    panel();
    wpisz("hashtagLabel", "NES 2026");
    zapiszKliknij();

    expect(h.payloads).toHaveLength(0);
    expect(komunikaty()).toContain("adminEvents.general.errors.hashtagInvalid");
  });

  it("nagłówek wideo BEZ okładki nie dociera do warstwy zapisu", () => {
    // Ten sam warunek stoi w bazie (`events_video_header_requires_cover`):
    // miniatura w katalogu i w karcie społecznościowej nadal bierze się
    // z obrazu, więc samo wideo jej nie zastępuje.
    panel();
    wpisz("videoIdLabel", "dQw4w9WgXcQ");
    fireEvent.click(screen.getByText("atrapa: zdejmij okładkę"));
    zapiszKliknij();

    expect(h.payloads).toHaveLength(0);
    expect(komunikaty()).toContain("adminEvents.general.errors.coverRequiredForVideo");
  });

  it("wydarzenie BEZ ani jednego języka nie dociera do warstwy zapisu", () => {
    panel();
    fireEvent.click(jezyk("pl"));
    fireEvent.click(jezyk("en"));
    zapiszKliknij();

    expect(h.payloads).toHaveLength(0);
    expect(komunikaty()).toContain("adminEvents.general.errors.languagesRequired");
  });

  it("KOMUNIKATY MILCZĄ do pierwszej próby zapisu", () => {
    // Czerwone zdanie nad polem, którego redaktor jeszcze nie tknął, czyta się
    // jak awaria ekranu, a nie jak podpowiedź.
    panel();
    wpisz("nameLabel", "");
    wpisz("supportLabel", "bez-malpy");
    expect(komunikaty()).toHaveLength(0);

    zapiszKliknij();
    expect(komunikaty().length).toBeGreaterThan(0);
  });

  it("po nieudanej próbie przycisk jest ZABLOKOWANY, a poprawka go odblokowuje", () => {
    panel();
    // Druga, POPRAWNA zmiana zostaje na ekranie po naprawieniu adresu - bez
    // niej szkic zrównałby się z bazą i pasek zapisu zniknąłby w całości,
    // czyli test mierzyłby zanik paska, a nie odblokowanie przycisku.
    wpisz("cityLabel", "Gdańsk");
    wpisz("supportLabel", "bez-malpy");
    zapiszKliknij();
    expect(przyciskZapisu().disabled).toBe(true);

    // Drugie kliknięcie w zablokowany przycisk nie może przemycić zapisu.
    zapiszKliknij();
    expect(h.payloads).toHaveLength(0);

    wpisz("supportLabel", "kontakt@nes.eu");
    expect(przyciskZapisu().disabled).toBe(false);
    zapiszKliknij();
    expect(h.payloads).toHaveLength(1);
    expect(ostatniLadunek().city).toBe("Gdańsk");
  });
});

describe("EventGeneralPanel - ładunek zapisu", () => {
  it("białe znaki są OBCIĘTE, a slug i adres wsparcia jadą małymi literami", () => {
    panel();
    fireEvent.click(screen.getByLabelText(`${G}editUrl`));
    wpisz("nameLabel", "  Kongres Energetyczny 2026  ");
    wpisz("urlLabel", "  Kongres-2026  ");
    wpisz("supportLabel", "  KONTAKT@NES.EU  ");
    wpisz("venueLabel", "  Centrum Praskie  ");
    zapiszKliknij();

    const ladunek = ostatniLadunek();
    expect(ladunek.id).toBe(EVENT_ID);
    expect(ladunek.title_pl).toBe("Kongres Energetyczny 2026");
    expect(ladunek.slug).toBe("kongres-2026");
    expect(ladunek.support_email).toBe("kontakt@nes.eu");
    expect(ladunek.location).toBe("Centrum Praskie");
  });

  it("PUSTE pole opcjonalne jedzie jako pusty napis, który RPC zamienia na NULL", () => {
    // `admin_event_general_save` czyta te kolumny przez `NULLIF(..., '')`, więc
    // pusty napis znaczy „nie podano". Asercja pilnuje, że panel wysyła KLUCZ
    // z pustą wartością, a nie pomija go - pominięty klucz znaczy w tym RPC
    // „nie zmieniaj", czyli stara wartość zostałaby w bazie na zawsze.
    panel();
    wpisz("endsLabel", "");
    wpisz("regionLabel", "");
    zapiszKliknij();

    const ladunek = ostatniLadunek();
    expect(Object.keys(ladunek)).toContain("ends_at");
    expect(ladunek.ends_at).toBe("");
    expect(ladunek.region).toBe("");
  });

  it("hashtag jedzie BEZ krzyżyka, choćby wkleić go z paska adresu", () => {
    panel();
    wpisz("hashtagLabel", "##NES2027");
    zapiszKliknij();
    expect(ostatniLadunek().social_hashtag).toBe("NES2027");
  });

  it("BRAK materiału wideo zeruje platformę, choć droplista pokazuje wybraną", () => {
    // Platforma bez identyfikatora jest w bazie stanem niespójnym: `events`
    // przyjęłoby „youtube" bez filmu, a strona publiczna próbowałaby osadzić
    // pusty adres.
    panel();
    wpisz("nameLabel", "Kongres Energetyczny 2026");
    zapiszKliknij();

    expect(droplista("videoPlatformLabel").value).toBe("youtube");
    expect(ostatniLadunek().video_header_platform).toBe("");
    expect(ostatniLadunek().video_header_id).toBe("");
  });

  it("WKLEJONY ADRES filmu zamienia się w sam identyfikator, a platforma jedzie z nim", () => {
    // Redaktor kopiuje adres z paska przeglądarki - to jest zachowanie, które
    // formularz ma obsłużyć, a nie karcić za nie komunikatem.
    panel();
    const wideo = pole("videoIdLabel");
    fireEvent.change(wideo, { target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
    fireEvent.blur(wideo);

    expect(pole("videoIdLabel").value).toBe("dQw4w9WgXcQ");
    zapiszKliknij();
    expect(ostatniLadunek().video_header_id).toBe("dQw4w9WgXcQ");
    expect(ostatniLadunek().video_header_platform).toBe("youtube");
  });

  it("zmiana platformy wideo jedzie do ładunku razem z identyfikatorem", () => {
    panel();
    fireEvent.change(droplista("videoPlatformLabel"), { target: { value: "vimeo" } });
    wpisz("videoIdLabel", "76979871");
    zapiszKliknij();

    expect(ostatniLadunek().video_header_platform).toBe("vimeo");
    expect(ostatniLadunek().video_header_id).toBe("76979871");
  });

  it("języki jadą ZNORMALIZOWANE i posortowane, niezależnie od kolejności klikania", () => {
    panel();
    fireEvent.click(jezyk("de"));
    fireEvent.click(jezyk("uk"));
    zapiszKliknij();
    expect(ostatniLadunek().languages).toEqual(["de", "en", "pl", "uk"]);
  });

  it("każde pole adresu zapisuje się pod SWOIM kluczem", () => {
    // Sześć pól o identycznym wyglądzie: przeklejony blok („kod pocztowy"
    // zapisujący do `country") przechodzi przez kompilator, przez recenzję
    // i przez interfejs. Wykrywa go wyłącznie wpisanie ROZRÓŻNIALNEJ wartości
    // do każdego pola osobno i asercja na ładunku.
    panel();
    wpisz("venueLabel", "Sala A");
    wpisz("streetLabel", "Nowogrodzka 2");
    wpisz("cityLabel", "Gdańsk");
    wpisz("regionLabel", "pomorskie");
    wpisz("postalLabel", "80-001");
    wpisz("countryLabel", "Polska PL");
    zapiszKliknij();

    const ladunek = ostatniLadunek();
    expect(ladunek.location).toBe("Sala A");
    expect(ladunek.street_address).toBe("Nowogrodzka 2");
    expect(ladunek.city).toBe("Gdańsk");
    expect(ladunek.region).toBe("pomorskie");
    expect(ladunek.postal_code).toBe("80-001");
    expect(ladunek.country).toBe("Polska PL");
  });

  it("zmiana formatu jedzie do ładunku jako wartość ze zbioru bazy", () => {
    panel();
    fireEvent.click(screen.getByLabelText("adminEvents.formats.hybrid"));
    zapiszKliknij();
    expect(ostatniLadunek().format).toBe("hybrid");
  });
});

describe("EventGeneralPanel - strefa czasowa", () => {
  it("droplista OFERUJE `UTC`, którego pełny katalog `Intl` nie zawiera", () => {
    // `Intl.supportedValuesOf("timeZone")` nie zna ani `UTC`, ani żadnego
    // `Etc/*`. Dopóki katalog ZASTĘPOWAŁ zbiór własny, redaktor na nowoczesnej
    // przeglądarce nie mógł wybrać UTC - mimo że strefa stoi jawnie w liście
    // stref, „w których organizacja pracuje".
    panel();
    const opcje = Array.from(droplista("timeZoneLabel").options).map((option) => option.value);

    expect(opcje).toContain("UTC");
    expect(opcje).toContain("Europe/Warsaw");
    expect(opcje).toContain("Europe/Brussels");
  });

  it("Kijów stoi pod nazwą NOWOCZESNĄ i tylko raz", () => {
    // Katalog `Intl` zna wyłącznie przestarzałe `Europe/Kiev`; odsiew idzie po
    // nazwie kanonicznej, więc obie nazwy nie mogą stanąć obok siebie.
    panel();
    const opcje = Array.from(droplista("timeZoneLabel").options).map((option) => option.value);

    expect(opcje).toContain("Europe/Kyiv");
    expect(opcje).not.toContain("Europe/Kiev");
    expect(opcje.filter((zone) => zone === "Europe/Kyiv")).toHaveLength(1);
  });

  it("strefa JUŻ ZAPISANA, a spoza katalogu, NIE ZNIKA z pola", () => {
    // Pole pokazujące pustkę dla wartości, która stoi w bazie, kończy się tym,
    // że pierwszy zapis ustawień po cichu przestawia strefę wydarzenia.
    panel({ timezone: "Etc/GMT+2" });
    const lista = droplista("timeZoneLabel");

    expect(lista.value).toBe("Etc/GMT+2");
    expect(Array.from(lista.options).map((option) => option.value)).toContain("Etc/GMT+2");
  });

  it("wybrana strefa jedzie do ładunku", () => {
    panel();
    fireEvent.change(droplista("timeZoneLabel"), { target: { value: "UTC" } });
    zapiszKliknij();
    expect(ostatniLadunek().timezone).toBe("UTC");
  });

  it("PUSTA strefa w wierszu zatrzymuje zapis, a droplista nadal ma z czego wybierać", () => {
    panel({ timezone: "" });
    wpisz("nameLabel", "Kongres Energetyczny 2026");
    zapiszKliknij();

    expect(h.payloads).toHaveLength(0);
    expect(przyciskZapisu().disabled).toBe(true);
    // Wyjście z pułapki istnieje: pełny katalog stoi w dropliście mimo pustej
    // wartości w wierszu.
    expect(Array.from(droplista("timeZoneLabel").options).length).toBeGreaterThan(8);
  });

  // ZNALEZISKO. `validateEventGeneralDraft` oddaje błąd pola `timezone`
  // (`adminEvents.general.errors.timezoneRequired`), ale panel NIGDZIE go nie
  // rysuje: `AdminFormEnumRow` w wierszu strefy (EventGeneralPanel.tsx:222-229)
  // nie ma gniazda na komunikat, a `errorFor` jest wołane dla dziewięciu innych
  // pól i ANI RAZU dla strefy. Skutek dla redaktora: wiersz z pustą strefą
  // (kolumna `events.timezone` jest tekstowa, a szkic degraduje brak wartości
  // do pustego napisu) daje ekran, na którym „Zapisz" gaśnie po kliknięciu
  // i NIC się nie dzieje - bez jednego zdania, które pole trzeba uzupełnić.
  // To ta sama klasa błędu co „awaria wygląda jak pustka": odmowa bez powodu.
  it.fails("pusta strefa POWINNA nazwać powód odmowy, a nie gasić przycisk w ciszy", () => {
    panel({ timezone: "" });
    wpisz("nameLabel", "Kongres Energetyczny 2026");
    zapiszKliknij();

    expect(komunikaty()).toContain("adminEvents.general.errors.timezoneRequired");
  });
});

describe("EventGeneralPanel - ostrzeżenia nie blokują zapisu", () => {
  it("wydarzenie stacjonarne BEZ adresu ostrzega, ale zapis PRZECHODZI", () => {
    // Blokada zmuszałaby do wpisania adresu, zanim organizator zna miejsce;
    // milczenie kosztowałoby wydarzenie stacjonarne bez adresu na stronie.
    panel({ city: "", street_address: "" });
    wpisz("nameLabel", "Kongres Energetyczny 2026");

    expect(screen.getByText("adminEvents.general.warnings.addressMissing")).toBeTruthy();
    zapiszKliknij();
    expect(h.payloads).toHaveLength(1);
  });

  it("wydarzenie ONLINE bez adresu NIE ostrzega", () => {
    // Kontrapunkt: bez niego „ostrzega o braku adresu" przechodziłoby także
    // wtedy, gdyby ostrzeżenie wisiało zawsze.
    panel({ city: "", street_address: "", format: "online" });
    expect(screen.queryByText("adminEvents.general.warnings.addressMissing")).toBeNull();
  });

  it("brak okładki ostrzega, a wybór okładki ostrzeżenie zdejmuje", () => {
    panel({ cover_url: "" });
    expect(screen.getByText("adminEvents.general.warnings.coverMissing")).toBeTruthy();

    fireEvent.click(screen.getByText("atrapa: wybierz okładkę"));
    expect(screen.queryByText("adminEvents.general.warnings.coverMissing")).toBeNull();
    zapiszKliknij();
    expect(ostatniLadunek().cover_url).toBe("https://cdn.test/nowa.png");
  });

  it("wydarzenie dłuższe niż miesiąc ostrzega o literówce w dacie", () => {
    panel();
    wpisz("endsLabel", "2026-12-01T15:00:00.000Z");
    expect(screen.getByText("adminEvents.general.warnings.veryLong")).toBeTruthy();
    zapiszKliknij();
    expect(h.payloads).toHaveLength(1);
  });
});

describe("EventGeneralPanel - adres publiczny pod kłódką", () => {
  it("pole slugu jest TYLKO DO ODCZYTU, dopóki nikt nie kliknął ołówka", () => {
    panel();
    expect(pole("urlLabel").readOnly).toBe(true);

    fireEvent.click(screen.getByLabelText(`${G}editUrl`));
    expect(pole("urlLabel").readOnly).toBe(false);
  });

  it("wpisany slug ląduje MAŁYMI literami już w polu, nie dopiero w bazie", () => {
    panel();
    fireEvent.click(screen.getByLabelText(`${G}editUrl`));
    wpisz("urlLabel", "KONGRES-2027");
    expect(pole("urlLabel").value).toBe("kongres-2027");
  });

  it("po UDANYM zapisie kłódka wraca na miejsce", () => {
    panel();
    fireEvent.click(screen.getByLabelText(`${G}editUrl`));
    wpisz("urlLabel", "kongres-2027");
    zapiszKliknij();
    act(() => h.settle?.("ok"));

    expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.studio.toasts.generalSaved");
    expect(pole("urlLabel").readOnly).toBe(true);
  });
});

describe("EventGeneralPanel - lokalizacja", () => {
  it("„Wyczyść lokalizację” czyści WSZYSTKIE sześć pól adresu naraz", () => {
    panel();
    fireEvent.click(screen.getByText(`${G}resetLocation`));

    expect(pole("venueLabel").value).toBe("");
    expect(pole("streetLabel").value).toBe("");
    expect(pole("cityLabel").value).toBe("");
    expect(pole("regionLabel").value).toBe("");
    expect(pole("postalLabel").value).toBe("");
    expect(pole("countryLabel").value).toBe("");

    zapiszKliknij();
    const ladunek = ostatniLadunek();
    expect(ladunek.location).toBe("");
    expect(ladunek.street_address).toBe("");
    expect(ladunek.city).toBe("");
    expect(ladunek.region).toBe("");
    expect(ladunek.postal_code).toBe("");
    expect(ladunek.country).toBe("");
    // Reszta wydarzenia jedzie razem ze zmianą - inaczej tytuł by zniknął.
    expect(ladunek.title_pl).toBe("Kongres Energetyczny");
  });
});

describe("EventGeneralPanel - zapis", () => {
  it("TRWAJĄCY zapis nazywa swój stan i blokuje przycisk - podwójne kliknięcie wysyła RAZ", () => {
    panel();
    wpisz("nameLabel", "Kongres Energetyczny 2026");
    zapiszKliknij();

    expect(screen.getByText("adminEvents.studio.actions.saving")).toBeTruthy();
    expect(przyciskZapisu().disabled).toBe(true);
    zapiszKliknij();
    expect(h.payloads).toHaveLength(1);
  });

  it("ODMOWA serwera zostawia całą pracę na ekranie i nazywa powód", () => {
    // Formularz wyczyszczony po odmowie znaczy, że redaktor wpisuje osiemnaście
    // pól po raz drugi - i to jest moment, w którym rezygnuje.
    panel();
    wpisz("nameLabel", "Kongres Energetyczny 2026");
    wpisz("cityLabel", "Gdańsk");
    zapiszKliknij();
    act(() => h.settle?.("fail"));

    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:slug_taken: another event already uses this address",
    );
    expect(pole("nameLabel").value).toBe("Kongres Energetyczny 2026");
    expect(pole("cityLabel").value).toBe("Gdańsk");
    // Po odmowie przycisk WRACA do gry - inaczej poprawka nie ma jak dojechać.
    expect(przyciskZapisu().disabled).toBe(false);
  });

  it("„Porzuć” przywraca wartości z bazy i chowa pasek zapisu", () => {
    panel();
    wpisz("nameLabel", "Zupełnie inna nazwa");
    wpisz("cityLabel", "Gdańsk");
    fireEvent.click(screen.getByRole("button", { name: "adminEvents.studio.actions.discard" }));

    expect(pole("nameLabel").value).toBe("Kongres Energetyczny");
    expect(pole("cityLabel").value).toBe("Warszawa");
    expect(screen.queryByRole("button", { name: "adminEvents.studio.actions.save" })).toBeNull();
    expect(h.payloads).toHaveLength(0);
  });

  it("„Porzuć” kasuje też ślad po nieudanej próbie zapisu", () => {
    // Bez zdjęcia znacznika „próbowano" komunikaty zostałyby na ekranie przy
    // wartościach, których już nie ma.
    panel();
    wpisz("supportLabel", "bez-malpy");
    zapiszKliknij();
    expect(komunikaty().length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "adminEvents.studio.actions.discard" }));
    expect(komunikaty()).toHaveLength(0);
  });
});

describe("EventGeneralPanel - podgląd na żywo", () => {
  it("dok podglądu dostaje SZKIC, a nie wiersz z bazy", () => {
    panel();
    wpisz("nameLabel", "Kongres Energetyczny 2026");
    wpisz("cityLabel", "Gdańsk");

    const ostatni = h.preview.at(-1);
    expect(ostatni?.titlePl).toBe("Kongres Energetyczny 2026");
    // Adres jedzie SKLEJONY - podgląd nie zna reguły składania linijki adresu.
    expect(String(ostatni?.addressLine)).toContain("Gdańsk");
    expect(ostatni?.slug).toBe("kongres-energetyczny");
  });

  it("podgląd dostaje także języki i hashtag, nie tylko tytuł", () => {
    panel();
    const ostatni = h.preview.at(-1);
    // Szkic trzyma języki ZNORMALIZOWANE (bez duplikatów, alfabetycznie), więc
    // podgląd dostaje ten sam zbiór, który pojedzie do bazy - a nie kolejność
    // przypadkową z wiersza RPC.
    expect(ostatni?.languages).toEqual(["en", "pl"]);
    expect(ostatni?.hashtag).toBe("NES2026");
  });
});

describe("EventGeneralPanel - identyfikator wydarzenia", () => {
  it("kopiowanie wysyła do schowka IDENTYFIKATOR, nie adres publiczny", async () => {
    panel();
    fireEvent.click(screen.getByLabelText(`${G}copyId`));

    expect(h.writeText).toHaveBeenCalledWith(EVENT_ID);
    // Potwierdzenie jest WIDOCZNE - bez niego nie wiadomo, czy kliknięcie
    // w ogóle zadziałało.
    await waitFor(() => {
      expect(document.querySelector(".lucide-check")).not.toBeNull();
    });
  });

  it("ODMOWA schowka mówi o niej wprost, zamiast udawać sukces", async () => {
    // Przeglądarka odmawia dostępu do schowka poza gestem użytkownika i po
    // stronie niezaufanego kontekstu - cicha porażka znaczy, że redaktor wkleja
    // starą zawartość schowka do zgłoszenia serwisowego.
    h.writeText = vi.fn(() => Promise.reject(new Error("denied")));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: h.writeText },
    });
    panel();
    fireEvent.click(screen.getByLabelText(`${G}copyId`));

    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith(`${G}copyFailed`);
    });
    expect(document.querySelector(".lucide-check")).toBeNull();
  });
});
