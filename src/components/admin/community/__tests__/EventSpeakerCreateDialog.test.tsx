// Popup „Nowy prelegent" - kontrakt renderu i kontrakt PAYLOADU.
//
// CO TEN PLIK DOWODZI. To jedyne miejsce w panelu, w ktorym powstaje prelegent
// BEZ KONTA na platformie, wiec przedmiotem dowodu jest ksztalt tego, co
// wychodzi do bazy, a nie wyglad formularza:
//
//   1. WYMAGANE POLA. Przycisk jest wylaczony do wpisania imienia i nazwiska -
//      i WLACZONY bez adresu poczty. Adres jest u nas kluczem DOPASOWANIA
//      w kartotece, a nie loginem zakladanego konta (wzorzec ma go jako
//      wymagany, bo tam popup zaklada konto - my kont nie zakladamy).
//   2. PUSTE POLE NIE WCHODZI DO PAYLOADU. RPC czyta `p_payload->>'phone'`,
//      wiec brak klucza znaczy „zostaw kolumne", a pusty napis wysylany
//      w kazdym zapisie wymazywalby telefon wpisany przez samego uczestnika.
//   3. „BEZ GRUPY" NIE JEST GRUPA. Wartosc-wartownik `__none__` nie moze
//      trafic do `group_id` - baza odrzucilaby ja jako niepoprawny uuid,
//      a redaktor zobaczylby blad typu przy poprawnie wypelnionym formularzu.
//   4. KOMUNIKAT BAZY WCHODZI NA EKRAN. Ograniczenia sa nazwane (https na
//      zdjeciu, format adresu, unikalnosc w kartotece); zamiana ich na jedno
//      „nie udalo sie" kosztuje redaktora zgadywanie, ktore pole poprawic.
//   5. ZERO SUROWYCH KLUCZY i18n na ekranie.
//
// CO DOSZLO W DRUGIM PODEJSCIU (pakiet E2). Powyzsze piec punktow opisuje
// SZKIELET formularza; poza dowodem stala cala prawa strona popupu:
//
//   6. KAZDE POLE MA WLASNY KLUCZ. Popup ma osiemnascie kontrolek ulozonych
//      w pary PL/EN. Zamiana dwoch `onChange` w takiej parze nie daje ani
//      wyjatku, ani zlego ukladu - wychodzi dopiero na stronie publicznej,
//      angielskim bio pod polska flaga. Kazde pole dostaje wiec rozpoznawalna
//      wartosc i jest sprawdzane W PAYLOADZIE, nie na ekranie.
//   7. WGRANIE ZDJECIA. To jedyna sciezka tego popupu, ktora dotyka storage.
//      Dowodzone jest: wybor z dysku, upuszczenie pliku na kafel, obsluga
//      ODRZUCENIA (komunikat, nie cisza), brak najemcy (nic nie leci do
//      storage) oraz to, ze wgrany adres faktycznie jedzie w payloadzie.
//      `uploadAndRegisterMedia` jest ATRAPOWANE: prawdziwa funkcja wchodzi do
//      Supabase Storage, a test nie ma prawa wyjsc do sieci.
//   8. WYJSCIE BEZ ZAPISU („Anuluj") CZYSCI SZKIC. Popup jest montowany raz
//      przez ekran prelegentow i tylko chowany, wiec nieskasowany szkic
//      wrocilby przy zakladaniu NASTEPNEJ osoby - z cudzym nazwiskiem
//      i cudzym telefonem w polach.
//   9. KARTA PO KLIKNIECIU (20260924120000). Sekcja wspolna z dialogiem
//      „Karta" na liscie: wypelnione pola jada w payloadzie PRZYCIETE, puste
//      jako `undefined` („ustawienie domyslne", klucz nie jedzie wcale),
//      a blad ksztaltu (adres, kolor, dlugosc napisu) blokuje zapis, zanim
//      baza odmowi bez wskazania pola.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const createEventSpeakerPerson = vi.fn();
const fetchEventGroups = vi.fn();
const uploadAndRegisterMedia = vi.fn();

vi.mock("@/lib/admin/community", () => ({
  createEventSpeakerPerson: (...args: unknown[]) => createEventSpeakerPerson(...args),
}));

// TOZSAMOSC WGRYWAJACEGO. `handlePhoto` wychodzi przedwczesnie bez najemcy
// i bez konta - a prawdziwy `useAuth` w tescie nie ma sesji, wiec bez tej
// atrapy CALA sciezka zdjecia bylaby martwa i niedowiedziona.
const authState = {
  user: null as { id: string } | null,
  tenantId: null as string | null,
};
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));

// STORAGE. Prawdziwa funkcja wrzuca bajty do bucketu `media` i rejestruje je
// serwerowo; tutaj liczy sie WYLACZNIE kontrakt wywolania i to, co popup robi
// z wynikiem oraz z odmowa.
vi.mock("@/lib/media/upload", () => ({
  uploadAndRegisterMedia: (...args: unknown[]) => uploadAndRegisterMedia(...args),
  IMAGE_MIME: ["image/jpeg", "image/png", "image/webp"],
  IMAGE_ACCEPT_ATTR: "image/jpeg,image/png,image/webp",
}));

/**
 * Radix Select pod happy-dom nie otwiera listy (potrzebuje pomiarow ukladu
 * i pelnego API wskaznika), a wybor grupy jest tresci zachowania: wartownik
 * „bez grupy" NIE MOZE dojechac do `group_id`. Atrapa oddaje te sama umowe -
 * `value` + `onValueChange` - i renderuje pozycje jako zwykle przyciski.
 */
vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const Ctx = react.createContext<(value: string) => void>(() => undefined);
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      children?: ReactNode;
    }) => (
      <Ctx.Provider value={onValueChange}>
        <div data-testid="group-select" data-value={value}>
          {children}
        </div>
      </Ctx.Provider>
    ),
    SelectTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    SelectContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SelectItem: ({
      value,
      disabled,
      children,
    }: {
      value: string;
      disabled?: boolean;
      children?: ReactNode;
    }) => {
      const onValueChange = react.useContext(Ctx);
      return (
        <button
          type="button"
          role="option"
          aria-selected={false}
          disabled={disabled}
          data-value={value}
          onClick={() => onValueChange(value)}
        >
          {children}
        </button>
      );
    },
  };
});

vi.mock("@/lib/events/termsGroupsApi", () => ({
  fetchEventGroups: (...args: unknown[]) => fetchEventGroups(...args),
  fetchEventTerms: () => Promise.resolve([]),
  saveEventGroup: () => Promise.resolve(""),
  deleteEventGroup: () => Promise.resolve(true),
  setEventGroupMember: () => Promise.resolve(true),
  saveEventTerm: () => Promise.resolve(""),
  deleteEventTerm: () => Promise.resolve(true),
}));

import i18n from "@/lib/i18n";
import { ensureI18n as ensureCommunityEventsI18n } from "@/lib/i18n-admin-community-events";

const { EventSpeakerCreateDialog } =
  await import("@/components/admin/community/EventSpeakerCreateDialog");

ensureCommunityEventsI18n();

const onCreated = vi.fn();
const onOpenChange = vi.fn();

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EventSpeakerCreateDialog
        eventId="ev-1"
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
}

/** Etykiety sa i18n-owane, wiec pola bierzemy po widocznym tekscie etykiety. */
function fill(label: string, value: string): void {
  const field = screen.getByText(label).closest("div");
  if (field === null) throw new Error(`test: brak pola "${label}"`);
  const input = field.querySelector("input, textarea");
  if (input === null) throw new Error(`test: pole "${label}" bez kontrolki`);
  fireEvent.change(input, { target: { value } });
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: /Utwórz prelegenta/ });
}

describe("EventSpeakerCreateDialog", () => {
  beforeEach(() => {
    createEventSpeakerPerson.mockReset();
    fetchEventGroups.mockReset();
    uploadAndRegisterMedia.mockReset();
    onCreated.mockReset();
    onOpenChange.mockReset();
    fetchEventGroups.mockResolvedValue([
      { id: "grp-1", name_pl: "Prelegenci", name_en: "Speakers" },
    ]);
    authState.user = { id: "usr-1" };
    authState.tenantId = "tnt-1";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("zapis jest wylaczony bez imienia i nazwiska, a WLACZONY bez adresu poczty", () => {
    renderDialog();
    expect(submitButton()).toBeDisabled();

    fill("Imię", "Halszka");
    expect(submitButton()).toBeDisabled();

    fill("Nazwisko", "Borowik");
    // Adres poczty pusty - i to ma wystarczyc: mowca zaproszony telefonicznie
    // przez sekretariat nie ma czym wypelnic tego pola.
    expect(submitButton()).toBeEnabled();
  });

  it("sam bialy znak nie jest nazwiskiem", () => {
    renderDialog();
    fill("Imię", "  ");
    fill("Nazwisko", "  ");
    expect(submitButton()).toBeDisabled();
  });

  it("wysyla tylko WYPELNIONE pola i nie wysyla wartownika grupy", async () => {
    createEventSpeakerPerson.mockResolvedValue({
      entry_id: "en-1",
      speaker_profile_id: "sp-1",
      person_id: "pe-1",
      user_id: null,
    });
    renderDialog();

    fill("Imię", "  Halszka  ");
    fill("Nazwisko", "Borowik");
    fill("Stanowisko", "Profesor");
    fireEvent.click(submitButton());

    await waitFor(() => expect(createEventSpeakerPerson).toHaveBeenCalledTimes(1));
    const payload = createEventSpeakerPerson.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.eventId).toBe("ev-1");
    // `trim` po stronie klienta: baza tez to robi, ale nazwa w toascie
    // („Dodano prelegenta: …") jedzie z tego samego zrodla.
    expect(payload.firstName).toBe("Halszka");
    expect(payload.lastName).toBe("Borowik");
    expect(payload.jobTitle).toBe("Profesor");
    // Pola nietkniete NIE MAJA byc pustym napisem - inaczej PATCH w RPC
    // wymazywalby kolumny wpisane inna droga.
    expect(payload.email).toBeUndefined();
    expect(payload.phone).toBeUndefined();
    expect(payload.photoUrl).toBeUndefined();
    expect(payload.bioPl).toBeUndefined();
    // Wartownik „bez grupy" nie jest identyfikatorem grupy.
    expect(payload.groupId).toBeUndefined();
    // Domyslnie opis sceniczny jest widoczny.
    expect(payload.isPublic).toBe(true);
  });

  it("tematy i jezyki ida jako TABLICE, jezyki malymi literami", async () => {
    createEventSpeakerPerson.mockResolvedValue({
      entry_id: "en-1",
      speaker_profile_id: "sp-1",
      person_id: "pe-1",
      user_id: null,
    });
    renderDialog();

    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    fill("Tematy PL", " bankowość , regulacje ,, ");
    fill("Języki", "PL, En");
    fireEvent.click(submitButton());

    await waitFor(() => expect(createEventSpeakerPerson).toHaveBeenCalledTimes(1));
    const payload = createEventSpeakerPerson.mock.calls[0][0] as Record<string, unknown>;
    // Puste elementy po przecinku odsiane - inaczej na profilu wisialby
    // pusty chip, ktorego redaktor nie umie usunac.
    expect(payload.topicsPl).toEqual(["bankowość", "regulacje"]);
    // Kody jezykow czyta widget publiczny - musza byc malymi literami.
    expect(payload.languages).toEqual(["pl", "en"]);
    // Pole nietkniete to `undefined`, czyli „nie dotykaj", a NIE `[]`,
    // ktore w RPC znaczy „wyczysc".
    expect(payload.topicsEn).toBeUndefined();
  });

  it("po zapisie oddaje wynik i nazwe rodzicowi oraz zamyka popup", async () => {
    const result = {
      entry_id: "en-1",
      speaker_profile_id: "sp-1",
      person_id: "pe-1",
      user_id: null,
    };
    createEventSpeakerPerson.mockResolvedValue(result);
    renderDialog();

    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    fireEvent.click(submitButton());

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(result, "Halszka Borowik"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("nazwany blad bazy trafia na ekran, a popup zostaje otwarty", async () => {
    createEventSpeakerPerson.mockRejectedValue(
      new Error('new row for relation "event_people" violates check constraint'),
    );
    renderDialog();

    fill("Imię", "Ktos");
    fill("Nazwisko", "Bez-Https");
    fill("Zdjęcie (adres)", "http://cdn.example.com/x.jpg");
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent ?? "").toContain("check constraint");
    // Zamkniecie popupu po bledzie skasowalo by kilkanascie wpisanych pol.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("pokazuje note o zgodach i NIE pyta o zgode marketingowa", () => {
    renderDialog();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Zgód marketingowych");
    // Zgoda marketingowa i partnerska zostaja w sciezce rejestracji - popup
    // organizatora nie moze ich udzielic za kogos.
    expect(screen.queryByText(/zgoda marketingowa/i)).toBeNull();
    expect(screen.queryByText(/partner/i)).toBeNull();
  });

  it("nie wypuszcza surowych kluczy i18n", () => {
    renderDialog();
    expect(document.body.textContent ?? "").not.toContain("adminCommunityEvents.");
  });
});

// --- KAZDE POLE MA WLASNY KLUCZ --------------------------------------------

describe("EventSpeakerCreateDialog - mapowanie pol na payload", () => {
  beforeEach(() => {
    createEventSpeakerPerson.mockReset().mockResolvedValue({
      entry_id: "en-1",
      speaker_profile_id: "sp-1",
      person_id: "pe-1",
      user_id: null,
    });
    fetchEventGroups
      .mockReset()
      .mockResolvedValue([{ id: "grp-1", name_pl: "Prelegenci", name_en: "Speakers" }]);
    uploadAndRegisterMedia.mockReset();
    onCreated.mockReset();
    onOpenChange.mockReset();
    authState.user = { id: "usr-1" };
    authState.tenantId = "tnt-1";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("osiemnascie kontrolek -> osiemnascie osobnych kluczy, bez zamiany par PL/EN", async () => {
    renderDialog();
    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    fill("Adres poczty", "halszka.borowik@example.com");
    fill("Stanowisko", "Dyrektorka programu");
    fill("Instytucja", "Instytut Spraw Zmyślonych");
    fill("Rola sceniczna PL", "rola-pl");
    fill("Rola sceniczna EN", "rola-en");
    fill("Bio PL", "bio-pl");
    fill("Bio EN", "bio-en");
    fill("Tematy PL", "temat-pl");
    fill("Tematy EN", "temat-en");
    fill("Języki", "PL");
    fill("Telefon", "+48 000 000 000");
    fill("Profil zawodowy (adres)", "https://example.com/profil");
    fill("Zdjęcie (adres)", "https://cdn.example.com/portret.jpg");
    fireEvent.click(submitButton());

    await waitFor(() => expect(createEventSpeakerPerson).toHaveBeenCalledTimes(1));
    expect(createEventSpeakerPerson.mock.calls[0][0]).toEqual({
      eventId: "ev-1",
      groupId: undefined,
      email: "halszka.borowik@example.com",
      firstName: "Halszka",
      lastName: "Borowik",
      jobTitle: "Dyrektorka programu",
      companyText: "Instytut Spraw Zmyślonych",
      phone: "+48 000 000 000",
      socialProfileUrl: "https://example.com/profil",
      photoUrl: "https://cdn.example.com/portret.jpg",
      bioPl: "bio-pl",
      bioEn: "bio-en",
      headlinePl: "rola-pl",
      headlineEn: "rola-en",
      topicsPl: ["temat-pl"],
      topicsEn: ["temat-en"],
      languages: ["pl"],
      isPublic: true,
    });
  });

  it("wybrana grupa jedzie jako `groupId`, a wartownik „bez grupy” nadal nie", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByRole("option", { name: "Prelegenci" })).toBeEnabled());

    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    fireEvent.click(screen.getByRole("option", { name: "Prelegenci" }));
    fireEvent.click(submitButton());

    await waitFor(() => expect(createEventSpeakerPerson).toHaveBeenCalledTimes(1));
    expect((createEventSpeakerPerson.mock.calls[0][0] as Record<string, unknown>).groupId).toBe(
      "grp-1",
    );

    // Powrot na „Bez grupy" musi ODEBRAC grupe, a nie wyslac napisu-wartownika.
    // Po udanym zapisie szkic jest czyszczony, wiec nazwisko wpisujemy raz
    // jeszcze - to samo robi redaktor zakladajacy druga osobe pod rzad.
    fill("Imię", "Bogumił");
    fill("Nazwisko", "Trawka");
    fireEvent.click(screen.getByRole("option", { name: "Bez grupy" }));
    fireEvent.click(submitButton());
    await waitFor(() => expect(createEventSpeakerPerson).toHaveBeenCalledTimes(2));
    expect(
      (createEventSpeakerPerson.mock.calls[1][0] as Record<string, unknown>).groupId,
    ).toBeUndefined();
  });

  it("lista grup w locie pokazuje pozycje NIEKLIKALNA, a nie pusta droplistę", () => {
    // Zapytanie nierozstrzygniete: bez tej pozycji redaktor widzi liste
    // z jedna opcja („Bez grupy") i uznaje, ze wydarzenie nie ma grup.
    fetchEventGroups.mockReturnValue(new Promise(() => {}));
    renderDialog();
    const loading = screen.getByRole("option", { name: "Wczytywanie grup…" });
    expect(loading).toBeDisabled();
    expect(screen.queryByRole("option", { name: "Prelegenci" })).toBeNull();
  });

  it("wylaczenie opisu scenicznego jedzie do bazy jako `isPublic: false`", async () => {
    renderDialog();
    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    fireEvent.click(screen.getByRole("switch", { name: /opis sceniczny/i }));
    fireEvent.click(submitButton());

    await waitFor(() => expect(createEventSpeakerPerson).toHaveBeenCalledTimes(1));
    expect((createEventSpeakerPerson.mock.calls[0][0] as Record<string, unknown>).isPublic).toBe(
      false,
    );
  });

  it("w trakcie zapisu przycisk mowi „Zapisywanie…” i nie przyjmuje drugiego klikniecia", async () => {
    // Podwojne klikniecie zakladaloby DWIE osoby o tym samym nazwisku - RPC
    // dopasowuje po adresie poczty, a osoba bez adresu nie ma po czym.
    let release: (value: unknown) => void = () => undefined;
    createEventSpeakerPerson.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderDialog();
    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    fireEvent.click(submitButton());

    const pending = await screen.findByRole("button", { name: /Zapisywanie…/ });
    expect(pending).toBeDisabled();
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeDisabled();
    fireEvent.click(pending);
    expect(createEventSpeakerPerson).toHaveBeenCalledTimes(1);

    release({ entry_id: "en-1", speaker_profile_id: "sp-1", person_id: "pe-1", user_id: null });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("„Anuluj” zamyka popup i CZYSCI szkic - nastepna osoba zaczyna od pustych pol", () => {
    const { unmount } = renderDialog();
    fill("Imię", "Halszka");
    fill("Telefon", "+48 111 111 111");

    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Popup nie jest odmontowywany przez rodzica (stoi w drzewie ekranu
    // prelegentow i tylko chowa sie propsem), wiec czyszczenie musi byc jawne.
    expect(screen.getByLabelText("Wgraj zdjęcie")).toBeInTheDocument();
    expect(field("Imię").value).toBe("");
    expect(field("Telefon").value).toBe("");
    unmount();
  });
});

// --- ZDJECIE ----------------------------------------------------------------

/** Kontrolka pola po widocznej etykiecie - wariant zwracajacy typ. */
function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const wrapper = screen.getByText(label).closest("div");
  if (wrapper === null) throw new Error(`test: brak pola "${label}"`);
  const control = wrapper.querySelector("input, textarea");
  if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLTextAreaElement)) {
    throw new Error(`test: pole "${label}" bez kontrolki`);
  }
  return control;
}

/**
 * Obszar wgrywania w standardzie platformy (`@/components/ui/upload-area`):
 * ramka przyjmuje upuszczony plik, a klawiature obsluguje jego CTA. Kafel
 * `role="button"` z wlasna obsluga Enter/Spacji zniknal razem z nim.
 */
function photoTile(): HTMLElement {
  const area = document.querySelector('[data-slot="upload-area"]');
  if (!(area instanceof HTMLElement)) throw new Error("test: brak obszaru wgrywania");
  return area;
}

function photoButton(label: "Wgraj zdjęcie" | "Podmień zdjęcie"): HTMLElement {
  const button = screen
    .getAllByRole("button", { name: label })
    .find((el) => el instanceof HTMLButtonElement);
  if (button === undefined) throw new Error(`test: brak przycisku „${label}"`);
  return button;
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("test: brak pola pliku");
  return input;
}

const PORTRAIT = (): File =>
  new File(["bajty-zmyslonego-portretu"], "portret.png", { type: "image/png" });

describe("EventSpeakerCreateDialog - zdjecie prelegenta", () => {
  beforeEach(() => {
    createEventSpeakerPerson.mockReset().mockResolvedValue({
      entry_id: "en-1",
      speaker_profile_id: "sp-1",
      person_id: "pe-1",
      user_id: null,
    });
    fetchEventGroups.mockReset().mockResolvedValue([]);
    uploadAndRegisterMedia.mockReset();
    onCreated.mockReset();
    onOpenChange.mockReset();
    authState.user = { id: "usr-1" };
    authState.tenantId = "tnt-1";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("wybor pliku z dysku idzie JEDYNA dopuszczalna sciezka i wypelnia adres", async () => {
    uploadAndRegisterMedia.mockResolvedValue({
      publicUrl: "https://cdn.example.com/tnt-1/event-speakers/portret.png",
    });
    renderDialog();

    fireEvent.change(fileInput(), { target: { files: [PORTRAIT()] } });

    await waitFor(() => expect(uploadAndRegisterMedia).toHaveBeenCalledTimes(1));
    const args = uploadAndRegisterMedia.mock.calls[0][0] as Record<string, unknown>;
    // Prefiks najemcy i allowlista obrazow to warunki, ktore ta warstwa ma
    // wymusic - popup nie moze ich pominac ani rozluznic.
    expect(args.tenantId).toBe("tnt-1");
    expect(args.userId).toBe("usr-1");
    expect(args.subfolder).toBe("event-speakers");
    expect(args.allowedMime).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(args.file).toBeInstanceOf(File);

    await waitFor(() =>
      expect(field("Zdjęcie (adres)").value).toBe(
        "https://cdn.example.com/tnt-1/event-speakers/portret.png",
      ),
    );
    // Etykieta przycisku zmienia sie na „podmien", a obok pojawia sie kasowanie.
    expect(photoButton("Podmień zdjęcie")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usuń zdjęcie" })).toBeInTheDocument();
    expect(screen.getByAltText("Podgląd zdjęcia prelegenta")).toHaveAttribute(
      "src",
      "https://cdn.example.com/tnt-1/event-speakers/portret.png",
    );
  });

  it("wgrany adres faktycznie jedzie w payloadzie zalozenia osoby", async () => {
    uploadAndRegisterMedia.mockResolvedValue({
      publicUrl: "https://cdn.example.com/tnt-1/event-speakers/portret.png",
    });
    renderDialog();
    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    fireEvent.change(fileInput(), { target: { files: [PORTRAIT()] } });
    await waitFor(() =>
      expect(field("Zdjęcie (adres)").value).toContain("event-speakers/portret.png"),
    );

    fireEvent.click(submitButton());
    await waitFor(() => expect(createEventSpeakerPerson).toHaveBeenCalledTimes(1));
    expect((createEventSpeakerPerson.mock.calls[0][0] as Record<string, unknown>).photoUrl).toBe(
      "https://cdn.example.com/tnt-1/event-speakers/portret.png",
    );
  });

  it("upuszczenie pliku na kafel dziala tak samo jak wybor z dysku", async () => {
    uploadAndRegisterMedia.mockResolvedValue({ publicUrl: "https://cdn.example.com/drop.png" });
    renderDialog();
    const tile = photoTile();
    const niesiePlik = { types: ["Files"], files: [] as File[] };

    fireEvent.dragOver(tile, { dataTransfer: niesiePlik });
    fireEvent.dragLeave(tile, { dataTransfer: niesiePlik });
    fireEvent.drop(tile, { dataTransfer: { types: ["Files"], files: [PORTRAIT()] } });

    await waitFor(() => expect(uploadAndRegisterMedia).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(field("Zdjęcie (adres)").value).toBe("https://cdn.example.com/drop.png"),
    );
  });

  it("upuszczenie CZEGOKOLWIEK BEZ PLIKU nie rusza storage", () => {
    renderDialog();
    fireEvent.drop(photoTile(), { dataTransfer: { types: ["Files"], files: [] } });
    // To samo od strony pola pliku: anulowanie okna systemowego zostawia
    // puste `files`, a nie „brak zdarzenia".
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(uploadAndRegisterMedia).not.toHaveBeenCalled();
  });

  it("tlo obszaru i jego CTA otwieraja ten sam wybor pliku - i kazde DOKLADNIE raz", () => {
    // Klawiature obsluguje CTA (prawdziwy `<button>`): przegladarka zamienia
    // Enter i spacje na `click`, wiec dowodem jest liczba otwarc pickera, a
    // nie wlasna obsluga `keyDown` na divie. Klikniecie w CTA bąbelkuje do
    // obszaru - gdyby obszar go nie odfiltrowal, picker otwieralby sie dwa razy.
    renderDialog();
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});

    fireEvent.click(photoTile());
    fireEvent.click(photoButton("Wgraj zdjęcie"));

    expect(click).toHaveBeenCalledTimes(2);
  });

  it("ODRZUCONY upload zostawia komunikat, a nie ciszę i nie pusty podglad", async () => {
    uploadAndRegisterMedia.mockRejectedValue(new Error("Disallowed mime type"));
    renderDialog();

    fireEvent.change(fileInput(), { target: { files: [PORTRAIT()] } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent ?? "").toBe(
      "Nie udało się wgrać zdjęcia. Disallowed mime type",
    );
    expect(field("Zdjęcie (adres)").value).toBe("");
    // Pole pliku jest zerowane, wiec ten sam plik da sie wybrac ponownie.
    expect(fileInput().value).toBe("");
  });

  it("bez najemcy NIC nie leci do storage", () => {
    // Sesja bez tenanta zdarza sie w trakcie odswiezania kontekstu roli.
    authState.tenantId = null;
    renderDialog();
    fireEvent.change(fileInput(), { target: { files: [PORTRAIT()] } });
    expect(uploadAndRegisterMedia).not.toHaveBeenCalled();
  });

  it("bez konta uzytkownika NIC nie leci do storage", () => {
    authState.user = null;
    renderDialog();
    fireEvent.change(fileInput(), { target: { files: [PORTRAIT()] } });
    expect(uploadAndRegisterMedia).not.toHaveBeenCalled();
  });

  it("kasowanie zdjecia czysci adres i chowa przycisk kasowania", async () => {
    uploadAndRegisterMedia.mockResolvedValue({ publicUrl: "https://cdn.example.com/x.png" });
    renderDialog();
    fireEvent.change(fileInput(), { target: { files: [PORTRAIT()] } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Usuń zdjęcie" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Usuń zdjęcie" }));

    expect(field("Zdjęcie (adres)").value).toBe("");
    expect(screen.queryByRole("button", { name: "Usuń zdjęcie" })).toBeNull();
    expect(photoButton("Wgraj zdjęcie")).toBeInTheDocument();
  });

  it("w trakcie wgrywania przycisk jest zablokowany i mowi, co sie dzieje", async () => {
    let release: (value: { publicUrl: string }) => void = () => undefined;
    uploadAndRegisterMedia.mockReturnValue(
      new Promise<{ publicUrl: string }>((resolve) => {
        release = resolve;
      }),
    );
    renderDialog();
    fireEvent.change(fileInput(), { target: { files: [PORTRAIT()] } });

    const uploading = await screen.findByRole("button", { name: "Wgrywanie…" });
    expect(uploading).toBeDisabled();

    release({ publicUrl: "https://cdn.example.com/late.png" });
    await waitFor(() =>
      expect(field("Zdjęcie (adres)").value).toBe("https://cdn.example.com/late.png"),
    );
  });
});

// --- KARTA PO KLIKNIECIU ----------------------------------------------------

/** Sekcja karty - po naglowku, bo „Zdjecie" wystepuje w popupie dwa razy. */
function cardSection(): HTMLElement {
  const heading = screen.getByRole("heading", { name: "Karta po kliknięciu" });
  const section = heading.closest("section");
  if (section === null) throw new Error("test: brak sekcji karty");
  return section;
}

function cardInput(label: string): HTMLInputElement {
  const element = within(cardSection()).getByLabelText(label);
  if (!(element instanceof HTMLInputElement)) throw new Error(`test: "${label}" to nie input`);
  return element;
}

function fillCard(label: string, value: string): void {
  fireEvent.change(cardInput(label), { target: { value } });
}

describe("EventSpeakerCreateDialog - karta po kliknieciu", () => {
  beforeEach(() => {
    createEventSpeakerPerson.mockReset().mockResolvedValue({
      entry_id: "en-1",
      speaker_profile_id: "sp-1",
      person_id: "pe-1",
      user_id: null,
    });
    fetchEventGroups.mockReset().mockResolvedValue([]);
    uploadAndRegisterMedia.mockReset();
    onCreated.mockReset();
    onOpenChange.mockReset();
    authState.user = { id: "usr-1" };
    authState.tenantId = "tnt-1";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("popup ma sekcje karty z piecioma polami i podpowiedzia, co widac po kliknieciu", () => {
    renderDialog();
    const section = cardSection();
    expect(within(section).getByText(/Kliknięcie w zdjęcie rozwija kartę/)).toBeInTheDocument();
    expect(cardInput("Adres grafiki")).toBeInTheDocument();
    // Limit etykiety pilnuje walidator (punkty kodowe jak w bazie), nie
    // `maxLength` przegladarki (jednostki UTF-16).
    expect(cardInput("Napis na przycisku PL")).not.toHaveAttribute("maxLength");
    expect(cardInput("Napis na przycisku EN")).not.toHaveAttribute("maxLength");
    expect(cardInput("Adres przycisku")).toBeInTheDocument();
    expect(cardInput("Kolor przycisku")).toBeInTheDocument();
    expect(cardInput("Wybierz kolor przycisku").value).toBe("#fa9346");
    // Obszar zdjecia osoby zostaje PIERWSZYM obszarem wgrywania w popupie.
    const areas = document.querySelectorAll('[data-slot="upload-area"]');
    expect(areas).toHaveLength(2);
    expect(section.contains(areas[0])).toBe(false);
    expect(section.contains(areas[1])).toBe(true);
  });

  it("wypelnione pola karty jada w payloadzie PRZYCIETE, kazde pod wlasnym kluczem", async () => {
    renderDialog();
    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    fillCard("Adres grafiki", "https://cdn.example.com/karta.jpg");
    fillCard("Napis na przycisku PL", "  Zapisz się  ");
    fillCard("Napis na przycisku EN", " Sign up ");
    fillCard("Adres przycisku", " https://example.com/zapisy ");
    fillCard("Kolor przycisku", " #0A7D3B ");
    expect(submitButton()).toBeEnabled();
    fireEvent.click(submitButton());

    await waitFor(() => expect(createEventSpeakerPerson).toHaveBeenCalledTimes(1));
    const payload = createEventSpeakerPerson.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.cardPhotoUrl).toBe("https://cdn.example.com/karta.jpg");
    expect(payload.cardCtaLabelPl).toBe("Zapisz się");
    expect(payload.cardCtaLabelEn).toBe("Sign up");
    expect(payload.cardCtaUrl).toBe("https://example.com/zapisy");
    expect(payload.cardCtaColor).toBe("#0A7D3B");
    // Zdjecie KARTY to nie zdjecie OSOBY - dwa rozne klucze.
    expect(payload.photoUrl).toBeUndefined();
  });

  it("pelny payload z karta: sciezka wewnetrzna i kolor, bez zamiany pol", async () => {
    renderDialog();
    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    fillCard("Napis na przycisku PL", "Profil eksperta");
    fillCard("Adres przycisku", "/experts/halszka-borowik");
    fireEvent.change(cardInput("Wybierz kolor przycisku"), { target: { value: "#112233" } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(createEventSpeakerPerson).toHaveBeenCalledTimes(1));
    expect(createEventSpeakerPerson.mock.calls[0][0]).toEqual({
      eventId: "ev-1",
      groupId: undefined,
      email: undefined,
      firstName: "Halszka",
      lastName: "Borowik",
      jobTitle: undefined,
      companyText: undefined,
      phone: undefined,
      socialProfileUrl: undefined,
      photoUrl: undefined,
      bioPl: undefined,
      bioEn: undefined,
      headlinePl: undefined,
      headlineEn: undefined,
      topicsPl: undefined,
      topicsEn: undefined,
      languages: undefined,
      isPublic: true,
      cardPhotoUrl: undefined,
      cardCtaLabelPl: "Profil eksperta",
      cardCtaLabelEn: undefined,
      cardCtaUrl: "/experts/halszka-borowik",
      cardCtaColor: "#112233",
    });
  });

  it("puste i biale pola karty NIE jada jako pusty napis - sa `undefined`", async () => {
    renderDialog();
    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    // Sam bialy znak to tez „puste": pusty napis w RPC wymazalby kolumne.
    fillCard("Napis na przycisku PL", "   ");
    fillCard("Kolor przycisku", "  ");
    fireEvent.click(submitButton());

    await waitFor(() => expect(createEventSpeakerPerson).toHaveBeenCalledTimes(1));
    const payload = createEventSpeakerPerson.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.cardPhotoUrl).toBeUndefined();
    expect(payload.cardCtaLabelPl).toBeUndefined();
    expect(payload.cardCtaLabelEn).toBeUndefined();
    expect(payload.cardCtaUrl).toBeUndefined();
    expect(payload.cardCtaColor).toBeUndefined();
  });

  it("niepoprawny adres przycisku blokuje zapis i mowi, ktore pole poprawic", () => {
    renderDialog();
    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    expect(submitButton()).toBeEnabled();

    fillCard("Adres przycisku", "javascript:alert(1)");
    expect(submitButton()).toBeDisabled();
    expect(within(cardSection()).getByRole("alert")).toHaveTextContent(
      "Adres musi zaczynać się od https:// albo od ukośnika (ścieżka w serwisie).",
    );
    fireEvent.click(submitButton());
    expect(createEventSpeakerPerson).not.toHaveBeenCalled();

    fillCard("Adres przycisku", "https://example.com/zapisy");
    expect(submitButton()).toBeEnabled();
    expect(within(cardSection()).queryByRole("alert")).toBeNull();
  });

  it.each([
    ["Kolor przycisku", "zielony"],
    ["Napis na przycisku PL", "x".repeat(41)],
    ["Adres grafiki", "http://cdn.example.com/karta.jpg"],
  ])("blad w polu karty „%s” tez blokuje zapis", (label, value) => {
    renderDialog();
    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    fillCard(label, value);
    expect(submitButton()).toBeDisabled();
  });

  it("zdjecie karty wgrywa sie ta sama sciezka do katalogu prelegentow i jedzie jako cardPhotoUrl", async () => {
    uploadAndRegisterMedia.mockResolvedValue({
      publicUrl: "https://cdn.example.com/tnt-1/event-speakers/karta.png",
    });
    renderDialog();
    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    const cardFile = cardSection().querySelector('input[type="file"]');
    if (!(cardFile instanceof HTMLInputElement)) throw new Error("test: brak pola pliku karty");

    fireEvent.change(cardFile, { target: { files: [PORTRAIT()] } });

    await waitFor(() => expect(uploadAndRegisterMedia).toHaveBeenCalledTimes(1));
    const args = uploadAndRegisterMedia.mock.calls[0][0] as Record<string, unknown>;
    expect(args.subfolder).toBe("event-speakers");
    expect(args.tenantId).toBe("tnt-1");
    await waitFor(() =>
      expect(cardInput("Adres grafiki").value).toBe(
        "https://cdn.example.com/tnt-1/event-speakers/karta.png",
      ),
    );
    // Zdjecie osoby zostaje nietkniete.
    expect(field("Zdjęcie (adres)").value).toBe("");

    fireEvent.click(submitButton());
    await waitFor(() => expect(createEventSpeakerPerson).toHaveBeenCalledTimes(1));
    const payload = createEventSpeakerPerson.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.cardPhotoUrl).toBe("https://cdn.example.com/tnt-1/event-speakers/karta.png");
    expect(payload.photoUrl).toBeUndefined();
  });

  it("„Anuluj” czysci takze szkic karty", () => {
    renderDialog();
    fillCard("Napis na przycisku PL", "Zapisz się");
    fillCard("Kolor przycisku", "#0a7d3b");

    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(cardInput("Napis na przycisku PL").value).toBe("");
    expect(cardInput("Kolor przycisku").value).toBe("");
  });

  it("po udanym zapisie szkic karty jest czysty dla nastepnej osoby", async () => {
    renderDialog();
    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    fillCard("Adres przycisku", "/experts/halszka");
    fireEvent.click(submitButton());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(cardInput("Adres przycisku").value).toBe("");
  });

  it("sekcja karty nie wypuszcza surowych kluczy i18n (takze obszaru wgrywania)", () => {
    renderDialog();
    fillCard("Adres przycisku", "javascript:alert(1)");
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("adminCommunityEvents.");
    expect(text).not.toContain("adminEventAgenda.");
  });
});

// --- LISTA GRUP: NAZWY I STAN BLEDU ------------------------------------------

describe("EventSpeakerCreateDialog - nazwy grup i stan bledu listy", () => {
  beforeEach(() => {
    createEventSpeakerPerson.mockReset();
    fetchEventGroups.mockReset();
    onCreated.mockReset();
    onOpenChange.mockReset();
    authState.user = { id: "usr-1" };
    authState.tenantId = "tnt-1";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("grupa bez nazwy PL pokazuje nazwe EN, a nie pusta pozycje", async () => {
    fetchEventGroups.mockResolvedValue([
      { id: "grp-1", name_pl: "Prelegenci", name_en: "Speakers" },
      { id: "grp-2", name_pl: "", name_en: "Moderators" },
    ]);
    renderDialog();
    expect(await screen.findByRole("option", { name: "Moderators" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Prelegenci" })).toBeInTheDocument();
  });

  it("nieudany odczyt grup zostawia samo „Bez grupy” - bez martwej pozycji ladowania", async () => {
    fetchEventGroups.mockRejectedValue(new Error("forbidden"));
    renderDialog();
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "Wczytywanie grup…" })).toBeNull(),
    );
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Bez grupy",
    ]);
    // Brak grup nie blokuje zalozenia prelegenta - grupa jest opcjonalna.
    fill("Imię", "Halszka");
    fill("Nazwisko", "Borowik");
    expect(submitButton()).toBeEnabled();
  });

  it("po angielsku grupy biora nazwe EN, a w jej braku PL; sekcja karty tez mowi po angielsku", async () => {
    fetchEventGroups.mockResolvedValue([
      { id: "grp-1", name_pl: "Prelegenci", name_en: "Speakers" },
      { id: "grp-2", name_pl: "Moderatorzy", name_en: "" },
    ]);
    await i18n.changeLanguage("en");
    try {
      renderDialog();
      expect(await screen.findByRole("option", { name: "Speakers" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Moderatorzy" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Prelegenci" })).toBeNull();
      expect(screen.getByRole("heading", { name: "Card on click" })).toBeInTheDocument();
      expect(document.body.textContent ?? "").not.toContain("adminCommunityEvents.");
    } finally {
      cleanup();
      await i18n.changeLanguage("pl");
    }
  });
});
