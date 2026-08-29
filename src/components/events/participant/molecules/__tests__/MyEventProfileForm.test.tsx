// PROFIL UCZESTNIKA NA WYDARZENIU - dane osobowe i to, co zobaczą inni.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. KONTAKT JEST DOMYŚLNIE PRYWATNY. E-mail i telefon trafiają do katalogu
//     uczestników WYŁĄCZNIE po włączeniu przełącznika. Odwrócona wartość
//     domyślna to wyciek numeru telefonu kilkuset osób - i nie zgłasza się
//     sam, bo ekran wygląda tak samo.
//
//  2. PUSTE POLE ZNACZY „WYCZYŚĆ", A NIE „NIE RUSZAJ". `event_my_event_profile_set`
//     rozróżnia brak klucza od jawnej wartości; skasowana treść musi pojechać
//     jako pusty napis, inaczej dane z importu zostają w kartotece jak duchy.
//     Odwrotnie jest z linkami do sieci społecznościowych: puste są POMIJANE,
//     bo baza ma trzymać wyłącznie adresy, które da się kliknąć.
//
//  3. NIEUDANY ZAPIS NIE MOŻE ZJEŚĆ PRACY. Formularz zostaje wypełniony,
//     a komunikat mówi, co się stało - inaczej uczestnik pisze biogram drugi raz.
//
//  4. TRWAJĄCY ZAPIS ODCINA PRZYCISK. Drugie kliknięcie to drugi zapis tej samej
//     kartoteki, a między nimi RPC zdąży odświeżyć formularz.
//
//  5. ZAPIS WSTECZ DO KONTA JEST DECYZJĄ, NIE EFEKTEM UBOCZNYM. Kartoteka
//     wydarzenia bywa CELOWO inna niż wizytówka platformy (inna rola, inna
//     firma). Wyjątek: gdy kartoteki wydarzenia jeszcze nie ma, przełącznik
//     jest wymuszony - to jedyny moment, w którym te dwa zbiory są tożsame.
//
//  6. JĘZYK TREŚCI JEST NIEZALEŻNY OD JĘZYKA INTERFEJSU. Przełącznik nad
//     formularzem zmienia EDYTOWANĄ wersję wpisu; zlanie obu znaczy polski
//     biogram w angielskiej wersji katalogu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Wyboru organizacji - `OrganizationPicker` ma
// WŁASNY plik testowy (wyszukiwarka, zakładanie kartoteki, logo), więc tutaj
// jest atrapą i dowodzimy wyłącznie KOMPOZYCJI: co formularz robi z jego
// wyjściem. (2) Warstwy zapisu (`useMyEventPanel`, `myEventProfileApi`) - mają
// własne pliki w `src/lib/events/__tests__/`.
//
// Asercje idą po KLUCZACH i18n (parytetu PL/EN pilnują osobne bramki
// słownikowe) oraz po ARGUMENTACH warstwy sieciowej.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type {
  MyAccountSnapshot,
  MyEventPanelState,
  MyEventProfile,
  MyEventProfileInput,
} from "@/lib/events/myEventProfileApi";

const h = vi.hoisted(() => ({
  jezyk: { current: "pl" },
  auth: {
    current: { user: { id: "u-1" } as { id: string } | null, tenantId: "t-1" as string | null },
  },
  save: vi.fn(),
  sync: vi.fn(),
  upload: vi.fn(),
  register: vi.fn(),
  rpc: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.jezyk.current),
);

vi.mock("@/lib/i18n-cart", () => ({ ensureI18n: () => {} }));

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth.current }));

vi.mock("@tanstack/react-start", () => ({ useServerFn: () => h.register }));

vi.mock("@/lib/media.functions", () => ({ registerMediaUpload: { __serverFn: true } }));

vi.mock("@/lib/media/upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media/upload")>()),
  uploadAndRegisterMedia: (args: unknown) => h.upload(args),
}));

// Brand firmy czytamy prawdziwym hookiem - liczy się, czy logotyp z CRM trafia
// do linii tożsamości, a nie sposób jego pobrania.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => h.rpc(fn, args) },
}));

// Warstwa zapisu jest atrapą; hooki `useSaveMyEventProfile` /
// `useSyncMyEventProfileFromAccount` zostają prawdziwe, żeby test przechodził
// przez ten sam `useMutation` co produkcja (stan `isPending`, kolejność wywołań).
vi.mock("@/lib/events/myEventProfileApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/myEventProfileApi")>()),
  saveMyEventProfile: (input: MyEventProfileInput) => h.save(input),
  syncMyEventProfileFromAccount: (slug: string) => h.sync(slug),
}));

// Wybór organizacji ma własny plik testowy; tutaj potrzebujemy wyłącznie
// sterowalnego wyjścia `onChange`, żeby sprawdzić, co formularz z nim robi.
vi.mock("@/components/events/participant/molecules/OrganizationPicker", () => ({
  OrganizationPicker: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    companyId: string | null;
    onChange: (company: { id: string | null; name: string }) => void;
  }) => (
    <div>
      <label htmlFor="atrapa-organizacja">{label}</label>
      <input
        id="atrapa-organizacja"
        value={value}
        onChange={(event) => onChange({ id: null, name: event.target.value })}
      />
      <button type="button" onClick={() => onChange({ id: "org-77", name: "ACME Europe" })}>
        atrapa-wybierz-z-katalogu
      </button>
    </div>
  ),
}));

const { MyEventProfileForm } =
  await import("@/components/events/participant/molecules/MyEventProfileForm");

const SLUG = "kongres-2026";

/** Kartoteka wydarzenia z samymi pustymi polami - stan świeżego zgłoszenia. */
function pustyProfil(over: Partial<MyEventProfile> = {}): MyEventProfile {
  return {
    personId: "p-1",
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    emailVisible: false,
    phoneVisible: false,
    jobTitle: null,
    companyId: null,
    companyText: null,
    industry: null,
    specialization: null,
    seekingPl: null,
    seekingEn: null,
    offeringPl: null,
    offeringEn: null,
    socialProfileUrl: null,
    socialLinks: {},
    photoUrl: null,
    bioPl: null,
    bioEn: null,
    ...over,
  };
}

function pelnyProfil(over: Partial<MyEventProfile> = {}): MyEventProfile {
  return pustyProfil({
    firstName: "Anna",
    lastName: "Kowalska",
    email: "anna@example.org",
    phone: "+48 600 000 000",
    jobTitle: "Dyrektorka",
    companyId: "org-1",
    companyText: "ACME",
    industry: "Energia",
    specialization: "Regulacje",
    seekingPl: "Partner w Czechach\nDostawca paneli",
    seekingEn: "Partner in Czechia",
    offeringPl: "Doradztwo",
    offeringEn: "Consulting",
    socialLinks: { linkedin: "https://www.linkedin.com/in/anna" },
    photoUrl: "https://cdn.example/anna.jpg",
    bioPl: "Polski biogram",
    bioEn: "English bio",
    ...over,
  });
}

function konto(over: Partial<MyAccountSnapshot> = {}): MyAccountSnapshot {
  return {
    firstName: "Jan",
    lastName: "Nowak",
    email: "jan@example.org",
    phone: "+48 601 111 111",
    jobTitle: "Analityk",
    companyId: "org-2",
    companyText: "Instytut",
    specialization: "Energetyka",
    seekingPl: "Kontakt w KE",
    seekingEn: "Contact in EC",
    offeringPl: "Analizy",
    offeringEn: "Analysis",
    photoUrl: null,
    bioPl: "Biogram z konta",
    bioEn: "Account bio",
    socialLinks: {},
    ...over,
  };
}

const STAN_PO_ZAPISIE: MyEventPanelState = { profile: null, account: null, registration: null };

interface Props {
  profile?: MyEventProfile | null;
  account?: MyAccountSnapshot | null;
  loading?: boolean;
}

function renderForm(props: Props = {}) {
  const wlasciwosci = {
    profile: props.profile === undefined ? pustyProfil() : props.profile,
    account: props.account === undefined ? null : props.account,
    loading: props.loading ?? false,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MyEventProfileForm slug={SLUG} {...wlasciwosci} />
    </QueryClientProvider>,
  );
  const przerysuj = (zmiana: Props) =>
    view.rerender(
      <QueryClientProvider client={client}>
        <MyEventProfileForm slug={SLUG} {...wlasciwosci} {...zmiana} />
      </QueryClientProvider>,
    );
  return { ...view, przerysuj };
}

const pole = (klucz: string) =>
  screen.getByLabelText(`eventMe.fields.${klucz}`) as HTMLInputElement;
const link = (klucz: string) =>
  screen.getByLabelText(`eventMe.social.${klucz}`) as HTMLInputElement;
const biogram = () => screen.getByPlaceholderText("eventMe.fields.bioHint") as HTMLTextAreaElement;
const zapisz = () => screen.getByRole("button", { name: /^eventMe\.(save|saving)$/ });
const plik = () => document.querySelector('input[type="file"]') as HTMLInputElement;

/**
 * Lista punktów ma `aria-label` na kontenerze, ale ten sam napis nosi też
 * nieprzypisana etykieta nad nią - stąd zapytanie po atrybucie zamiast
 * `getByLabelText`, które trafiałoby w dwa elementy naraz.
 */
const punkty = (klucz: "seeking" | "offering") =>
  document.querySelector(`[aria-label="eventMe.fields.${klucz}"]`) as HTMLElement;
const punkt = (klucz: "seeking" | "offering", nr: number) =>
  screen.getByLabelText(`eventMe.fields.${klucz} ${nr}`) as HTMLInputElement;

/** Ostatni ładunek, który poszedł do `event_my_event_profile_set`. */
function ostatniZapis(): MyEventProfileInput {
  const wywolania = h.save.mock.calls;
  return wywolania[wywolania.length - 1][0] as MyEventProfileInput;
}

async function wyslij() {
  fireEvent.click(zapisz());
  await waitFor(() => expect(h.save).toHaveBeenCalled());
}

/** Podaje plik ukrytemu inputowi (happy-dom nie pozwala pisać po `files`). */
async function podajZdjecie(file = new File(["x"], "foto.png", { type: "image/png" })) {
  const input = plik();
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    fireEvent.change(input);
  });
}

function nigdy(): Promise<never> {
  return new Promise<never>(() => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  h.jezyk.current = "pl";
  h.auth.current = { user: { id: "u-1" }, tenantId: "t-1" };
  h.save.mockResolvedValue(STAN_PO_ZAPISIE);
  h.sync.mockResolvedValue(STAN_PO_ZAPISIE);
  h.rpc.mockResolvedValue({ data: null, error: null });
});

describe("MyEventProfileForm - zanim formularz w ogóle powstanie", () => {
  it("WCZYTYWANIE pokazuje szkielet zamiast pustych pól do wypełnienia", () => {
    // Pusty formularz pokazany przed danymi kusi, żeby zacząć pisać - a chwilę
    // później efekt serwera nadpisuje wpisaną treść.
    const { container } = renderForm({ loading: true });

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "eventMe.save" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("eventMe.fields.firstName")).not.toBeInTheDocument();
  });

  it("BRAK kartoteki i BRAK konta kończy się zdaniem, a nie formularzem donikąd", () => {
    // Nie ma czego zapisać: RPC odmówiłoby, bo `auth.uid()` nie ma kartoteki
    // w tym wydarzeniu. Formularz byłby pułapką.
    renderForm({ profile: null, account: null });

    expect(screen.getByText("eventMe.noPerson")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "eventMe.save" })).not.toBeInTheDocument();
  });
});

describe("MyEventProfileForm - skąd biorą się wartości pól", () => {
  it("PUSTA kartoteka daje puste pola, a nie napis null w identyfikatorze", () => {
    // `?? ""` w każdym polu jest jedyną barierą między `null` z bazy
    // a napisem „null" wydrukowanym na identyfikatorze uczestnika.
    renderForm({ profile: pustyProfil() });

    expect(pole("firstName").value).toBe("");
    expect(pole("email").value).toBe("");
    expect(pole("industry").value).toBe("");
    expect(biogram().value).toBe("");
    expect(link("linkedin").value).toBe("");
    expect(screen.getAllByText("eventMe.publicPreview.noName").length).toBeGreaterThan(0);
  });

  it("WYPEŁNIONA kartoteka wypełnia pola i podpisuje nagłówek imieniem", () => {
    renderForm({ profile: pelnyProfil() });

    expect(pole("firstName").value).toBe("Anna");
    expect(pole("lastName").value).toBe("Kowalska");
    expect(pole("phone").value).toBe("+48 600 000 000");
    expect(link("linkedin").value).toBe("https://www.linkedin.com/in/anna");
    expect(screen.getAllByText("Anna Kowalska").length).toBeGreaterThan(0);
    expect(screen.queryByText("eventMe.publicPreview.noName")).not.toBeInTheDocument();
  });

  it("BRAK kartoteki wydarzenia, ale JEST konto - formularz startuje z konta", () => {
    // To pierwsze wejście uczestnika w panel: kartoteka powstanie dopiero przy
    // zapisie, a przepisywanie danych z konta ręcznie byłoby karą za rejestrację.
    renderForm({ profile: null, account: konto() });

    expect(pole("firstName").value).toBe("Jan");
    expect(pole("jobTitle").value).toBe("Analityk");
    expect(biogram().value).toBe("Biogram z konta");
  });

  it("kartoteka wydarzenia WYGRYWA z kontem platformy", () => {
    // Podpis na konferencji bywa celowo inny niż wizytówka platformy -
    // nadpisanie go danymi konta cofałoby świadomą decyzję uczestnika.
    renderForm({ profile: pelnyProfil(), account: konto() });

    expect(pole("firstName").value).toBe("Anna");
    expect(pole("jobTitle").value).toBe("Dyrektorka");
  });

  it("NOWA kartoteka z serwera podmienia zawartość formularza", () => {
    // Serwer jest źródłem prawdy: po zapisie albo zmianie osoby formularz musi
    // przejąć wersję z bazy, inaczej ekran pokazuje stan sprzed zapisu.
    const { przerysuj } = renderForm({ profile: pelnyProfil() });
    expect(pole("firstName").value).toBe("Anna");

    przerysuj({ profile: pelnyProfil({ personId: "p-2", firstName: "Barbara" }) });
    expect(pole("firstName").value).toBe("Barbara");
  });
});

describe("MyEventProfileForm - widoczność kontaktu", () => {
  it("e-mail i telefon są DOMYŚLNIE prywatne", async () => {
    // Milczenie znaczy „nie pokazuj". Odwrócona wartość domyślna to wyciek
    // numerów telefonu wszystkich uczestników do katalogu.
    renderForm({ profile: pelnyProfil() });

    expect(screen.getByRole("switch", { name: "eventMe.fields.emailVisible" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "eventMe.fields.phoneVisible" })).not.toBeChecked();

    await wyslij();
    expect(ostatniZapis().email_visible).toBe(false);
    expect(ostatniZapis().phone_visible).toBe(false);
  });

  it("WŁĄCZONA zgoda na e-mail jedzie do zapisu i NIE pociąga za sobą telefonu", async () => {
    // To dwie osobne zgody; wspólny przełącznik ujawniłby numer komuś, kto
    // zgodził się wyłącznie na adres e-mail.
    renderForm({ profile: pelnyProfil() });
    fireEvent.click(screen.getByRole("switch", { name: "eventMe.fields.emailVisible" }));

    await wyslij();
    expect(ostatniZapis().email_visible).toBe(true);
    expect(ostatniZapis().phone_visible).toBe(false);
  });

  it("zgody ZAPISANE w kartotece widać na przełącznikach po wejściu", () => {
    // Bez tego uczestnik, który kiedyś udostępnił numer, widzi przełącznik
    // wyłączony i sądzi, że jest niewidoczny.
    renderForm({ profile: pelnyProfil({ emailVisible: true, phoneVisible: true }) });

    expect(screen.getByRole("switch", { name: "eventMe.fields.emailVisible" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "eventMe.fields.phoneVisible" })).toBeChecked();
  });

  it("WYŁĄCZENIE zgody jedzie do bazy jako `false`, a nie jako brak pola", async () => {
    // Brak klucza znaczy „nie ruszaj" - zgoda zostałaby w bazie włączona.
    renderForm({ profile: pelnyProfil({ phoneVisible: true }) });
    fireEvent.click(screen.getByRole("switch", { name: "eventMe.fields.phoneVisible" }));

    await wyslij();
    expect(ostatniZapis().phone_visible).toBe(false);
  });
});

describe("MyEventProfileForm - co jedzie do bazy", () => {
  it("ZAPIS niesie slug wydarzenia i komplet widocznych pól", async () => {
    renderForm({ profile: pelnyProfil() });
    await wyslij();

    expect(ostatniZapis()).toMatchObject({
      slug: SLUG,
      first_name: "Anna",
      last_name: "Kowalska",
      email: "anna@example.org",
      job_title: "Dyrektorka",
      company_id: "org-1",
      company_text: "ACME",
      industry: "Energia",
      specialization: "Regulacje",
      bio_pl: "Polski biogram",
      bio_en: "English bio",
      photo_url: "https://cdn.example/anna.jpg",
    });
  });

  it("SKASOWANE pole opcjonalne jedzie jako pusty napis, czyli polecenie wyczyszczenia", async () => {
    // Pominięcie klucza znaczyłoby „nie ruszaj" i branża z importu zostałaby
    // w kartotece jak duch, mimo że uczestnik wyczyścił pole na ekranie.
    renderForm({ profile: pelnyProfil() });
    fireEvent.change(pole("industry"), { target: { value: "" } });

    await wyslij();
    expect(ostatniZapis().industry).toBe("");
    expect("industry" in ostatniZapis()).toBe(true);
  });

  it("PUSTY link społecznościowy jest POMIJANY, a nie wysyłany jako pusty napis", async () => {
    // Baza ma trzymać wyłącznie adresy, które da się kliknąć; pusty napis
    // wyrenderowałby w katalogu ikonę prowadzącą donikąd.
    renderForm({ profile: pelnyProfil() });
    await wyslij();

    expect(ostatniZapis().social_links).toEqual({
      linkedin: "https://www.linkedin.com/in/anna",
    });
  });

  it("link społecznościowy jedzie po OBCIĘCIU białych znaków", async () => {
    renderForm({ profile: pustyProfil() });
    fireEvent.change(link("x"), { target: { value: "  https://x.com/anna  " } });

    await wyslij();
    expect(ostatniZapis().social_links).toEqual({ x: "https://x.com/anna" });
  });

  it("link z SAMYCH SPACJI liczy się jak brak linku", async () => {
    // Bez obcięcia w bazie wylądowałby adres „   ", a katalog pokazałby ikonę
    // z odnośnikiem do niczego.
    renderForm({ profile: pelnyProfil() });
    fireEvent.change(link("linkedin"), { target: { value: "   " } });

    await wyslij();
    expect(ostatniZapis().social_links).toEqual({});
  });

  it("UDANY zapis potwierdza zdaniem", async () => {
    renderForm({ profile: pelnyProfil() });
    await wyslij();

    await waitFor(() => expect(h.success).toHaveBeenCalledWith("eventMe.profileSaved"));
    expect(h.error).not.toHaveBeenCalled();
  });

  it("BŁĄD zapisu ZOSTAWIA pracę na ekranie i mówi, co się stało", async () => {
    // Formularz bywa wypełniany kwadrans; wyczyszczenie go po odmowie bazy
    // znaczy, że uczestnik pisze biogram drugi raz - albo rezygnuje.
    h.save.mockRejectedValue(new Error("profil zablokowany"));
    renderForm({ profile: pelnyProfil() });
    fireEvent.change(biogram(), { target: { value: "Nowy, długo pisany biogram" } });
    await wyslij();

    await waitFor(() =>
      expect(h.error).toHaveBeenCalledWith("eventMe.profileSaveError profil zablokowany"),
    );
    expect(biogram().value).toBe("Nowy, długo pisany biogram");
    expect(pole("firstName").value).toBe("Anna");
    expect(h.success).not.toHaveBeenCalled();
  });

  it("TRWAJĄCY zapis odcina przycisk - podwójne kliknięcie to dwa zapisy", async () => {
    h.save.mockImplementation(() => nigdy());
    renderForm({ profile: pelnyProfil() });
    fireEvent.click(zapisz());

    await waitFor(() => expect(zapisz()).toBeDisabled());
    expect(screen.getByRole("button", { name: "eventMe.saving" })).toBeInTheDocument();
    fireEvent.click(zapisz());
    expect(h.save).toHaveBeenCalledTimes(1);
  });
});

describe("MyEventProfileForm - zapis wstecz do konta platformy", () => {
  it("przy ISTNIEJĄCEJ kartotece zapis wstecz jest WYŁĄCZONY i wybieralny", async () => {
    // Kartoteka wydarzenia bywa celowo inna niż wizytówka platformy - domyślne
    // przepisanie zmieniałoby profil, którego nikt nie prosił o zmianę.
    renderForm({ profile: pelnyProfil(), account: konto() });
    const przelacznik = screen.getByRole("switch", { name: /eventMe\.pushAccount/ });

    expect(przelacznik).not.toBeChecked();
    expect(przelacznik).toBeEnabled();
    await wyslij();
    expect(ostatniZapis().push_account).toBe(false);
  });

  it("WŁĄCZONY zapis wstecz jedzie do bazy jako jawna decyzja", async () => {
    renderForm({ profile: pelnyProfil(), account: konto() });
    fireEvent.click(screen.getByRole("switch", { name: /eventMe\.pushAccount/ }));

    await wyslij();
    expect(ostatniZapis().push_account).toBe(true);
  });

  it("BEZ kartoteki wydarzenia zapis wstecz jest WYMUSZONY i nie da się go cofnąć", async () => {
    // To jedyny moment, w którym oba zbiory są tożsame: kartoteka dopiero
    // powstaje z danych konta, więc rozjazd nie ma jak się pojawić.
    renderForm({ profile: null, account: konto() });
    const przelacznik = screen.getByRole("switch", { name: /eventMe\.pushAccount/ });

    expect(przelacznik).toBeChecked();
    expect(przelacznik).toBeDisabled();
    await wyslij();
    expect(ostatniZapis().push_account).toBe(true);
  });
});

describe("MyEventProfileForm - język treści jest niezależny od interfejsu", () => {
  it("POLSKI interfejs startuje od polskiej wersji wpisu", () => {
    h.jezyk.current = "pl";
    renderForm({ profile: pelnyProfil() });

    expect(biogram().value).toBe("Polski biogram");
    expect(screen.getByRole("button", { name: "pl" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "en" })).toHaveAttribute("aria-pressed", "false");
  });

  it("ANGIELSKI interfejs startuje od angielskiej wersji wpisu", () => {
    // Uczestnik z angielskim interfejsem najpierw uzupełnia swoją wersję;
    // start od polskiej kazałby mu przełączać się przy każdym wejściu.
    h.jezyk.current = "en";
    renderForm({ profile: pelnyProfil() });

    expect(biogram().value).toBe("English bio");
    expect(screen.getByRole("button", { name: "en" })).toHaveAttribute("aria-pressed", "true");
  });

  it("PRZEŁĄCZNIK zmienia edytowaną wersję, a obie jadą w jednym zapisie", async () => {
    // Zlanie wersji znaczy polski biogram w angielskiej wersji katalogu -
    // i odwrotnie, przy pierwszym zapisie po przełączeniu.
    renderForm({ profile: pelnyProfil() });
    fireEvent.click(screen.getByRole("button", { name: "en" }));
    expect(biogram().value).toBe("English bio");

    fireEvent.change(biogram(), { target: { value: "Rewritten English bio" } });
    await wyslij();

    expect(ostatniZapis().bio_en).toBe("Rewritten English bio");
    expect(ostatniZapis().bio_pl).toBe("Polski biogram");
  });

  it("punkty czego szukam mają OSOBNE wersje językowe", async () => {
    renderForm({ profile: pelnyProfil() });
    expect(punkt("seeking", 1).value).toBe("Partner w Czechach");

    fireEvent.click(screen.getByRole("button", { name: "en" }));
    expect(punkt("seeking", 1).value).toBe("Partner in Czechia");

    fireEvent.change(punkt("seeking", 1), { target: { value: "Partner in Slovakia" } });
    await wyslij();
    expect(ostatniZapis().seeking_en).toBe("Partner in Slovakia");
    expect(ostatniZapis().seeking_pl).toBe("Partner w Czechach\nDostawca paneli");
  });
});

describe("MyEventProfileForm - punkty czego szukam i co oferuję", () => {
  it("każda linia z bazy to JEDEN edytowalny punkt", () => {
    renderForm({ profile: pelnyProfil() });

    expect(punkt("seeking", 1).value).toBe("Partner w Czechach");
    expect(punkt("seeking", 2).value).toBe("Dostawca paneli");
    expect(punkt("offering", 1).value).toBe("Doradztwo");
  });

  it("przycisk dodawania NIE GUBI już wpisanych punktów ani nie zapisuje niczego", () => {
    // UWAGA: sam przycisk nie dokłada pustego wiersza - to defekt produkcyjny
    // zgłoszony osobno (`commit([...items, ""])` przechodzi przez
    // `parseIntentBullets`, który pustą linię natychmiast odfiltrowuje).
    // Ten przypadek pilnuje granicy, która MUSI trzymać w obie strony: klik nie
    // może skasować istniejących punktów ani wysłać czegokolwiek do bazy.
    renderForm({ profile: pelnyProfil() });
    const dodaj = screen.getAllByRole("button", { name: "eventMe.fields.addBullet" });
    // Kolejność w drzewie: najpierw „czego szukam", potem „co oferuję".
    fireEvent.click(dodaj[0]);

    expect(punkt("seeking", 1).value).toBe("Partner w Czechach");
    expect(punkt("seeking", 2).value).toBe("Dostawca paneli");
    expect(h.save).not.toHaveBeenCalled();
  });

  it("USUNIĘCIE punktu wyrzuca DOKŁADNIE ten punkt, a nie sąsiedni", async () => {
    // Indeks w kluczu jest jedyną rzeczą, która wiąże przycisk z linią;
    // pomyłka o jeden kasuje cudzą treść bez ostrzeżenia.
    renderForm({ profile: pelnyProfil() });
    fireEvent.click(screen.getByRole("button", { name: "eventMe.fields.seeking 1 - usuń" }));

    expect(punkt("seeking", 1).value).toBe("Dostawca paneli");
    await wyslij();
    expect(ostatniZapis().seeking_pl).toBe("Dostawca paneli");
  });

  it("EDYCJA punktu zmienia tylko jego linię, a całość jedzie z nowymi liniami", async () => {
    renderForm({ profile: pelnyProfil() });
    fireEvent.change(punkt("seeking", 2), { target: { value: "Dostawca falowników" } });

    await wyslij();
    expect(ostatniZapis().seeking_pl).toBe("Partner w Czechach\nDostawca falowników");
  });

  it("po PIĘCIU punktach znika dodawanie, a pojawia się informacja o limicie", () => {
    // Baza i katalog uczestników pokazują maksymalnie pięć punktów; szósty
    // wpisany byłby pracą, której nikt nie zobaczy.
    renderForm({ profile: pelnyProfil({ seekingPl: "a\nb\nc\nd\ne" }) });

    expect(punkty("seeking").textContent).toContain("eventMe.fields.bulletLimit");
    expect(punkty("seeking").querySelector("button[type='button']")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "eventMe.fields.addBullet" }).length).toBe(1);
  });

  it("EDYCJA punktu w „co oferuję” nie miesza się z „czego szukam”", async () => {
    // Obie listy dzielą jeden komponent; pomylona wersja pola znaczy, że wpis
    // o ofercie ląduje w kolumnie z oczekiwaniami - i odwrotnie.
    renderForm({ profile: pelnyProfil() });
    fireEvent.change(punkt("offering", 1), { target: { value: "Doradztwo regulacyjne" } });

    await wyslij();
    expect(ostatniZapis().offering_pl).toBe("Doradztwo regulacyjne");
    expect(ostatniZapis().seeking_pl).toBe("Partner w Czechach\nDostawca paneli");
  });

  it("PUSTE punkty nie tworzą pustych wierszy listy", () => {
    // `parseIntentBullets` obcina i wyrzuca puste linie - inaczej tekst
    // z bazy z podwójnym enterem dawałby dziury w katalogu.
    renderForm({ profile: pelnyProfil({ seekingPl: "Pierwszy\n\n   \nDrugi" }) });

    expect(punkt("seeking", 1).value).toBe("Pierwszy");
    expect(punkt("seeking", 2).value).toBe("Drugi");
    expect(screen.queryByLabelText("eventMe.fields.seeking 3")).not.toBeInTheDocument();
  });
});

describe("MyEventProfileForm - zdjęcie profilowe", () => {
  it("BEZ zdjęcia nie ma czego usuwać - przycisk się nie pokazuje", () => {
    renderForm({ profile: pustyProfil() });

    expect(
      screen.queryByRole("button", { name: /eventMe\.photo\.remove/ }),
    ).not.toBeInTheDocument();
  });

  it("WGRANE zdjęcie podmienia awatar i jedzie do zapisu", async () => {
    h.upload.mockResolvedValue({ publicUrl: "https://cdn.example/nowe.png" });
    renderForm({ profile: pustyProfil({ firstName: "Anna" }) });
    await podajZdjecie();

    await waitFor(() =>
      expect(h.upload).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "t-1", userId: "u-1", subfolder: "event-people" }),
      ),
    );
    expect(await screen.findByAltText("Anna")).toHaveAttribute(
      "src",
      "https://cdn.example/nowe.png",
    );

    await wyslij();
    expect(ostatniZapis().photo_url).toBe("https://cdn.example/nowe.png");
  });

  it("USUNIĘCIE zdjęcia jedzie jako pusty adres, czyli polecenie wyczyszczenia", async () => {
    renderForm({ profile: pelnyProfil() });
    fireEvent.click(screen.getByRole("button", { name: /eventMe\.photo\.remove/ }));

    await wyslij();
    expect(ostatniZapis().photo_url).toBe("");
  });

  it("wgrywanie BEZ najemcy w kontekście kończy się komunikatem, nie ciszą", async () => {
    h.auth.current = { user: { id: "u-1" }, tenantId: null };
    renderForm({ profile: pustyProfil() });
    await podajZdjecie();

    expect(h.error).toHaveBeenCalledWith("eventMe.photo.failed");
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("wgrywanie BEZ zalogowanego użytkownika też się zatrzymuje", async () => {
    h.auth.current = { user: null, tenantId: "t-1" };
    renderForm({ profile: pustyProfil() });
    await podajZdjecie();

    expect(h.error).toHaveBeenCalledWith("eventMe.photo.failed");
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("NIEUDANE wgranie mówi, co się stało, i nie podmienia awatara", async () => {
    h.upload.mockRejectedValue(new Error("plik za duży"));
    renderForm({ profile: pustyProfil({ firstName: "Anna" }) });
    await podajZdjecie();

    await waitFor(() => expect(h.error).toHaveBeenCalledWith("eventMe.photo.failed plik za duży"));
    expect(screen.queryByAltText("Anna")).not.toBeInTheDocument();
  });

  it("ANULOWANY wybór pliku (pusta lista) niczego nie wgrywa", async () => {
    renderForm({ profile: pustyProfil() });
    const input = plik();
    Object.defineProperty(input, "files", { value: [], configurable: true });
    await act(async () => {
      fireEvent.change(input);
    });

    expect(h.upload).not.toHaveBeenCalled();
  });

  it("UPUSZCZENIE pliku na nagłówek idzie tą samą ścieżką co wybór z dysku", async () => {
    h.upload.mockResolvedValue({ publicUrl: "https://cdn.example/drop.png" });
    const { container } = renderForm({ profile: pustyProfil({ firstName: "Anna" }) });
    // Strefa upuszczania nie ma roli dostępnej i mieć jej nie musi: dostępną
    // ścieżką jest przycisk wyboru pliku, a przeciąganie to skrót dla myszy.
    const strefa = container.querySelector("form > div") as HTMLElement;
    await act(async () => {
      fireEvent.dragOver(strefa);
      fireEvent.drop(strefa, {
        dataTransfer: { files: [new File(["x"], "drop.png", { type: "image/png" })] },
      });
    });

    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(await screen.findByAltText("Anna")).toHaveAttribute(
      "src",
      "https://cdn.example/drop.png",
    );
  });

  it("PRZECIĄGNIĘCIE bez pliku niczego nie wgrywa", async () => {
    const { container } = renderForm({ profile: pustyProfil() });
    const strefa = container.querySelector("form > div") as HTMLElement;
    await act(async () => {
      fireEvent.dragOver(strefa);
      fireEvent.dragLeave(strefa);
      fireEvent.drop(strefa, { dataTransfer: { files: [] } });
    });

    expect(h.upload).not.toHaveBeenCalled();
  });

  it("przycisk na awatarze OTWIERA wybór pliku i jest odcięty w trakcie wgrywania", async () => {
    h.upload.mockImplementation(() => nigdy());
    renderForm({ profile: pustyProfil() });
    const otworz = screen.getByRole("button", { name: "eventMe.photo.upload" });
    const klik = vi.spyOn(plik(), "click");

    fireEvent.click(otworz);
    expect(klik).toHaveBeenCalledTimes(1);

    await podajZdjecie();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "eventMe.photo.upload" })).toBeDisabled(),
    );
  });
});

describe("MyEventProfileForm - uzupełnienie z konta platformy", () => {
  it("BEZ konta platformy nie ma przycisku uzupełniania", () => {
    // Nie ma z czego kopiować; przycisk kończyłby się odmową RPC.
    renderForm({ profile: pelnyProfil(), account: null });

    expect(
      screen.queryByRole("button", { name: /eventMe\.syncFromAccount/ }),
    ).not.toBeInTheDocument();
  });

  it("UZUPEŁNIENIE woła RPC dla TEGO wydarzenia i potwierdza zdaniem", async () => {
    renderForm({ profile: pelnyProfil(), account: konto() });
    fireEvent.click(screen.getByRole("button", { name: /eventMe\.syncFromAccount/ }));

    await waitFor(() => expect(h.sync).toHaveBeenCalledWith(SLUG));
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("eventMe.syncDone"));
  });

  it("BŁĄD uzupełniania mówi o sobie, zamiast wyglądać na sukces", async () => {
    h.sync.mockRejectedValue(new Error("brak konta"));
    renderForm({ profile: pelnyProfil(), account: konto() });
    fireEvent.click(screen.getByRole("button", { name: /eventMe\.syncFromAccount/ }));

    await waitFor(() => expect(h.error).toHaveBeenCalledWith("eventMe.syncError"));
    expect(h.success).not.toHaveBeenCalled();
  });

  it("TRWAJĄCE uzupełnianie zmienia podpis i odcina przycisk", async () => {
    h.sync.mockImplementation(() => nigdy());
    renderForm({ profile: pelnyProfil(), account: konto() });
    fireEvent.click(screen.getByRole("button", { name: /eventMe\.syncFromAccount/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /eventMe\.syncing/ })).toBeDisabled(),
    );
    expect(h.sync).toHaveBeenCalledTimes(1);
  });
});

describe("MyEventProfileForm - tożsamość i organizacja", () => {
  it("WYBÓR organizacji z katalogu zapisuje identyfikator RAZEM z nazwą", async () => {
    // Sama nazwa bez identyfikatora zrywa powiązanie z kartoteką CRM, z której
    // katalog uczestników bierze logotyp i stronę firmy.
    renderForm({ profile: pustyProfil() });
    fireEvent.click(screen.getByRole("button", { name: "atrapa-wybierz-z-katalogu" }));

    await wyslij();
    expect(ostatniZapis()).toMatchObject({ company_id: "org-77", company_text: "ACME Europe" });
  });

  it("WPISANA ręcznie organizacja jedzie bez identyfikatora kartoteki", async () => {
    renderForm({ profile: pelnyProfil() });
    fireEvent.change(screen.getByLabelText("eventMe.fields.company"), {
      target: { value: "Firma spoza CRM" },
    });

    await wyslij();
    expect(ostatniZapis()).toMatchObject({ company_id: "", company_text: "Firma spoza CRM" });
  });

  it("LOGOTYP firmy z CRM trafia do linii tożsamości nad formularzem", async () => {
    h.rpc.mockResolvedValue({
      data: {
        id: "org-1",
        name: "ACME",
        logo_url: "https://cdn.example/acme.png",
        website: "https://acme.example",
      },
      error: null,
    });
    renderForm({ profile: pelnyProfil() });

    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("crm_company_brand", { p_name: "ACME" }),
    );
    const odnosnik = await screen.findByRole("link", { name: "ACME" });
    expect(odnosnik).toHaveAttribute("href", "https://acme.example");
  });

  it("firma BEZ kartoteki w CRM zostaje zwykłym napisem, bez odnośnika", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    renderForm({ profile: pelnyProfil() });

    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("crm_company_brand", { p_name: "ACME" }),
    );
    expect(screen.queryByRole("link", { name: "ACME" })).not.toBeInTheDocument();
    expect(screen.getAllByText("ACME").length).toBeGreaterThan(0);
  });

  it("profil BEZ firmy i BEZ stanowiska nie rysuje pustej linii tożsamości", () => {
    // Pusta linia pod nazwiskiem wygląda jak dane, które się nie wczytały.
    renderForm({ profile: pustyProfil({ firstName: "Anna", lastName: "Kowalska" }) });

    expect(screen.queryByText("Dyrektorka")).not.toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalledWith("crm_company_brand", expect.anything());
  });
});

describe("punkty listy intencji i obcinanie białych znaków", () => {
  it("przycisk dodawania NAPRAWDĘ dodaje wiersz - także przy pustej liście", async () => {
    // Zanim to naprawiono, przycisk był MARTWY. Wiersze były wyliczane
    // z `value` przez `parseBullets`, który odsiewa linie puste, więc dopisany
    // pusty punkt znikał w tym samym renderze, w którym powstawał. Uczestnik
    // bez wielolinijkowego tekstu już w bazie nie mógł dodać ANI JEDNEGO
    // punktu - a to jest jedyna droga, żeby cokolwiek o sobie powiedzieć
    // w katalogu uczestników.
    renderForm({ profile: pustyProfil() });

    fireEvent.click(
      within(punkty("seeking")).getByRole("button", { name: "eventMe.fields.addBullet" }),
    );

    expect(punkt("seeking", 1)).toBeInTheDocument();
    expect(punkt("seeking", 1).value).toBe("");
  });

  it("wyczyszczenie wiersza NIE kasuje go w trakcie pisania", async () => {
    // Ten sam mechanizm: skasowanie treści punktu, żeby wpisać ją od nowa,
    // usuwało cały wiersz spod kursora.
    renderForm({ profile: pustyProfil({ seekingPl: "Partner w Czechach" }) });

    fireEvent.change(punkt("seeking", 1), { target: { value: "" } });

    expect(punkt("seeking", 1)).toBeInTheDocument();
    expect(punkt("seeking", 1).value).toBe("");
  });

  it("pusty punkt zostawiony przez uczestnika NIE jedzie do bazy", async () => {
    renderForm({ profile: pustyProfil() });

    fireEvent.click(
      within(punkty("seeking")).getByRole("button", { name: "eventMe.fields.addBullet" }),
    );
    await wyslij();

    expect(ostatniZapis().seeking_pl).toBe("");
  });

  it("pole wyczyszczone do samych SPACJI jedzie jako puste, a nie jako spacje", async () => {
    // `event_people` jest źródłem druku identyfikatorów, więc `"   "` w polu
    // Stanowisko wyczyszczone do spacji to nie jest wyczyszczenie - to spacje na plakietce.
    // Obcinane były dotąd WYŁĄCZNIE linki społecznościowe.
    renderForm({ profile: pustyProfil() });

    fireEvent.change(pole("jobTitle"), { target: { value: "   " } });
    await wyslij();

    expect(ostatniZapis().job_title).toBe("");
  });

  it("białe znaki wokół treści są obcinane, ale treść zostaje", async () => {
    // Odwrotna strona tej samej zasady: obcinamy PRZY ZAPISIE, nie przy
    // wpisywaniu - kasowanie spacji spod kursora uniemożliwiłoby napisanie
    // dwóch słów.
    renderForm({ profile: pustyProfil() });

    fireEvent.change(pole("jobTitle"), { target: { value: "  Dyrektorka biura  " } });
    await wyslij();

    expect(ostatniZapis().job_title).toBe("Dyrektorka biura");
  });
});
