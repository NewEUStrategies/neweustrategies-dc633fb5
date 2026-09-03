// Kreator zgłoszenia kandydata (/zatrudniamy) - ŚCIEŻKI BRZEGOWE: walidacja
// przy rozmyciu pola, awaria wysyłki, odmowa pliku CV, powrót przyciskiem
// „Wstecz" i wyjścia awaryjne `focusFirstError`.
//
// PO CO TEN PLIK ISTNIEJE I DLACZEGO JEST OSOBNY OD `careersApplyForm.test.tsx`.
// Siostrzany plik dowodzi SZCZĘŚLIWEJ DROGI kreatora: trzy kroki w przód,
// bramki „Dalej", komplet payloadu, panel potwierdzenia, powrót stepperem,
// `applySignal`. Robi to dobrze i nie ma sensu tego powtarzać - ale zostawia
// całą obwódkę formularza bez ANI JEDNEGO wywołania. ZMIERZONE na tym HEAD
// (v8, sam plik siostrzany, `--coverage.include` na jednym pliku źródłowym):
// 133/144 linii, 44/55 funkcji, 74/83 gałęzi `CareersApplyForm.tsx`.
// Tych 11 funkcji bez wywołania to nie ozdoby:
//
//   * `blurField` + 6 handlerów `onBlur` (imię, nazwisko, e-mail, telefon,
//     LinkedIn, wiadomość) - CAŁA walidacja przy opuszczeniu pola. Bez dowodu
//     przechodzi bez śladu: rozmycie pokazujące błąd INNEGO pola (bo
//     `stepErrors[field]` bierze się z całego kroku), rozmycie pustego
//     LinkedIna krzyczące o błędzie w polu opcjonalnym, rozmycie „Dlaczego Ty"
//     wystawiające PRZEDWCZESNY błąd braku zgody (zgoda należy do tego samego
//     kroku, więc `validateStep(2, ...)` raportuje ją razem z wiadomością),
//     i wreszcie komunikat bez klucza w słowniku - kandydat widziałby wtedy
//     `careers.form.errors.phoneInvalid` zamiast zdania po polsku;
//   * `catch` wysyłki (linia 327) - jedyne miejsce, w którym kandydat dowiaduje
//     się, że zgłoszenie NIE dotarło. Bez dowodu przechodzi: awaria funkcji
//     serwerowej pokazująca panel „Zgłoszenie dotarło" (czyli kłamstwo wobec
//     osoby z zewnątrz), wyczyszczenie wpisanych danych przy błędzie sieci
//     (kandydat pisze wszystko od nowa) albo przycisk zablokowany na zawsze
//     w stanie „Wysyłanie...";
//   * przycisk „Wstecz" (linia 612) - siostrzany plik cofa się WYŁĄCZNIE
//     stepperem, czyli przez `handleStepSelect`. To dwie różne drogi z dwiema
//     różnymi regułami (stepper w przód waliduje, „Wstecz" nie ma prawa) i ta
//     druga nie była dotknięta;
//   * `onErrorMessage` z pola CV (linia 495, dwie funkcje) - kanał, którym
//     odmowa załącznika wchodzi do stanu błędów rodzica. Bez dowodu przechodzi
//     odmowa pliku, której kandydat NIGDY nie widzi (klucz trafia w próżnię),
//     i odmowa, która zostaje na ekranie po wgraniu poprawnego pliku;
//   * oba wyjścia awaryjne `focusFirstError` (linie 199 i 201).
//
// CO JEST PRZEDMIOTEM DOWODU:
//   1. rozmycie pola waliduje TYLKO to pole: pusty e-mail po rozmyciu imienia
//      milczy, a błędy z kolejnych rozmyć sumują się w banerze („Popraw N
//      pól"); rozmycie NIE woła tostu (toast należy do „Dalej", nie do ruchu
//      kursorem);
//   2. reguły przypisane polom są tymi ze schematu: `emailInvalid` dla śmiecia
//      w e-mailu, `phoneInvalid` dla numeru bez cyfr, `lastNameInvalid` dla
//      nazwiska z cyfrą - a poprawienie wartości czyści błąd OD RAZU
//      (`clearError` przy zmianie), bez czekania na kolejne rozmycie;
//   3. LinkedIn jest opcjonalny: rozmycie pustego pola nie wystawia niczego,
//      rozmycie błędnego adresu wystawia `linkedinInvalid`;
//   4. rozmycie „Dlaczego Ty" NIE wystawia błędu zgody, choć oba pola należą
//      do kroku 3 (dowód, że `blurField` zapisuje wyłącznie swoje pole);
//   5. „Wstecz" cofa krok BEZ walidacji i z zachowaniem wpisanych danych,
//      a w pierwszym kroku nie istnieje;
//   6. odmowa formatu pliku CV: komunikat ze słownika przy sekcji załącznika,
//      pole nietknięte, ZERO wysyłek do magazynu - a wgranie poprawnego pliku
//      ten komunikat gasi;
//   7. zgłoszenie z PLIKIEM (nie linkiem) wysyła ścieżkę przyjętą przez
//      magazyn, oryginalną nazwę pliku i pusty `cv_url`;
//   8. awaria funkcji serwerowej: komunikat błędu ze słownika, brak panelu
//      potwierdzenia, dane w polach nietknięte (także w kroku, z którego już
//      wyszliśmy), BEZ `onRoleChange(null)` - zerowanie wyboru roli na trasie
//      należy wyłącznie do udanej wysyłki - przycisk znów gotowy do próby,
//      komunikat „Wysyłamy zgłoszenie" zgaszony;
//   9. oferta zniknięta z katalogu w trakcie wypełniania (redakcja zdjęła
//      publikację; zapytanie ofert ma `staleTime` 60 s, więc odświeżenie
//      w trakcie wypełniania jest normalnym przebiegiem): zgłoszenie NADAL
//      idzie, a etykietą roli zostaje jej identyfikator - nie pusty napis
//      w temacie wiadomości (gałąź `?? form.role`);
//  10. brak `document` (render serwerowy / przed hydratacją) nie wywraca
//      walidacji - błędy pól ustawiają się normalnie, gaśnie wyłącznie fokus
//      i przewinięcie do pola;
//  11. ZNALEZISKO niżej: link do CV dłuższy niż 500 znaków blokuje wysyłkę
//      BEZ ANI JEDNEGO widocznego komunikatu;
//  12. brak naruszeń axe w kroku 3 Z WIDOCZNYMI BŁĘDAMI (siostrzany plik mierzy
//      axe wyłącznie na czystym kroku 1, a to baner `role="alert"`, opisany
//      `aria-describedby` checkbox i komunikat pod nim są tym, co czytnik
//      ekranu dostaje w najgorszym momencie).
//
// CO JEST ATRAPOWANE I DLACZEGO (granica atrapy = moduł z własnym dowodem):
//   * `@tanstack/react-start` + `@/lib/contact.functions` - funkcja serwerowa
//     wysyłki. Atrapa jest tu KONIECZNA i jest przedmiotem dowodu: tylko przez
//     nią da się wywołać odmowę wysyłki (linia 327). Utwardzenie samej funkcji
//     (rate-limit, scope tenanta, zod, zapis w Contact Center + CRM) ma dowód
//     w `src/lib/__tests__/contactFunctions.test.ts` i w pgTAP;
//   * `@/integrations/supabase/client` - SIEĆ pod `uploadCv`. Notuje bucket
//     i ścieżkę wysyłki oraz udaje `public_tenant_id()`. `uploadCv`
//     i `validateCvFile` zostają PRAWDZIWE, więc odmowa formatu w teście
//     pochodzi z prawdziwej reguły, a nie z atrapy mówiącej „odmawiam";
//   * `@/components/atoms/FormSelect` - Radix Select wymaga pointer API,
//     którego happy-dom nie ma; zamieniony na natywny `<select>` (tak samo jak
//     w pliku siostrzanym). Reguły wyboru pilnuje schemat, a sam atom ma dowód
//     w `src/components/atoms/__tests__/FormSelect.test.tsx`;
//   * `@/lib/careers/useCareerContent` - react-query nad tabelą `career_roles`.
//     Oferty podajemy z WBUDOWANEGO katalogu (`fallbackOffers` + prawdziwy
//     słownik), bo hook ma własny dowód, a tutaj jest tylko źródłem listy ról;
//     ta sama atrapa pozwala udowodnić punkt 9 (oferta znika w trakcie);
//   * `sonner` - toast. Notujemy treść, żeby asercja mierzyła KOMUNIKAT, a nie
//     obecność biblioteki.
//
// CO ZOSTAJE PRAWDZIWE (i dlaczego atrapowanie zamieniłoby plik w test atrapy):
// `@/lib/careers/applicationSchema` (cała walidacja kroku i całości),
// `recruitmentShared.fallbackApplicationMessage`, `CareerCvField` z prawdziwym
// `uploadCv`/`validateCvFile`, `CareerFormStepper`, `CareerFormSuccess`, atomy
// `FloatingInput`/`FloatingTextarea`/`SubscribeButton`, stan Reacta - oraz
// PRAWDZIWY `react-i18next` nad prawdziwą instancją i18next. Atrapa `t`
// zwracająca klucz albo `defaultValue` dowodziłaby wyłącznie tego, że ktoś
// wpisał napis w wywołaniu (kronika `src/test/i18nReal.ts`): tutaj każdy napis
// przechodzi przez `zeSlownika()`, więc zniknięcie klucza `errors.phoneInvalid`
// albo `form.error` OBLEWA test. Tym plik różni się też od siostrzanego, który
// atrapuje `react-i18next` kluczami - dlatego to on mierzy PRZEPŁYW, a ten
// mierzy TREŚĆ komunikatów brzegowych. Parzystość PL/EN pilnuje bramka
// słowników.
//
// ŚWIADOMIE POZA ZAKRESEM (i gdzie mieszka tamten dowód):
//   * reguły walidacji per pole (regexy nazwy/telefonu/linku, granice długości,
//     „CV: plik ALBO link"): `src/lib/careers/__tests__/applicationSchema.test.ts`
//     - tutaj asertujemy WYŁĄCZNIE to, że pole dostało swój komunikat;
//   * kształt ścieżki w buckecie `career-cv`, tenant jako pierwszy segment,
//     rozpoznawanie formatu: `src/lib/careers/__tests__/cvUpload.test.ts`;
//     tutaj ścieżka jest porównywana z tą, którą ZANOTOWAŁ magazyn;
//   * pełna powierzchnia pola CV (stan „wysyłamy", usunięcie pliku, blokada
//     przycisku, dostępność sekcji): `careerCvField.test.tsx`;
//   * szczęśliwa droga kreatora, panel potwierdzenia, `applySignal`, powrót
//     stepperem: `careersApplyForm.test.tsx`;
//   * rzeczywiste przewinięcie i fokus po `requestAnimationFrame`
//     (`scrollIntoView` nie istnieje w happy-dom, a bez layoutu „poza ekranem"
//     jest nieodróżnialne od „na ekranie"): e2e;
//   * RLS bucketu, polityka pól tenanta i zapis zgłoszenia: pgTAP.
//
// ZNALEZISKO 1 (defekt produkcyjny, zachowanie ISTNIEJĄCE zaasertowane).
// Zbyt długi LINK DO CV blokuje wysyłkę CICHO. `cvUrl` ma w schemacie regułę
// `cvUrlLong` (limit 500 znaków), ale zgłasza ją na ścieżce `["cvUrl"]`, a
// `collectErrors` przepuszcza wyłącznie nazwy z `CAREER_FORM_FIELDS` - gdzie
// jest wirtualne pole `cv`, nie `cvUrl`. Skutek zmierzony w teście
// „ZNALEZISKO": `validateApplication` zwraca `ok: false` z PUSTĄ mapą błędów,
// więc `validateStep` też jej nie widzi (kandydat przechodzi oba kroki bez
// przeszkód), a na końcu dostaje toast „Popraw 0 pole", zero komunikatów przy
// polach i skok na krok 1 bez wyjaśnienia. Klucz `careers.form.errors.cvUrlLong`
// istnieje w słowniku i jest nieosiągalny. To samo dotyczy `cvFileName`
// (reguła bez limitu, więc dziś bez skutku). Naprawa mieszka w
// `collectErrors`/`CAREER_FIELD_STEP` (mapowanie `cvUrl` -> `cv`), nie w tym
// teście; test dowodzi stanu, który jest, żeby naprawa go OBLAŁA.
//
// ZNALEZISKO 2 (martwe gałęzie zapasowe - świadomie NIEPOKRYTE, uzasadnienie
// numeryczne na końcu pliku).
//
// RODO: żadnych prawdziwych osób ani treści. Kandydatka zmyślona („Anna
// Kowalska"), adresy wyłącznie w domenie `example.com`, link do CV
// `drive.example.com/...`, nazwy plików zmyślone (`cv-anna-kowalska.pdf`,
// `zyciorys.exe`), tenant `tenant-testowy`. Plik CV nie zawiera treści CV -
// `new File(["x"], ...)` z podmienionym `size`, więc żaden bajt danych
// osobowych nie powstaje.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";

// Stan atrap: wysyłka formularza, toast, magazyn CV i lista ofert (ta ostatnia
// mutowalna, bo punkt 9 dowodzi zachowania po ZNIKNIĘCIU oferty z katalogu).
const h = vi.hoisted(() => {
  interface UploadCall {
    bucket: string;
    path: string;
    contentType?: string;
    upsert?: boolean;
  }
  return {
    submit: vi.fn(async (_args: { data: Record<string, unknown> }) => ({ ok: true })),
    toastError: vi.fn(),
    state: {
      offers: [] as unknown[],
      uploads: [] as UploadCall[],
      rpcCalls: [] as string[],
      tenant: "tenant-testowy" as string | null,
      uploadError: null as { message: string } | null,
    },
  };
});

// Atrapa CZĘŚCIOWA, nie całkowita: `@/lib/i18n` (prawdziwy, bo napisy mają
// pochodzić ze słownika) buduje `currentLang` przez `createIsomorphicFn` z tego
// samego pakietu, więc podmiana całego modułu wywraca import i18n.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.submit,
}));

vi.mock("@/lib/contact.functions", () => ({
  submitContactMessage: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => h.toastError(...args),
    success: vi.fn(),
  },
}));

// Sieć pod `uploadCv` - jedyna atrapa na drodze załącznika. Notuje, CO poszło
// do magazynu, żeby dało się porównać ścieżkę w payloadzie z tą przyjętą.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string) => {
      h.state.rpcCalls.push(name);
      return { data: h.state.tenant, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (
          path: string,
          _file: unknown,
          options: { contentType?: string; upsert?: boolean },
        ) => {
          h.state.uploads.push({ bucket, path, ...options });
          return { data: { path }, error: h.state.uploadError };
        },
      }),
    },
  },
}));

// Radix Select nie działa w happy-dom bez pointer API - natywny `<select>`
// zamiast atomu (ta sama atrapa co w pliku siostrzanym).
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    value,
    onValueChange,
    options,
    error,
    "aria-label": ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: readonly { value: string; label: React.ReactNode }[];
    error?: string | null;
    "aria-label"?: string;
  }) => (
    <>
      <select
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        <option value="" />
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {String(option.label)}
          </option>
        ))}
      </select>
      {error ? <p role="alert">{error}</p> : null}
    </>
  ),
}));

vi.mock("@/lib/careers/useCareerContent", () => ({
  useCareerOffers: () => ({ offers: h.state.offers, isLoading: false }),
}));

// Słownik kariery rejestruje się efektem ubocznym importu (robi to trasa, nie
// komponent), więc plik testu musi go dociągnąć - inaczej `t` zwracałby klucze
// i asercje mierzyłyby brak słownika, nie napisy.
import "@/lib/i18n-careers";
import { realT } from "@/test/i18nReal";
import { fallbackOffers, type CareerOffer } from "@/lib/careers/catalog";
import { MESSAGE_MAX, MESSAGE_MIN } from "@/lib/careers/applicationSchema";
import { CV_BUCKET } from "@/lib/careers/cvUpload";
import { CareersApplyForm } from "@/components/careers/organisms/CareersApplyForm";

const T = realT("pl");
const WSZYSTKIE_OFERTY: CareerOffer[] = fallbackOffers(T);

/** Napis ze słownika + dowód, że klucz ISTNIEJE (i18next bez klucza zwraca klucz). */
function zeSlownika(key: string, opts?: Record<string, unknown>): string {
  const text = opts ? T(key, opts) : T(key);
  expect(text, `brak klucza w słowniku: ${key}`).not.toBe(key);
  return String(text);
}

/** Komunikat pola dokładnie tak, jak składa go `msg()` w komponencie. */
function komunikat(key: string): string {
  return zeSlownika(`careers.form.errors.${key}`, { min: MESSAGE_MIN, max: MESSAGE_MAX });
}

/** Baner i toast „Popraw N pól" - liczba jest częścią komunikatu. */
function podsumowanie(count: number): string {
  return zeSlownika("careers.form.errors.summary", { count });
}

const POLE = {
  firstName: () => zeSlownika("careers.form.firstName"),
  lastName: () => zeSlownika("careers.form.lastName"),
  email: () => zeSlownika("careers.form.email"),
  phone: () => zeSlownika("careers.form.phone"),
  linkedin: () => zeSlownika("careers.form.linkedin"),
  cvUrl: () => zeSlownika("careers.form.cvUrl"),
  department: () => zeSlownika("careers.form.department"),
  role: () => zeSlownika("careers.form.role"),
  seniority: () => zeSlownika("careers.form.seniority"),
  start: () => zeSlownika("careers.form.start"),
  message: () => zeSlownika("careers.form.message"),
};

function renderForm(selectedRoleId: string | null = null) {
  const onRoleChange = vi.fn();
  const utils = render(
    <CareersApplyForm
      id="careers-application"
      lang="pl"
      selectedRoleId={selectedRoleId}
      onRoleChange={onRoleChange}
    />,
  );
  return { ...utils, onRoleChange };
}

function wpisz(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function rozmyj(label: string) {
  fireEvent.blur(screen.getByLabelText(label));
}

function wybierz(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function przyciskDalej() {
  return screen.getByRole("button", { name: zeSlownika("careers.form.next") });
}

function przyciskWyslij() {
  return screen.getByRole("button", { name: zeSlownika("careers.form.submit") });
}

function dalej() {
  fireEvent.click(przyciskDalej());
}

/** Krok 1 - dane kontaktowe. CV zostawiamy wywołującemu (plik ALBO link). */
function wypelnijKontakt() {
  wpisz(POLE.firstName(), "Anna");
  wpisz(POLE.lastName(), "Kowalska");
  wpisz(POLE.email(), "anna.kowalska@example.com");
  wpisz(POLE.phone(), "+48 600 100 200");
}

function wklejLinkCv(url = "drive.example.com/cv-anna-kowalska") {
  wpisz(POLE.cvUrl(), url);
}

/** Krok 2 - dopasowanie. Bez kompletu tych pól schemat nie przepuszcza. */
function wypelnijDopasowanie(role = "analyst_economy") {
  wybierz(POLE.department(), "analysis");
  wybierz(POLE.role(), role);
  wybierz(POLE.seniority(), "mid");
  wybierz(POLE.start(), "month");
}

/** Plik o zadanym rozmiarze BEZ alokowania bajtów (limit CV to 5 MB). */
function plik(name: string, type: string, size = 2048): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function wejsciePliku(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("test: formularz nie ma kontrolki pliku CV");
  return input;
}

/** Wybór pliku CV + domknięcie mikrozadań transferu do magazynu. */
async function wgrajCv(container: HTMLElement, file: File) {
  await act(async () => {
    fireEvent.change(wejsciePliku(container), { target: { files: [file] } });
  });
}

/** Dane wysłane do funkcji serwerowej - jedno miejsce na rozpakowanie. */
function wyslanyPayload(): Record<string, unknown> {
  expect(h.submit).toHaveBeenCalledTimes(1);
  return h.submit.mock.calls[0][0].data;
}

/** Przejście na krok 3 (wiadomość + zgoda) z kompletem poprawnych danych. */
function przejdzDoKroku3(role = "analyst_economy") {
  wypelnijKontakt();
  wklejLinkCv();
  dalej();
  wypelnijDopasowanie(role);
  dalej();
}

beforeEach(() => {
  h.submit.mockClear();
  h.toastError.mockClear();
  h.state.offers = WSZYSTKIE_OFERTY;
  h.state.uploads = [];
  h.state.rpcCalls = [];
  h.state.tenant = "tenant-testowy";
  h.state.uploadError = null;
});

describe("CareersApplyForm: walidacja przy rozmyciu pola", () => {
  it("rozmycie pola wystawia błąd TYLKO tego pola, sumuje je w banerze i NIE woła tostu", () => {
    renderForm();

    // Kursor przeszedł przez imię i je opuścił - kandydat nie kliknął jeszcze
    // „Dalej", więc o pozostałych pustych polach nie ma prawa usłyszeć.
    rozmyj(POLE.firstName());

    expect(screen.getByText(komunikat("firstNameRequired"))).toBeInTheDocument();
    expect(screen.queryByText(komunikat("lastNameRequired"))).toBeNull();
    expect(screen.queryByText(komunikat("emailRequired"))).toBeNull();
    expect(screen.queryByText(komunikat("phoneRequired"))).toBeNull();
    expect(screen.queryByText(komunikat("cvRequired"))).toBeNull();
    expect(screen.getByText(podsumowanie(1))).toBeInTheDocument();
    // Toast należy do „Dalej", nie do ruchu kursorem.
    expect(h.toastError).not.toHaveBeenCalled();

    // Drugie rozmycie DOKŁADA błąd, a nie podmienia go: baner liczy oba.
    wpisz(POLE.lastName(), "K0walska");
    rozmyj(POLE.lastName());

    expect(screen.getByText(komunikat("lastNameInvalid"))).toBeInTheDocument();
    expect(screen.getByText(komunikat("firstNameRequired"))).toBeInTheDocument();
    expect(screen.getByText(podsumowanie(2))).toBeInTheDocument();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("przypisuje polu jego regułę ze schematu, a zmiana wartości gasi błąd bez kolejnego rozmycia", () => {
    renderForm();

    wpisz(POLE.email(), "to-nie-jest-adres");
    rozmyj(POLE.email());
    wpisz(POLE.phone(), "bez-cyfr");
    rozmyj(POLE.phone());

    expect(screen.getByText(komunikat("emailInvalid"))).toBeInTheDocument();
    expect(screen.getByText(komunikat("phoneInvalid"))).toBeInTheDocument();
    expect(screen.getByLabelText(POLE.email())).toHaveAttribute("aria-invalid", "true");

    // Poprawienie e-maila czyści JEGO błąd od razu (`clearError` przy zmianie),
    // a błąd telefonu zostaje - inaczej kandydat traci listę rzeczy do poprawy.
    wpisz(POLE.email(), "anna.kowalska@example.com");

    expect(screen.queryByText(komunikat("emailInvalid"))).toBeNull();
    expect(screen.getByText(komunikat("phoneInvalid"))).toBeInTheDocument();
    expect(screen.getByText(podsumowanie(1))).toBeInTheDocument();
    expect(screen.getByLabelText(POLE.email())).not.toHaveAttribute("aria-invalid");
  });

  it("LinkedIn jest opcjonalny: rozmycie pustego pola milczy, rozmycie błędnego adresu nie", () => {
    renderForm();

    rozmyj(POLE.linkedin());

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(komunikat("linkedinInvalid"))).toBeNull();

    wpisz(POLE.linkedin(), "moj profil zawodowy");
    rozmyj(POLE.linkedin());

    expect(screen.getByText(komunikat("linkedinInvalid"))).toBeInTheDocument();
  });

  it('rozmycie „Dlaczego Ty" nie wystawia błędu zgody, choć zgoda należy do tego samego kroku', () => {
    renderForm();
    przejdzDoKroku3();

    // `validateStep(2, ...)` raportuje razem wiadomość i zgodę - `blurField`
    // ma prawo zapisać wyłącznie pole, które kandydat opuścił.
    rozmyj(POLE.message());

    expect(screen.queryByText(komunikat("consentRequired"))).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("checkbox")).not.toHaveAttribute("aria-invalid");

    // Sama wiadomość ma jedną regułę - limit długości - i ta wychodzi przy
    // rozmyciu z komunikatem, w którym stoi limit ze schematu.
    wpisz(POLE.message(), "x".repeat(MESSAGE_MAX + 1));
    rozmyj(POLE.message());

    expect(screen.getByText(komunikat("messageLong"))).toBeInTheDocument();
    expect(screen.getByText(komunikat("messageLong")).textContent).toContain(String(MESSAGE_MAX));
    expect(screen.queryByText(komunikat("consentRequired"))).toBeNull();
  });
});

describe('CareersApplyForm: powrót przyciskiem „Wstecz"', () => {
  it("cofa krok bez walidacji i z zachowaniem danych, a w pierwszym kroku nie istnieje", () => {
    renderForm();
    const wstecz = zeSlownika("careers.form.back");

    expect(screen.queryByRole("button", { name: wstecz })).toBeNull();

    wypelnijKontakt();
    wklejLinkCv();
    dalej();
    expect(screen.getByText(zeSlownika("careers.form.fitOptional"))).toBeInTheDocument();

    // Krok „Dopasowanie" jest CAŁY pusty - „Wstecz" nie ma prawa go walidować,
    // bo cofanie się nie jest deklaracją „skończyłem".
    fireEvent.click(screen.getByRole("button", { name: wstecz }));

    expect(h.toastError).not.toHaveBeenCalled();
    expect(screen.queryByText(komunikat("departmentRequired"))).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText(POLE.firstName())).toHaveValue("Anna");
    expect(screen.getByLabelText(POLE.email())).toHaveValue("anna.kowalska@example.com");
  });
});

describe("CareersApplyForm: załącznik CV", () => {
  it("odmowa formatu pliku pokazuje komunikat ze słownika, nie rusza magazynu i gaśnie po poprawnym pliku", async () => {
    const { container } = renderForm();

    await wgrajCv(container, plik("zyciorys.exe", "application/x-msdownload", 1024));

    // Komunikat pochodzi z PRAWDZIWEGO `validateCvFile`, a nie z atrapy.
    expect(screen.getByText(komunikat("cvType"))).toBeInTheDocument();
    expect(screen.getByText(podsumowanie(1))).toBeInTheDocument();
    // Odmowa PRZED siecią: ani wysyłki, ani rundy po tenanta.
    expect(h.state.uploads).toEqual([]);
    expect(h.state.rpcCalls).toEqual([]);
    // Pole nietknięte - link do CV nadal jest drogą alternatywną.
    expect(screen.getByLabelText(POLE.cvUrl())).toHaveValue("");

    await wgrajCv(container, plik("cv-anna-kowalska.pdf", "application/pdf"));

    expect(screen.queryByText(komunikat("cvType"))).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("cv-anna-kowalska.pdf")).toBeInTheDocument();
    expect(h.state.uploads).toHaveLength(1);
    expect(h.state.uploads[0].bucket).toBe(CV_BUCKET);
  });

  it("zgłoszenie z wgranym plikiem wysyła ścieżkę przyjętą przez magazyn, nazwę pliku i pusty link", async () => {
    const { container } = renderForm();

    await wgrajCv(container, plik("cv-anna-kowalska.pdf", "application/pdf"));
    wypelnijKontakt();
    dalej();
    wypelnijDopasowanie();
    dalej();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(przyciskWyslij());

    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    const custom = wyslanyPayload().custom as Record<string, unknown>;
    expect(h.state.uploads).toHaveLength(1);
    expect(custom.cv_path).toBe(h.state.uploads[0].path);
    expect(custom.cv_file_name).toBe("cv-anna-kowalska.pdf");
    expect(custom.cv_url).toBe("");
    expect(await screen.findByText(zeSlownika("careers.form.success.title"))).toBeInTheDocument();
  });
});

describe("CareersApplyForm: wysyłka, która się nie udała", () => {
  it("pokazuje komunikat błędu, zostawia dane w polach i pozwala spróbować ponownie", async () => {
    h.submit.mockRejectedValueOnce(new Error("test: funkcja serwerowa odmówiła"));
    const { onRoleChange } = renderForm();
    przejdzDoKroku3();
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(przyciskWyslij());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(zeSlownika("careers.form.error")),
    );
    // Kluczowe: ŻADNEGO panelu „Zgłoszenie dotarło" - to byłoby kłamstwo.
    expect(screen.queryByText(zeSlownika("careers.form.success.title"))).toBeNull();
    // Dane zostają - kandydat nie pisze zgłoszenia od nowa.
    expect(screen.getByRole("checkbox")).toBeChecked();
    // Rola wybrana w kroku 2 zostaje podświetlona na trasie: `onRoleChange(null)`
    // (zerowanie wyboru) należy WYŁĄCZNIE do udanej wysyłki.
    expect(onRoleChange.mock.calls).toEqual([["analyst_economy"]]);
    // Przycisk znów gotowy, komunikat „Wysyłamy zgłoszenie" zgaszony.
    const przycisk = przyciskWyslij();
    expect(przycisk).toBeEnabled();
    expect(przycisk).not.toHaveAttribute("aria-busy");
    expect(screen.queryByText(zeSlownika("careers.form.sendingStatus"))).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: zeSlownika("careers.form.back") }));
    expect(screen.getByLabelText(POLE.seniority())).toHaveValue("mid");
  });

  it("oferta zniknięta z katalogu w trakcie wypełniania nie blokuje wysyłki - etykietą roli zostaje jej identyfikator", async () => {
    const { rerender, onRoleChange } = renderForm();
    przejdzDoKroku3();
    fireEvent.click(screen.getByRole("checkbox"));

    // Redakcja zdjęła publikację roli; zapytanie ofert ma `staleTime` 60 s,
    // więc odświeżenie w trakcie wypełniania formularza jest normalne.
    h.state.offers = [];
    rerender(
      <CareersApplyForm
        id="careers-application"
        lang="pl"
        selectedRoleId={null}
        onRoleChange={onRoleChange}
      />,
    );

    fireEvent.click(przyciskWyslij());

    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    const payload = wyslanyPayload();
    // Bez gałęzi `?? form.role` temat wiadomości kończyłby się dwukropkiem
    // i pustką, a CRM nie wiedziałby, czego dotyczy zgłoszenie.
    expect((payload.custom as Record<string, unknown>).role_label).toBe("analyst_economy");
    expect(payload.subject).toBe(`${zeSlownika("careers.eyebrow")}: analyst_economy`);
    expect((payload.custom as Record<string, unknown>).role).toBe("analyst_economy");
  });
});

describe("CareersApplyForm: wyjścia awaryjne walidacji", () => {
  it("ZNALEZISKO: link do CV dłuższy niż 500 znaków blokuje wysyłkę bez ANI JEDNEGO widocznego błędu", async () => {
    renderForm();

    // Adres poprawny składniowo (przechodzi `cvUrlInvalid`), ale za długi.
    const zaDlugi = `drive.example.com/${"a".repeat(500)}`;
    expect(zaDlugi.length).toBeGreaterThan(500);

    wypelnijKontakt();
    wklejLinkCv(zaDlugi);
    dalej();
    // Krok 1 przepuszcza: `validateStep` nie widzi błędu na ścieżce `cvUrl`.
    expect(screen.getByText(zeSlownika("careers.form.fitOptional"))).toBeInTheDocument();
    wypelnijDopasowanie();
    dalej();
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(przyciskWyslij());

    // Wysyłki nie ma - i to jedyna dobra połowa tego zachowania.
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.submit).not.toHaveBeenCalled();
    // Toast liczy ZERO pól do poprawy, bo mapa błędów jest pusta.
    expect(h.toastError).toHaveBeenCalledWith(podsumowanie(0));
    // Żadnego komunikatu przy żadnym polu i żadnego banera.
    expect(screen.queryAllByRole("alert")).toEqual([]);
    expect(screen.queryByText(komunikat("cvUrlLong"))).toBeNull();
    // ...a kandydat wraca na krok 1 bez wyjaśnienia, z linkiem, który wpisał.
    expect(screen.getByLabelText(POLE.cvUrl())).toHaveValue(zaDlugi);
    expect(screen.queryByRole("button", { name: zeSlownika("careers.form.submit") })).toBeNull();
  });

  it("brak `document` (render serwerowy) nie wywraca walidacji - błędy pól ustawiają się normalnie", () => {
    renderForm();
    const dalejBtn = przyciskDalej();

    // `focusFirstError` jest jedynym miejscem w formularzu, które sięga po DOM
    // (`querySelector` + `scrollIntoView` + `focus`). Przy renderze serwerowym
    // i przed hydratacją `document` nie istnieje, a walidacja nadal MUSI
    // działać - inaczej pierwsze kliknięcie „Dalej" wywraca cały kreator.
    try {
      vi.stubGlobal("document", undefined);
      fireEvent.click(dalejBtn);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(h.toastError).toHaveBeenCalledWith(podsumowanie(5));
    expect(screen.getByText(komunikat("firstNameRequired"))).toBeInTheDocument();
    expect(screen.getByText(komunikat("cvRequired"))).toBeInTheDocument();
    expect(screen.getByText(podsumowanie(5))).toBeInTheDocument();
    // Krok się NIE zmienił - bramka zadziałała bez DOM.
    expect(screen.getByLabelText(POLE.firstName())).toBeInTheDocument();
  });
});

describe("CareersApplyForm: dostępność stanu błędu", () => {
  it("nie ma naruszeń axe w kroku 3 z widocznym banerem i błędem zgody", async () => {
    const { container } = renderForm();
    przejdzDoKroku3();

    fireEvent.click(przyciskWyslij());

    expect(screen.getByText(komunikat("consentRequired"))).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-invalid", "true");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

// GAŁĘZIE ŚWIADOMIE NIEPOKRYTE PO TYM PLIKU (uczciwie, z adresem dowodu).
// Po tym pliku `CareersApplyForm.tsx` ma 144/144 linii, 163/163 instrukcji
// i 55/55 funkcji; zostaje 6 gałęzi z 83 i obie grupy są nieosiągalne
// UCZCIWYM testem w warstwie jednostkowej:
//
//  * `source` i `pageUrl` w payloadzie - gałęzie `typeof window === "undefined"`
//    (linie 295-296). W przeciwieństwie do `document` (test „brak `document`"
//    wyżej), gdzie wystarczy jedna instrukcja bez DOM, tu obie gałęzie CZYTAJĄ
//    `window.location`, więc okna musi nie być przez CAŁĄ wysyłkę. ZMIERZONE
//    sondą na tym HEAD: `vi.stubGlobal("window", undefined)` na czas kliknięcia
//    „Wyślij" wywraca się w `setSending(true)` - React 19 w `dispatchSetState`
//    -> `resolveEventTimeStamp` czyta `window.event`
//    (`TypeError: Cannot read properties of undefined (reading 'event')`,
//    react-dom-client.development.js:22144), czyli test mierzyłby wytrzymałość
//    Reacta na wyjęte okno, nie zachowanie formularza. Dowód mieszka tam, gdzie
//    ten kod naprawdę biegnie bez okna: render serwerowy trasy /zatrudniamy.
//
//  * zapasowe `|| ""` / `|| "open"` w `custom` (linie 298-302). Są nieosiągalne
//    NIE przez brak testu, a przez INWARIANT, którego ten plik dowodzi:
//    `send()` woła się wyłącznie po `validateApplication(payload).ok`, a schemat
//    wymaga działu z `CAREER_DEPARTMENTS`, niepustej roli, poziomu
//    z `CAREER_SENIORITIES` i terminu z `CAREER_START_OPTIONS`. Test
//    „ZNALEZISKO" wyżej pokazuje drugą stronę tej samej reguły: kiedy walidacja
//    całości mówi „nie", `submit` NIE jest wołane ani razu. Gdyby te gałęzie
//    dały się wejść, znaczyłoby to, że do CRM idzie zgłoszenie z brakami -
//    czyli że defektem byłby kod, a nie luka w pomiarze.
