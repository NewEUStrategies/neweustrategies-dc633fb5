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
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
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
 * Kafel podgladu ma `role="button"` i `aria-label`, a stojacy obok PRZYCISK ma
 * ten sam napis w tresci - to dwa rozne wejscia do tego samego wyboru pliku,
 * wiec zapytania musza je rozroznic.
 */
function photoTile(label: "Wgraj zdjęcie" | "Podmień zdjęcie"): HTMLElement {
  return screen.getByLabelText(label);
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
    expect(photoTile("Podmień zdjęcie")).toBeInTheDocument();
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
    const tile = photoTile("Wgraj zdjęcie");

    fireEvent.dragOver(tile);
    fireEvent.dragLeave(tile);
    fireEvent.drop(tile, { dataTransfer: { files: [PORTRAIT()] } });

    await waitFor(() => expect(uploadAndRegisterMedia).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(field("Zdjęcie (adres)").value).toBe("https://cdn.example.com/drop.png"),
    );
  });

  it("upuszczenie CZEGOKOLWIEK BEZ PLIKU nie rusza storage", () => {
    renderDialog();
    fireEvent.drop(photoTile("Wgraj zdjęcie"), { dataTransfer: { files: [] } });
    // To samo od strony pola pliku: anulowanie okna systemowego zostawia
    // puste `files`, a nie „brak zdarzenia".
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(uploadAndRegisterMedia).not.toHaveBeenCalled();
  });

  it("kafel i przycisk otwieraja ten sam wybor pliku - takze z klawiatury", () => {
    renderDialog();
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const tile = photoTile("Wgraj zdjęcie");

    fireEvent.click(tile);
    // Kafel jest `role="button"` z `tabIndex`, wiec MUSI reagowac na Enter
    // i spacje - inaczej wgranie zdjecia jest niedostepne z klawiatury.
    fireEvent.keyDown(tile, { key: "Enter" });
    fireEvent.keyDown(tile, { key: " " });
    fireEvent.keyDown(tile, { key: "a" });
    fireEvent.click(photoButton("Wgraj zdjęcie"));

    expect(click).toHaveBeenCalledTimes(4);
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
