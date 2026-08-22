// Trasa `/profile/` ZAMONTOWANA - pulpit własnego konta. Stała na okrągłym zerze.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
// To pierwszy ekran, jaki widzi zalogowany człowiek po kliknięciu we własne
// nazwisko: tożsamość, kontakt, licznik aktywności, podgląd „jak widzi mnie
// gość" i wejścia do wszystkich podstron konta. Pomyłka nie kończy się tu złym
// pikselem - kończy się tym, że ktoś przestaje ufać własnym danym.
//
//   1. TRZY ROZŁĄCZNE STANY WIERSZA PROFILU. Oczekiwanie na odczyt to
//      wskaźnik, a nie pusty formularz. Profil PUSTY to zaproszenie do
//      uzupełnienia. AWARIA odczytu MUSI być czymś trzecim - a nie jest, i to
//      jest pierwszy zgłoszony tu defekt: `useProfileEditor` nie ma kanału
//      błędu, więc nieudany odczyt renderuje się DOKŁADNIE jak konto świeżo
//      założone („Nienazwany", „Dodaj firmę", „Dodaj telefon"). Człowiek,
//      który dwa lata temu wypełnił profil, widzi go pustego i uzupełnia
//      drugi raz - albo zgłasza utratę danych.
//   2. LICZNIKI AKTYWNOŚCI NIE WOLNO ZMYŚLAĆ. Cztery kafle („zakładki",
//      „autorzy", „kategorie", „tagi") czytają `count` z czterech zapytań
//      liczących i sklejają go z zerem przez `?? 0`. Skutek: licznik, który
//      NIE WRÓCIŁ (awaria, brak sesji, odczyt w locie) pokazuje to samo, co
//      licznik pusty - twarde „0". To drugi zgłoszony tu defekt: człowiek
//      z czterdziestoma zapisanymi artykułami widzi „0" i wnioskuje, że
//      aplikacja skasowała mu zakładki.
//   3. LICZNIK MUSI ZGADZAĆ SIĘ Z LISTĄ, DO KTÓREJ PROWADZI. Każdy kafel jest
//      odnośnikiem do `/profile/bookmarks` albo `/profile/follows`, więc jego
//      zapytanie musi filtrować dokładnie ten sam zbiór, co tamta lista -
//      własny `user_id` ORAZ właściwy `target_type`. Pomyłka w typie pokazuje
//      liczbę obserwowanych tagów pod etykietą „autorzy".
//   4. WŁASNE DANE, NIGDY CUDZE. Każde zapytanie licznika jest zawężone do
//      `user_id` z sesji, a klucz cache niesie identyfikator konta - bez tego
//      przelogowanie pokazuje liczniki poprzedniej osoby. Bez sesji trasa
//      NIE PUKA do bazy ani razu.
//   5. „PODGLĄD JAK GOŚĆ" JEST STREFĄ WYŁĄCZONĄ Z EDYCJI. Przełącznik
//      zdejmuje WSZYSTKIE pola edytowalne, ukrywa zakładkę „Ustawienia"
//      (płeć i miejsce zamieszkania to dane prywatne), ukrywa role
//      i wejście do panelu administracyjnego, a stan propaguje do layoutu
//      i SPRZĄTA po odmontowaniu. Zapomniane sprzątanie zostawia panel bez
//      nawigacji po powrocie z podstrony.
//   6. ADRES JEST KONTRAKTEM Z POWIADOMIENIAMI. `?tab=activity&intro=bridge`
//      przychodzi z powiadomienia o prośbie o wprowadzenie i musi otworzyć
//      właściwą zakładkę ORAZ właściwą zakładkę karty wprowadzeń, także gdy
//      komponent już żyje (drugie powiadomienie w tej samej sesji). Wartość
//      nieznana jest ignorowana po cichu - link ze starszej wersji produktu
//      nie ma prawa wywrócić pulpitu.
//   7. PUSTY NAPIS ZAPISUJE SIĘ JAKO BRAK WARTOŚCI, NIE JAKO PUSTY NAPIS.
//      Każde `onSave` na tej trasie robi `v || null`. Bez tego wyczyszczenie
//      pola zostawia w bazie `""`, które przechodzi przez każdy test
//      „czy pole jest wypełnione" i psuje miernik kompletności profilu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - BRAMKI SESJI: `/profile` zamyka zawartość INLINE (`AuthGate`), nie
//   przekierowaniem, i trzy stany tej bramki (oczekiwanie / 401 / treść) są
//   dowiedzione w `src/routes/__tests__/profileShellRoutes.test.tsx`. Ta trasa
//   jest dzieckiem tamtego layoutu i sama bramki NIE MA - dlatego tutaj
//   dowodzimy czegoś innego: że zamontowana bez sesji nie wykonuje ani jednego
//   zapytania i nie pokazuje cudzych danych.
// - STANU SZUFLADY, ZAKŁADEK `/profile/edit` I TRZECH STANÓW PLANU:
//   `profileShellRoutes.test.tsx`.
// - LICZNIKÓW KONTRA LIST W SAMYCH LISTACH: `profileListRoutes.test.tsx`
//   dowodzi, że `/profile/bookmarks` i `/profile/follows` liczą to, co
//   pokazują. Tutaj przedmiotem dowodu jest ZGODNOŚĆ FILTRA kafla pulpitu
//   z filtrem tamtej listy.
// - WARSTWY DANYCH PROFILU: `src/lib/profile/__tests__/useProfileEditor.test.tsx`
//   dowodzi optymistycznego zapisu, rollbacku i uploadu do Storage. Tutaj hook
//   jest atrapą; dowodzimy, CO trasa mu podaje i jak rysuje jego wynik.
// - ATOMÓW EDYCJI INLINE (`InlineText`, `InlineTextarea`):
//   `src/components/profile/__tests__/inlineEditors.test.tsx`. Tu są markerami,
//   bo przedmiotem dowodu jest KTÓRE pole jest edytowalne i JAKI klucz trafia
//   do `saveField`.
// - SEKCJI DOŚWIADCZENIA / EDUKACJI / UMIEJĘTNOŚCI / ODZNAK / CV:
//   `src/components/profile/__tests__/ProfileExtraSections.test.tsx`.
//   Tu są markerami - dowodzimy, że trasa montuje je z WŁASNYM `userId`
//   i `tenantId` i że bez tenanta w ogóle ich nie montuje.
// - WARSTWY INTENCJI: `ProfileIntentSection.test.tsx`.
// - KART SIECI: `ProfileViewsCard.test.tsx` oraz testy wprowadzeń w
//   `src/lib/network`. Tu są markerami pod kotwicami z powiadomień.
// - DIALOGU WYBORU FIRMY: `CompanyPickerDialog` ma własne testy; tutaj liczy
//   się to, że pulpit go otwiera i oddaje mu fokus.
// - RLS I RPC: polityki `user_bookmarks` / `user_follows` mają pgTAP.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ProfileEditorRow } from "@/lib/profile/useProfileEditor";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

type UploadKind = "avatar" | "cover";
type UploadStatus = "idle" | "uploading" | "success" | "failed";

/** Zapis wywołania `saveField(pole, wartość)` - to jest tu główny dowód. */
interface SavedField {
  readonly field: string;
  readonly value: unknown;
}

const h = vi.hoisted(() => ({
  language: "pl",
  user: { id: "user-me", email: "anna.nowak@example.com" } as {
    id: string;
    email?: string;
  } | null,
  hasSession: true,
  roles: [] as string[],
  isAdmin: false,
  /** Wiersz profilu widziany przez trasę (atrapa `useProfileEditor`). */
  profile: null as ProfileEditorRow | null,
  /** `loading` z `useProfileEditor` - odczyt wiersza profilu w locie. */
  profileLoading: false,
  status: { avatar: "idle", cover: "idle" } as Record<UploadKind, UploadStatus>,
  progress: { avatar: 0, cover: 0 } as Record<UploadKind, number>,
  /** Wywołania `saveField` - pole i wartość, w kolejności. */
  saved: [] as SavedField[],
  /** Wywołania `upload(plik, rodzaj)`. */
  uploads: [] as { name: string; kind: UploadKind }[],
  /** Wartość, którą atrapa edytora inline oddaje przez `onSave`. */
  inlineDraft: "nowa wartość",
  /** Odpowiedź `promptDialog` - `null` = anulowane. */
  promptAnswer: null as string | null,
  /** Zapytania, z jakimi zawołano `promptDialog`. */
  prompts: [] as Record<string, unknown>[],
  /** Kolejne wartości przekazane do `setGuestPreview` (z odmontowaniem). */
  guestPreviewCalls: [] as boolean[],
  /** Ustawienie `theme_options` czytane przez logo firmy. */
  themeOptions: {} as { logo?: { main?: string; main_dark?: string } },
  theme: "light" as "light" | "dark",
  /** Liczniki zwracane przez zapytania liczące; `null` = brak `count`. */
  counts: { bookmarks: 0, authors: 0, categories: 0, tags: 0 } as Record<string, number | null>,
  /** Czy zapytanie liczące ma paść (awaria PostgREST). */
  countsFail: false,
  chain: null as SupabaseFromStub | null,
  /** Propsy zapisane przez atrapy organizmów - klucz to nazwa markera. */
  organism: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
// Rejestracja słowników trasy: efekt uboczny, nie przedmiot dowodu (parytet
// kluczy pilnują bramki `check:i18n-*`).
vi.mock("@/lib/i18n-profile-extras2", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-profile-intent", () => ({ ensureI18n: () => undefined }));

// JEDEN obiekt na moduł, z getterami na pola zmienne per test. Świeży literał
// przy każdym renderze zapętla efekty czytające `user` w tablicy zależności.
vi.mock("@/hooks/useAuth", () => {
  const session = {};
  const auth = {
    get user() {
      return h.user;
    },
    get session() {
      return h.hasSession ? session : null;
    },
    get roles() {
      return h.roles;
    },
    get isAdmin() {
      return h.isAdmin;
    },
    loading: false,
  };
  return { useAuth: () => auth };
});

// Wiersz profilu: hook ma własny plik testowy, więc tu jest atrapą oddającą
// DOKŁADNIE jego kontrakt - w tym brak kanału błędu (`data` spada na wiersz
// pusty, `loading` gaśnie), co jest przedmiotem pierwszego `it.fails`.
vi.mock("@/lib/profile/useProfileEditor", () => ({
  useProfileEditor: () => ({
    get data() {
      return h.profile ?? EMPTY_ROW;
    },
    get loading() {
      return h.profileLoading;
    },
    get status() {
      return h.status;
    },
    get progress() {
      return h.progress;
    },
    saveField: (field: string, value: unknown) => {
      h.saved.push({ field, value });
      return Promise.resolve();
    },
    upload: (file: File, kind: UploadKind) => {
      h.uploads.push({ name: file.name, kind });
      return Promise.resolve();
    },
  }),
}));

vi.mock("@/lib/profile/guestPreviewStore", () => ({
  setGuestPreview: (next: boolean) => h.guestPreviewCalls.push(next),
}));

vi.mock("@/lib/appDialogs", () => ({
  promptDialog: (opts: Record<string, unknown>) => {
    h.prompts.push(opts);
    return Promise.resolve(h.promptAnswer);
  },
}));

vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: () => h.themeOptions,
}));
vi.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({ theme: h.theme }),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const stub = supabaseFromStub();
  h.chain = stub;
  return { supabase: { from: stub.from } };
});

// Radix Select nie otwiera listy pod happy-dom (potrzebuje realnego wskaźnika
// i pomiarów układu), a wybór opcji jest tu całą treścią zachowania: KTÓRA
// wartość płci trafia do `saveField`.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

// Ikony brandów ciągną bibliotekę ikon z bazy - tutaj liczy się wyłącznie to,
// że wiersz kontaktu dostaje ikonę o danej nazwie.
vi.mock("@/components/atoms/BrandIcon", () => ({
  BrandIcon: ({ name, alt }: { name: string; alt?: string }) => (
    <span data-brand-icon={name} aria-hidden={alt ? undefined : true}>
      {alt}
    </span>
  ),
}));

// Atrapy edytorów inline: MARKER + zapis propsów + jedno kliknięcie oddające
// `onSave`. Przedmiotem dowodu jest KTÓRE pole trasa czyni edytowalnym, z jaką
// etykietą, i jaki klucz trafia potem do `saveField`.
vi.mock("@/components/profile/inline/InlineText", () => ({
  InlineText: (props: {
    value: string | null | undefined;
    onSave: (next: string) => Promise<void> | void;
    ariaLabel: string;
    placeholder?: string;
    emptyLabel?: string;
    variant?: string;
  }) => (
    <button
      type="button"
      data-testid={`inline:${props.ariaLabel}`}
      data-value={props.value ?? ""}
      data-placeholder={props.placeholder ?? ""}
      data-empty-label={props.emptyLabel ?? ""}
      data-variant={props.variant ?? ""}
      onClick={() => void props.onSave(h.inlineDraft)}
    >
      {props.value ?? props.emptyLabel}
    </button>
  ),
}));
vi.mock("@/components/profile/inline/InlineTextarea", () => ({
  InlineTextarea: (props: {
    value: string | null | undefined;
    onSave: (next: string) => Promise<void> | void;
    ariaLabel: string;
    placeholder?: string;
    emptyLabel?: string;
    rows?: number;
  }) => (
    <button
      type="button"
      data-testid={`area:${props.ariaLabel}`}
      data-value={props.value ?? ""}
      data-placeholder={props.placeholder ?? ""}
      data-rows={String(props.rows ?? "")}
      onClick={() => void props.onSave(h.inlineDraft)}
    >
      {props.value ?? props.emptyLabel}
    </button>
  ),
}));

/** Atrapa organizmu: marker w DOM + zapis propsów. */
function organismStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.organism[name] = props;
    return <div data-testid={name} />;
  };
}

vi.mock("@/components/profile/sections/ProfileExtraSections", () => ({
  ExperienceSection: organismStub("ExperienceSection"),
  EducationSection: organismStub("EducationSection"),
  SkillsSection: organismStub("SkillsSection"),
  // Trzy instancje na jednej zakładce - marker musi nieść `kind`, inaczej test
  // nie odróżni nagród od wzmianek.
  AwardsSection: (props: Record<string, unknown>) => {
    h.organism[`AwardsSection:${String(props.kind)}`] = props;
    return <div data-testid={`AwardsSection:${String(props.kind)}`} />;
  },
  CvSection: organismStub("CvSection"),
}));
vi.mock("@/components/profile/sections/ProfileIntentSection", () => ({
  ProfileIntentSection: organismStub("ProfileIntentSection"),
}));
vi.mock("@/components/profile/VerifiedProfileBadge", () => ({
  VerifiedProfileBadge: organismStub("VerifiedProfileBadge"),
}));
vi.mock("@/components/network/ProfileViewsCard", () => ({
  ProfileViewsCard: organismStub("ProfileViewsCard"),
}));
vi.mock("@/components/network/IntroductionsCard", () => ({
  IntroductionsCard: organismStub("IntroductionsCard"),
}));
vi.mock("@/components/profile/CompanyPickerDialog", () => ({
  CompanyPickerDialog: organismStub("CompanyPickerDialog"),
}));

// `Link` bez pełnego drzewa tras - wspólna atrapa repo renderuje prawdziwy
// `href`, więc asercja czyta CEL odnośnika, a nie sam fakt jego istnienia.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { renderRoute, routeSearchValidator } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import type { Result } from "axe-core";
import { fail, okCount } from "@/test/supabaseChain";
import { Route as ProfileDashboardRoute } from "@/routes/profile.index";

const PATH = "/profile";

/** Wiersz pusty - dokładnie to, co `useProfileEditor` oddaje bez danych. */
const EMPTY_ROW: ProfileEditorRow = {
  display_name: null,
  first_name: null,
  last_name: null,
  job_title: null,
  current_company: null,
  current_company_id: null,
  specialization: null,
  location: null,
  phone: null,
  bio: null,
  avatar_url: null,
  cover_url: null,
  tenant_id: null,
  gender: null,
  linkedin_url: null,
  twitter_url: null,
  verified_at: null,
};

/**
 * Wiersz UZUPEŁNIONY. Dane celowo fikcyjne, adresy wyłącznie w `example.com`
 * / `example.org` (RODO w fixtures - §8 zadania).
 */
function filledRow(overrides: Partial<ProfileEditorRow> = {}): ProfileEditorRow {
  return {
    display_name: "Anna Nowak",
    first_name: "Anna",
    last_name: "Nowak",
    job_title: "Head of EU Affairs",
    current_company: "Instytut Przykładowy",
    current_company_id: "company-1",
    specialization: "Energia",
    location: "Bruksela",
    phone: "+32 2 000 00 00",
    bio: "<p>Zajmuję się polityką energetyczną UE.</p>",
    avatar_url: "https://cdn.example.org/avatar.png",
    cover_url: "https://cdn.example.org/cover.png",
    tenant_id: "tenant-alfa",
    gender: "female",
    linkedin_url: "https://www.example.org/in/anna-nowak/",
    twitter_url: "https://example.org/anna",
    verified_at: null,
    ...overrides,
  };
}

function chain(): SupabaseFromStub {
  // STRAŻNIK, nie rzutowanie: atrapa klienta powstaje w fabryce mocka, więc
  // brak przypisania znaczy „mock się nie wykonał" - to błąd testu, nie pustka.
  if (!h.chain) throw new Error("test: atrapa `supabase.from` nie została utworzona");
  return h.chain;
}

/** Wartość drugiego `.eq()` w łańcuchu licznika obserwacji (`target_type`). */
function targetTypeOf(recorded: RecordedChain): string | undefined {
  for (const call of recorded.calls) {
    if (call.method !== "eq") continue;
    const [column, value] = call.args;
    if (column === "target_type" && typeof value === "string") return value;
  }
  return undefined;
}

/** Odpowiedzi zapytań liczących - jeden responder na obie tabele. */
function planCounts(): void {
  chain().setResponse("user_bookmarks", () =>
    h.countsFail ? fail("licznik zakładek padł") : countResult(h.counts.bookmarks),
  );
  chain().setResponse("user_follows", (recorded) => {
    if (h.countsFail) return fail("licznik obserwacji padł");
    const type = targetTypeOf(recorded);
    const key = type === "author" ? "authors" : type === "category" ? "categories" : "tags";
    return countResult(h.counts[key]);
  });
}

/**
 * Wynik zapytania liczącego. `null` znaczy „PostgREST nie oddał licznika" -
 * odpowiedź bez błędu i bez `count`, czyli dokładnie to, co widzi trasa przy
 * nagłówku `Content-Range` bez zakresu.
 */
function countResult(value: number | null) {
  return value === null ? { data: null, error: null } : okCount(value);
}

async function mount(search = "") {
  return renderRoute({
    route: ProfileDashboardRoute,
    path: PATH,
    initialEntry: `/profile${search}`,
  });
}

/**
 * Element „pastylki meta" o danej treści. Ta sama etykieta („dodaj miejsce")
 * pojawia się DRUGI raz w sekcji kontaktu, jako `emptyLabel` pola inline, więc
 * `getByText` widzi dwa dopasowania i wywala się na niejednoznaczności.
 * Pastylka to jedyne dopasowanie, nad którym nie stoi atrapa pola inline.
 */
function metaPill(text: string): HTMLElement {
  const matches = screen
    .getAllByText(text)
    .filter(
      (el) => !el.closest("[data-testid^='inline:']") && !el.closest("[data-testid^='area:']"),
    );
  if (matches.length !== 1) {
    throw new Error(`test: oczekiwano jednej pastylki o treści ${text}, jest ${matches.length}`);
  }
  return matches[0];
}

/**
 * `returnFocusRef.current` z propsów atrapy dialogu. STRAŻNIK, nie rzutowanie.
 *
 * DLACZEGO OSOBNA FUNKCJA: asercja `toMatchObject({ current: element })` na
 * węźle DOM schodzi w głąb grafu happy-dom (parentNode -> document -> ...)
 * i plik testowy stoi do timeoutu BEZ ANI JEDNEJ LINII wyjścia. Fokus
 * porównujemy TOŻSAMOŚCIOWO.
 */
function focusTarget(props: Record<string, unknown> | undefined): unknown {
  const ref = props?.returnFocusRef;
  if (ref === null || typeof ref !== "object" || !("current" in ref)) {
    throw new Error("test: dialog wyboru firmy nie dostał `returnFocusRef`");
  }
  return ref.current;
}

/**
 * Naruszenia dostępności BEZ artefaktu środowiska. Trasa trzyma dwa ukryte
 * wejścia plików (`<input type="file" hidden>`) pod przyciskami zmiany awatara
 * i tła. W przeglądarce `hidden` znaczy `display: none`, więc tych pól nie ma
 * w drzewie dostępności - happy-dom nie stosuje arkusza UA, więc axe widzi je
 * jako WIDOCZNE pola formularza bez etykiety. Odsiewamy dokładnie ten jeden
 * kształt, a nie całą regułę `label`: brakująca etykieta przy polu, które
 * użytkownik naprawdę widzi, ma dalej wywalać test.
 */
async function realAxeViolations(container: Element): Promise<Result[]> {
  const found = await axeViolations(container);
  return found.filter(
    (violation) =>
      !violation.nodes.every(
        (node) => node.html.includes('type="file"') && node.html.includes("hidden"),
      ),
  );
}

/** Zakładka nawigacji pulpitu po kluczu etykiety. */
function tabButton(labelKey: string): HTMLElement {
  return screen.getByRole("button", { name: labelKey });
}

/** Kafel licznika: wartość liczbowa spod etykiety. */
function statValue(labelKey: string): string {
  const label = screen.getByText(labelKey);
  const tile = label.parentElement;
  if (!tile) throw new Error("test: kafel licznika bez kontenera");
  const value = tile.querySelector("span:nth-child(2)");
  if (!value) throw new Error("test: kafel licznika bez wartości");
  return value.textContent ?? "";
}

beforeEach(() => {
  h.language = "pl";
  h.user = { id: "user-me", email: "anna.nowak@example.com" };
  h.hasSession = true;
  h.roles = [];
  h.isAdmin = false;
  h.profile = filledRow();
  h.profileLoading = false;
  h.status = { avatar: "idle", cover: "idle" };
  h.progress = { avatar: 0, cover: 0 };
  h.saved = [];
  h.uploads = [];
  h.inlineDraft = "nowa wartość";
  h.promptAnswer = null;
  h.prompts = [];
  h.guestPreviewCalls = [];
  h.themeOptions = {};
  h.theme = "light";
  h.counts = { bookmarks: 0, authors: 0, categories: 0, tags: 0 };
  h.countsFail = false;
  h.organism = {};
  chain().reset();
  planCounts();
});

afterEach(() => cleanup());

describe("kontrakt adresu - `?tab` i `?intro` z powiadomień", () => {
  const validate = () => routeSearchValidator(ProfileDashboardRoute);

  it("przepuszcza znaną zakładkę i znaną rolę wprowadzenia", () => {
    // `/profile?tab=activity&intro=bridge` to CEL linku z powiadomienia
    // o prośbie o wprowadzenie - musi dojść w całości.
    expect(validate()({ tab: "activity", intro: "bridge" })).toEqual({
      tab: "activity",
      intro: "bridge",
    });
  });

  it("każda z pięciu zakładek pulpitu jest adresowalna z linku", () => {
    // Powiadomienia i skróty w produkcie linkują do konkretnej zakładki;
    // wypadnięcie którejkolwiek z walidatora cicho przenosi na „O mnie".
    for (const tab of ["about", "experience", "badges", "activity", "settings"]) {
      expect(validate()({ tab })).toEqual({ tab });
    }
  });

  it("każda z trzech ról karty wprowadzeń jest adresowalna z linku", () => {
    for (const intro of ["bridge", "requester", "target"]) {
      expect(validate()({ intro })).toEqual({ intro });
    }
  });

  it("nieznaną wartość IGNORUJE po cichu, nie wywraca trasy", () => {
    // Link ze starszej wersji produktu (albo ręcznie doklejony parametr) nie ma
    // prawa dać ekranu błędu na własnym pulpicie - fail-soft.
    expect(validate()({ tab: "billing", intro: "wszystko" })).toEqual({});
  });

  it("brak parametrów daje pusty obiekt, nie pola `undefined`", () => {
    // Pole `tab: undefined` w search params trafia do adresu jako `?tab=`,
    // czyli do historii przeglądarki i do udostępnianego odnośnika.
    const result = validate()({});
    expect(result).toEqual({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("odrzuca wartość o właściwej treści, ale niewłaściwym typie", () => {
    // `?tab=about` przychodzi z parsera jako napis; liczba albo tablica znaczy,
    // że ktoś podłożył ładunek - `find` po identyczności to odcina.
    expect(validate()({ tab: ["about"], intro: 1 })).toEqual({});
  });
});

describe("trzy rozłączne stany wiersza profilu", () => {
  it("OCZEKIWANIE: wskaźnik zamiast pustego formularza", async () => {
    // Render pustego formularza w trakcie odczytu mrugałby zaproszeniem
    // „Dodaj firmę" każdemu, kto ma firmę uzupełnioną od dwóch lat.
    h.profileLoading = true;
    await mount();
    expect(screen.queryByTestId("inline:profile.account.displayName")).toBeNull();
    expect(screen.queryByText("profile.tabs.about")).toBeNull();
    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("DANE: pulpit rysuje tożsamość z wiersza profilu", async () => {
    await mount();
    expect(
      screen.getByTestId("inline:profile.account.displayName").getAttribute("data-value"),
    ).toBe("Anna Nowak");
    expect(screen.getByText("Instytut Przykładowy")).toBeTruthy();
    expect(screen.getByTestId("inline:profile.account.jobTitle").getAttribute("data-value")).toBe(
      "Head of EU Affairs",
    );
  });

  it("PUSTKA: profil bez ani jednego pola zaprasza do uzupełnienia", async () => {
    // Konto świeżo założone. Każde puste pole ma dostać zaproszenie z KLUCZA,
    // nie puste miejsce - inaczej nowy człowiek nie wie, że cokolwiek da się
    // tu wpisać.
    h.profile = EMPTY_ROW;
    await mount();
    expect(screen.getByText("profile.inline.addCompany")).toBeTruthy();
    expect(
      screen.getByTestId("inline:profile.account.jobTitle").getAttribute("data-empty-label"),
    ).toBe("profile.inline.addJobTitle");
    expect(screen.getByText("profile.inline.addSpecialization")).toBeTruthy();
    expect(screen.getAllByText("profile.inline.addLocation").length).toBeGreaterThan(0);
  });

  it.fails(
    "DEFEKT: AWARIA odczytu profilu wygląda DOKŁADNIE jak konto świeżo założone",
    async () => {
      // CO JEST NIE TAK. `useProfileEditor` (src/lib/profile/useProfileEditor.ts:102-103)
      // oddaje `data = query.data ?? EMPTY` i `loading = !!uid && query.isLoading`,
      // czyli po ODRZUCONYM zapytaniu `data` to wiersz pusty, a `loading` już
      // zgasło. Trasa (src/routes/profile.index.tsx:181-188) zna wyłącznie te dwa
      // stany, więc nie ma z czego narysować trzeciego.
      //
      // KONSEKWENCJA DLA UŻYTKOWNIKA. Blip PostgREST-a pokazuje osobie
      // z uzupełnionym profilem „Nienazwany", „Dodaj firmę", „Dodaj telefon"
      // i pusty adres e-mail w kontakcie. Część ludzi uzupełni profil po raz
      // drugi (nadpisując dane optymistycznym zapisem), część zgłosi utratę
      // danych. Naprawa: kanał błędu w hooku + osobny stan w trasie.
      h.profile = EMPTY_ROW;
      await mount();
      // Awaria MUSI dać coś innego niż zaproszenie do uzupełnienia.
      expect(screen.queryByText("profile.inline.addCompany")).toBeNull();
    },
  );

  it("odznaka weryfikacji pojawia się tylko dla profilu z datą weryfikacji", async () => {
    // Odznaka to sygnał zaufania - narysowana bez podkładu w bazie jest
    // wprowadzaniem w błąd.
    await mount();
    expect(screen.queryByTestId("VerifiedProfileBadge")).toBeNull();
    cleanup();

    h.profile = filledRow({ verified_at: "2026-01-01T00:00:00.000Z" });
    await mount();
    expect(screen.getByTestId("VerifiedProfileBadge")).toBeTruthy();
    expect(h.organism.VerifiedProfileBadge?.withLabel).toBe(false);
  });
});

describe("skąd bierze się widoczne nazwisko", () => {
  it("imię i nazwisko wygrywają z nazwą wyświetlaną", async () => {
    h.profile = filledRow({ display_name: "annanowak93" });
    await mount();
    // W trybie edycji widać nazwę wyświetlaną, ale nagłówek gościa czyta
    // złożenie imienia i nazwiska - i to ono jedzie do awatara jako `alt`.
    const avatar = screen.getByRole("img", { name: "Anna Nowak" });
    expect(avatar.getAttribute("src")).toBe("https://cdn.example.org/avatar.png");
  });

  it("bez imienia i nazwiska schodzi na nazwę wyświetlaną", async () => {
    h.profile = filledRow({ first_name: null, last_name: null, display_name: "annanowak93" });
    await mount();
    expect(screen.getByRole("img", { name: "annanowak93" })).toBeTruthy();
  });

  it("bez żadnej nazwy schodzi na człon adresu e-mail przed małpą", async () => {
    // Lepszy jest człon adresu niż „Nienazwany" - człowiek rozpoznaje własne
    // konto. Domena NIE MOŻE wyciekać do nagłówka.
    h.profile = filledRow({ first_name: null, last_name: null, display_name: null });
    await mount();
    const avatar = screen.getByRole("img", { name: "anna.nowak" });
    expect(avatar.getAttribute("alt")).not.toContain("example.com");
  });

  it("bez nazwy i bez adresu e-mail schodzi na KLUCZ, nie na pustkę", async () => {
    // Puste `alt` awatara i pusty nagłówek dają ekran bez tożsamości - nie da
    // się poznać, czyje to konto.
    h.profile = EMPTY_ROW;
    h.user = { id: "user-me" };
    await mount();
    expect(
      screen.getByTestId("inline:profile.account.displayName").getAttribute("data-value"),
    ).toBe("profile.account.unnamed");
  });
});

describe("gość kontra zalogowany - własne dane, nigdy cudze", () => {
  it("BEZ SESJI trasa nie wykonuje ANI JEDNEGO zapytania liczącego", async () => {
    // `enabled: !!session && !!user`. Bez tego wyjście z sesji zamienia pulpit
    // w generator odpowiedzi 401 przy każdym wejściu.
    h.user = null;
    h.hasSession = false;
    h.profile = EMPTY_ROW;
    await mount("?tab=activity");
    await waitFor(() => expect(screen.getByText("profile.nav.bookmarks")).toBeTruthy());
    expect(chain().chainsFor("user_bookmarks")).toHaveLength(0);
    expect(chain().chainsFor("user_follows")).toHaveLength(0);
  });

  it("BEZ SESJI nie pokazuje żadnej wartości pola profilu", async () => {
    // Zamontowana bez sesji trasa NIE MA prawa pokazać niczyich danych.
    // Bramka 401 mieszka w layoucie (`AuthGate`, dowód w profileShellRoutes) -
    // tutaj dowodzimy, że sam pulpit jest wtedy pusty, a nie biały.
    h.user = null;
    h.hasSession = false;
    h.profile = EMPTY_ROW;
    await mount();
    expect(
      screen.getByTestId("inline:profile.account.displayName").getAttribute("data-value"),
    ).toBe("profile.account.unnamed");
    expect(screen.queryByTestId("CvSection")).toBeNull();
    expect(document.body.textContent).not.toContain("example.com");
  });

  it("SESJA BEZ UŻYTKOWNIKA też nie puka do bazy", async () => {
    // Stan przejściowy odświeżania tokenu: sesja jest, tożsamości jeszcze nie.
    // Zapytanie z `user!.id` na `undefined` poleciałoby po CAŁEJ tabeli.
    h.user = null;
    h.hasSession = true;
    await mount("?tab=activity");
    await waitFor(() => expect(screen.getByText("profile.nav.bookmarks")).toBeTruthy());
    expect(chain().chainsFor("user_bookmarks")).toHaveLength(0);
  });

  it("każdy licznik jest zawężony do własnego `user_id`", async () => {
    h.counts = { bookmarks: 7, authors: 3, categories: 2, tags: 1 };
    await mount("?tab=activity");
    await waitFor(() => expect(statValue("profile.nav.bookmarks")).toBe("7"));
    const all = [...chain().chainsFor("user_bookmarks"), ...chain().chainsFor("user_follows")];
    expect(all).toHaveLength(4);
    for (const recorded of all) {
      expect(recorded.argsOf("eq")).toEqual(["user_id", "user-me"]);
      // Zapytanie LICZĄCE, nie pobierające - inaczej pulpit ściąga całą
      // tabelę zakładek tylko po to, żeby pokazać jedną liczbę.
      expect(recorded.argsOf("select")).toEqual(["id", { count: "exact", head: true }]);
    }
  });

  it("klucz cache liczników niesie identyfikator konta", async () => {
    // Bez identyfikatora w kluczu przelogowanie na drugie konto pokazuje
    // liczniki poprzedniej osoby, dopóki cache nie zwietrzeje.
    h.counts = { bookmarks: 4, authors: 0, categories: 0, tags: 0 };
    const view = await mount("?tab=activity");
    await waitFor(() => expect(statValue("profile.nav.bookmarks")).toBe("4"));
    expect(view.queryClient.getQueryData(["profile-counts", "user-me"])).toMatchObject({
      bookmarks: 4,
    });
    expect(view.queryClient.getQueryData(["profile-counts", "user-other"])).toBeUndefined();
  });
});

describe("liczniki aktywności kontra listy, do których prowadzą", () => {
  it("każdy kafel liczy dokładnie ten zbiór, który pokaże jego lista", async () => {
    // Pomyłka w `target_type` pokazuje liczbę obserwowanych tagów pod etykietą
    // „autorzy" - a kafel jest odnośnikiem do zakładki autorów.
    h.counts = { bookmarks: 9, authors: 3, categories: 5, tags: 2 };
    await mount("?tab=activity");
    await waitFor(() => expect(statValue("profile.nav.bookmarks")).toBe("9"));
    expect(statValue("profile.follows.tabAuthors")).toBe("3");
    expect(statValue("profile.follows.tabCategories")).toBe("5");
    expect(statValue("profile.follows.tabTags")).toBe("2");
    expect(chain().chainsFor("user_follows").map(targetTypeOf)).toEqual([
      "author",
      "category",
      "tag",
    ]);
  });

  it("kafel prowadzi do listy, którą liczy", async () => {
    await mount("?tab=activity");
    await waitFor(() => expect(screen.getByText("profile.nav.bookmarks")).toBeTruthy());
    const href = (labelKey: string) =>
      screen.getByText(labelKey).closest("a")?.getAttribute("href");
    expect(href("profile.nav.bookmarks")).toBe("/profile/bookmarks");
    expect(href("profile.follows.tabAuthors")).toBe("/profile/follows");
    expect(href("profile.follows.tabCategories")).toBe("/profile/follows");
    expect(href("profile.follows.tabTags")).toBe("/profile/follows");
  });

  it("licznik BEZ SESJI to zero - ta sama gałąź, co odczyt w locie", async () => {
    // ŚWIADOMY OPIS RZECZYWISTOŚCI, nie życzenie: `counts.data?.bookmarks ?? 0`
    // (src/routes/profile.index.tsx:322-347) nie odróżnia „zapytanie jeszcze nie
    // wróciło" od „zapytanie nawet nie poleciało" od „naprawdę zero". Ten test
    // przypina tę jedną gałąź (`counts.data === undefined`); konsekwencję
    // zgłasza `it.fails` poniżej.
    h.user = null;
    h.hasSession = false;
    h.profile = EMPTY_ROW;
    await mount("?tab=activity");
    expect(statValue("profile.nav.bookmarks")).toBe("0");
    expect(statValue("profile.follows.tabTags")).toBe("0");
  });

  it.fails("DEFEKT: AWARIA licznika jest nieodróżnialna od prawdziwego zera", async () => {
    // CO JEST NIE TAK. `queryFn` w src/routes/profile.index.tsx:325-347 czyta
    // `bm.count ?? 0` i NIE PATRZY na `.error`. Odpowiedź błędna nie ma `count`,
    // więc `Promise.all` rozwiązuje się poprawnie z czterema zerami - zapytanie
    // NIGDY nie wchodzi w stan błędu i pulpit nie ma czego pokazać.
    //
    // KONSEKWENCJA DLA UŻYTKOWNIKA. Osoba z czterdziestoma zapisanymi
    // artykułami widzi „0 zakładek" i wnioskuje, że aplikacja je skasowała.
    // Kliknięcie w kafel prowadzi do listy, na której te czterdzieści pozycji
    // JEST - i to jest dokładnie ten rodzaj sprzeczności, po którym człowiek
    // przestaje ufać całemu panelowi.
    h.countsFail = true;
    await mount("?tab=activity");
    const awaria = statValue("profile.nav.bookmarks");
    cleanup();

    h.countsFail = false;
    h.counts = { bookmarks: 0, authors: 0, categories: 0, tags: 0 };
    await mount("?tab=activity");
    await waitFor(() => expect(statValue("profile.nav.bookmarks")).toBe("0"));
    // Awaria i prawdziwe zero MUSZĄ wyglądać inaczej.
    expect(awaria).not.toBe(statValue("profile.nav.bookmarks"));
  });

  it("odpowiedź bez nagłówka licznika nie wywraca pulpitu", async () => {
    // PostgREST bez `Content-Range` oddaje `count: null`. To nie awaria - to
    // brak informacji, i pulpit ma się narysować.
    h.counts = { bookmarks: null, authors: null, categories: null, tags: null };
    await mount("?tab=activity");
    await waitFor(() => expect(screen.getByText("profile.nav.bookmarks")).toBeTruthy());
    expect(statValue("profile.nav.bookmarks")).toBe("0");
  });
});

describe("zakładki - z adresu, z kliknięcia i z NOWEGO linku", () => {
  it("bez parametru otwiera „O mnie”", async () => {
    await mount();
    expect(screen.getByTestId("area:profile.account.bio")).toBeTruthy();
    expect(screen.queryByTestId("ExperienceSection")).toBeNull();
  });

  it("`?tab=badges` otwiera odznaki wprost z linku", async () => {
    await mount("?tab=badges");
    expect(screen.getByTestId("AwardsSection:award")).toBeTruthy();
    expect(screen.queryByTestId("area:profile.account.bio")).toBeNull();
  });

  it("kliknięcie zakładki nie zostawia wpisu w historii", async () => {
    // Zakładka jest stanem lokalnym; wpis w historii znaczyłby, że „wstecz"
    // z pulpitu przełącza zakładki zamiast wyjść na poprzednią stronę.
    const view = await mount();
    fireEvent.click(tabButton("profile.tabs.experience"));
    expect(screen.getByTestId("ExperienceSection")).toBeTruthy();
    expect(view.search()).toEqual({});
  });

  it("NOWY link przestawia zakładkę także wtedy, gdy pulpit już żyje", async () => {
    // Dwa powiadomienia o różne zakładki w tej samej sesji: drugie kliknięcie
    // nie odmontowuje komponentu, więc bez efektu na `?tab` użytkownik zostaje
    // na zakładce z pierwszego powiadomienia.
    const view = await mount("?tab=experience");
    expect(screen.getByTestId("ExperienceSection")).toBeTruthy();
    await view.navigate("/profile?tab=badges");
    await waitFor(() => expect(screen.getByTestId("AwardsSection:award")).toBeTruthy());
    expect(screen.queryByTestId("ExperienceSection")).toBeNull();
  });

  it("aktywna zakładka jest oznaczona podkreśleniem, nie samym kolorem", async () => {
    await mount("?tab=activity");
    const active = tabButton("profile.tabs.activity");
    expect(active.querySelector("span[aria-hidden]")).toBeTruthy();
    expect(tabButton("profile.tabs.about").querySelector("span[aria-hidden]")).toBeNull();
  });
});

describe("zakładka „Doświadczenie” i „Odznaki” - tenant jako warunek", () => {
  it("sekcje dostają WŁASNY identyfikator konta i tenanta", async () => {
    // Sekcje piszą do bazy pod `tenant_id`; pomyłka wkłada wpis
    // doświadczenia do obcej organizacji.
    await mount("?tab=experience");
    for (const name of ["ExperienceSection", "EducationSection", "SkillsSection"]) {
      expect(h.organism[name]).toMatchObject({
        userId: "user-me",
        tenantId: "tenant-alfa",
        editable: true,
      });
    }
  });

  it("trzy rodzaje wyróżnień to trzy OSOBNE sekcje", async () => {
    // Nagroda, wyróżnienie i wzmianka w mediach to trzy różne rzeczy;
    // zlanie ich w jedną listę gubi kontekst każdej z nich.
    await mount("?tab=badges");
    expect(h.organism["AwardsSection:award"]).toMatchObject({ userId: "user-me" });
    expect(h.organism["AwardsSection:recognition"]).toMatchObject({ tenantId: "tenant-alfa" });
    expect(h.organism["AwardsSection:mention"]).toMatchObject({ editable: true });
  });

  it("BEZ TENANTA sekcji nie ma - lepiej pusto niż zapis w nikąd", async () => {
    // Wiersz profilu bez `tenant_id` (konto tuż po rejestracji, przed
    // przypisaniem organizacji) nie ma gdzie zapisać doświadczenia.
    h.profile = filledRow({ tenant_id: null });
    await mount("?tab=experience");
    expect(screen.queryByTestId("ExperienceSection")).toBeNull();
    cleanup();

    await mount("?tab=badges");
    expect(screen.queryByTestId("AwardsSection:award")).toBeNull();
  });

  it("CV na zakładce „O mnie” też wymaga tenanta", async () => {
    await mount();
    expect(h.organism.CvSection).toMatchObject({ userId: "user-me", tenantId: "tenant-alfa" });
    cleanup();

    h.profile = filledRow({ tenant_id: null });
    await mount();
    expect(screen.queryByTestId("CvSection")).toBeNull();
  });
});

describe("zakładka „Aktywność” - kotwice powiadomień i skróty", () => {
  it("karty sieci mają KOTWICE, na które linkują powiadomienia", async () => {
    // `/profile?tab=activity#introductions` to cel powiadomienia
    // `introduction`. Brak `id` w DOM zostawia człowieka na górze strony.
    await mount("?tab=activity");
    expect(document.getElementById("profile-views")).toBeTruthy();
    expect(document.getElementById("introductions")).toBeTruthy();
    expect(screen.getByTestId("ProfileViewsCard")).toBeTruthy();
    expect(screen.getByTestId("IntroductionsCard")).toBeTruthy();
  });

  it("`?intro=bridge` otwiera właściwą zakładkę karty wprowadzeń", async () => {
    await mount("?tab=activity&intro=bridge");
    expect(h.organism.IntroductionsCard).toEqual({ initialRole: "bridge" });
  });

  it("bez `?intro` karta wprowadzeń NIE dostaje pustego propa", async () => {
    // `initialRole: undefined` przestawiłoby kartę na jej własny domyślny stan
    // przy każdym renderze - prop musi po prostu nie istnieć.
    await mount("?tab=activity");
    expect(h.organism.IntroductionsCard).toEqual({});
  });

  it("skróty prowadzą do wszystkich sześciu podstron konta", async () => {
    // Pulpit jest jedynym miejscem, z którego widać cały panel konta bez
    // rozwiniętej nawigacji - zgubiony odnośnik znaczy podstronę nieosiągalną.
    await mount("?tab=activity");
    const targets = [
      ["profile.nav.membership", "/profile/membership"],
      ["profile.nav.interests", "/profile/interests"],
      ["profile.nav.social", "/profile/social"],
      ["profile.nav.billing", "/profile/billing"],
      ["profile.nav.subscription", "/profile/subscription"],
      ["profile.nav.security", "/profile/security"],
    ] as const;
    for (const [key, href] of targets) {
      expect(screen.getByText(key).closest("a")?.getAttribute("href")).toBe(href);
    }
  });
});

describe("zapis pól - pusty napis to BRAK wartości, nie pusty napis", () => {
  it("nazwa wyświetlana, stanowisko, bio, telefon i miejsce idą pod właściwe klucze", async () => {
    await mount();
    fireEvent.click(screen.getByTestId("inline:profile.account.displayName"));
    fireEvent.click(screen.getByTestId("inline:profile.account.jobTitle"));
    fireEvent.click(screen.getByTestId("area:profile.account.bio"));
    fireEvent.click(screen.getByTestId("inline:profile.account.phone"));
    fireEvent.click(screen.getByTestId("inline:profile.account.location"));
    expect(h.saved.map((s) => s.field)).toEqual([
      "display_name",
      "job_title",
      "bio",
      "phone",
      "location",
    ]);
    expect(h.saved.every((s) => s.value === "nowa wartość")).toBe(true);
  });

  it("odnośniki społecznościowe zapisują się pod kluczami kolumn, nie pod nazwą marki", async () => {
    await mount();
    fireEvent.click(screen.getByTestId("inline:LinkedIn"));
    fireEvent.click(screen.getByTestId("inline:X"));
    expect(h.saved.map((s) => s.field)).toEqual(["linkedin_url", "twitter_url"]);
  });

  it("WYCZYSZCZENIE pola zapisuje `null`, nie pusty napis", async () => {
    // `""` w kolumnie przechodzi przez każde `is not null` i psuje miernik
    // kompletności profilu: pole „wypełnione", a na ekranie pusto.
    h.inlineDraft = "";
    await mount();
    fireEvent.click(screen.getByTestId("inline:profile.account.phone"));
    expect(h.saved).toEqual([{ field: "phone", value: null }]);
  });

  it("pole PUSTE nadal jest edytowalne - stanowisko bez wartości", async () => {
    // Osobna gałąź renderu (brak `job_title`), a nie ta sama z inną treścią.
    h.profile = filledRow({ job_title: null });
    await mount();
    const editor = screen.getByTestId("inline:profile.account.jobTitle");
    expect(editor.getAttribute("data-value")).toBe("");
    fireEvent.click(editor);
    expect(h.saved).toEqual([{ field: "job_title", value: "nowa wartość" }]);
  });

  it("nazwa wyświetlana pusta pokazuje w edytorze złożenie imienia i nazwiska", async () => {
    // Edytor startuje od tego, co człowiek widzi na ekranie - inaczej pierwsze
    // kliknięcie wygląda jak utrata nazwy.
    h.profile = filledRow({ display_name: null });
    await mount();
    expect(
      screen.getByTestId("inline:profile.account.displayName").getAttribute("data-value"),
    ).toBe("Anna Nowak");
  });
});

describe("pola przez okno dialogowe - specjalizacja i miejsce zamieszkania", () => {
  it("puste pole otwiera pytanie z KLUCZAMI, nie z gotowym tekstem", async () => {
    h.profile = filledRow({ specialization: null });
    await mount();
    fireEvent.click(screen.getByText("profile.inline.addSpecialization"));
    await waitFor(() => expect(h.prompts).toHaveLength(1));
    expect(h.prompts[0]).toEqual({
      title: "profile.account.specialization",
      confirmLabel: "common.save",
    });
  });

  it("odpowiedź zapisuje się po obcięciu białych znaków", async () => {
    h.promptAnswer = "  Energia  ";
    h.profile = filledRow({ specialization: null });
    await mount();
    fireEvent.click(screen.getByText("profile.inline.addSpecialization"));
    await waitFor(() => expect(h.saved).toEqual([{ field: "specialization", value: "Energia" }]));
  });

  it("ANULOWANIE nie zapisuje niczego", async () => {
    // `null` z dialogu znaczy „zamknąłem okno" - zapis wyczyściłby pole,
    // którego człowiek nawet nie tknął.
    h.promptAnswer = null;
    h.profile = filledRow({ location: null });
    await mount();
    fireEvent.click(metaPill("profile.inline.addLocation"));
    await waitFor(() => expect(h.prompts).toHaveLength(1));
    expect(h.saved).toEqual([]);
  });

  it("odpowiedź z samych spacji czyści pole do `null`", async () => {
    h.promptAnswer = "   ";
    h.profile = filledRow({ location: null });
    await mount();
    fireEvent.click(metaPill("profile.inline.addLocation"));
    await waitFor(() => expect(h.saved).toEqual([{ field: "location", value: null }]));
  });

  it("pole WYPEŁNIONE pokazuje wartość i NIE otwiera dialogu", async () => {
    await mount();
    expect(metaPill("Energia")).toBeTruthy();
    expect(metaPill("Bruksela")).toBeTruthy();
    expect(screen.queryByText("profile.inline.addSpecialization")).toBeNull();
  });
});

describe("firma - dialog wyboru i logo z motywu", () => {
  it("kliknięcie w firmę otwiera dialog i oddaje mu fokus powrotny", async () => {
    // Bez `returnFocusRef` zamknięcie dialogu rzuca fokus na `<body>`
    // i człowiek korzystający z klawiatury zaczyna nawigację od nowa.
    await mount();
    const trigger = screen.getByRole("button", { name: "profile.account.currentCompany" });
    expect(h.organism.CompanyPickerDialog).toMatchObject({ open: false });
    fireEvent.click(trigger);
    await waitFor(() => expect(h.organism.CompanyPickerDialog?.open).toBe(true));
    expect(h.organism.CompanyPickerDialog).toMatchObject({
      currentCompanyId: "company-1",
      currentCompanyName: "Instytut Przykładowy",
    });
    expect(focusTarget(h.organism.CompanyPickerDialog)).toBe(trigger);
  });

  it("pusta firma też otwiera ten sam dialog", async () => {
    h.profile = filledRow({ current_company: null, current_company_id: null });
    await mount();
    fireEvent.click(screen.getByText("profile.inline.addCompany"));
    await waitFor(() => expect(h.organism.CompanyPickerDialog?.open).toBe(true));
    expect(h.organism.CompanyPickerDialog).toMatchObject({ currentCompanyId: null });
  });

  it("motyw jasny bierze wariant podstawowy logo", async () => {
    h.theme = "light";
    h.themeOptions = { logo: { main: "https://cdn.example.org/logo.svg" } };
    await mount();
    const logo = document.querySelector('img[src="https://cdn.example.org/logo.svg"]');
    expect(logo).toBeTruthy();
    // Logo jest dekoracją obok nazwy firmy - czytnik ekranu ma je pomijać.
    expect(logo?.getAttribute("aria-hidden")).toBe("true");
    expect(logo?.getAttribute("alt")).toBe("");
  });

  it("motyw ciemny bierze wariant ciemny logo", async () => {
    h.theme = "dark";
    h.themeOptions = {
      logo: {
        main: "https://cdn.example.org/logo.svg",
        main_dark: "https://cdn.example.org/d.svg",
      },
    };
    await mount();
    expect(document.querySelector('img[src="https://cdn.example.org/d.svg"]')).toBeTruthy();
  });

  it("motyw ciemny bez wariantu ciemnego schodzi na podstawowy", async () => {
    // Brak wariantu to nie powód, żeby zniknąć - lepiej logo o złym kontraście
    // niż brak identyfikacji organizacji.
    h.theme = "dark";
    h.themeOptions = { logo: { main: "https://cdn.example.org/logo.svg" } };
    await mount();
    expect(document.querySelector('img[src="https://cdn.example.org/logo.svg"]')).toBeTruthy();
  });

  it("motyw jasny bez wariantu jasnego schodzi na ciemny", async () => {
    h.theme = "light";
    h.themeOptions = { logo: { main_dark: "https://cdn.example.org/d.svg" } };
    await mount();
    expect(document.querySelector('img[src="https://cdn.example.org/d.svg"]')).toBeTruthy();
  });

  it("BEZ logo w ustawieniach rysuje ikonę zastępczą, nie pusty prostokąt", async () => {
    h.themeOptions = {};
    await mount();
    expect(document.querySelector("img[aria-hidden]")).toBeNull();
    expect(screen.getByRole("button", { name: "profile.account.currentCompany" })).toBeTruthy();
  });
});

describe("sekcja kontaktu - adres, telefon, odnośniki", () => {
  it("adres e-mail pochodzi z sesji i jest KLIKALNY", async () => {
    // Adres jest tylko do odczytu (zmiana idzie przez bramkę bezpieczeństwa),
    // ale musi dać się skopiować i kliknąć.
    await mount();
    const mailto = screen.getAllByRole("link", { name: /anna\.nowak@example\.com/ });
    expect(mailto.length).toBeGreaterThan(0);
    expect(mailto[0]?.getAttribute("href")).toBe("mailto:anna.nowak@example.com");
  });

  it("każdy wiersz kontaktu ma etykietę z KLUCZA", async () => {
    await mount();
    for (const key of ["profile.account.email", "profile.account.phone"]) {
      expect(screen.getAllByLabelText(key).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByLabelText("LinkedIn").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("X").length).toBeGreaterThan(0);
  });
});

describe("„Podgląd jak gość” - strefa bez edycji", () => {
  async function toggleToGuest() {
    const view = await mount();
    fireEvent.click(screen.getByRole("button", { name: "profile.inline.viewAsGuest" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "profile.inline.editMode" })).toBeTruthy(),
    );
    return view;
  }

  it("zdejmuje WSZYSTKIE pola edytowalne", async () => {
    // Podgląd, w którym da się edytować, nie jest podglądem - a przypadkowy
    // zapis w tym trybie człowiek przypisze awarii, nie sobie.
    await toggleToGuest();
    expect(screen.queryByTestId("inline:profile.account.displayName")).toBeNull();
    expect(screen.queryByTestId("area:profile.account.bio")).toBeNull();
    expect(screen.queryByTestId("inline:profile.account.phone")).toBeNull();
    expect(screen.queryByTestId("inline:LinkedIn")).toBeNull();
    expect(screen.queryByTestId("ProfileIntentSection")).toBeNull();
  });

  it("nazwa staje się nagłówkiem pierwszego poziomu", async () => {
    // Gość widzi stronę, która musi mieć jeden `h1` - inaczej czytnik ekranu
    // nie ma od czego zacząć.
    await toggleToGuest();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Anna Nowak");
  });

  it("ukrywa zakładkę „Ustawienia” - płeć i miejsce to dane prywatne", async () => {
    await toggleToGuest();
    expect(screen.queryByRole("button", { name: "profile.tabs.settings" })).toBeNull();
    expect(screen.getByRole("button", { name: "profile.tabs.about" })).toBeTruthy();
  });

  it("wejście w podgląd Z ZAKŁADKI „Ustawienia” przenosi na „O mnie”", async () => {
    // Bez tego człowiek zostaje na zakładce, której nie ma już w nawigacji -
    // pusty ekran bez wyjścia.
    await mount("?tab=settings");
    expect(screen.getByRole("combobox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "profile.inline.viewAsGuest" }));
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(screen.getByText("profile.inline.contactSection")).toBeTruthy();
  });

  it("ukrywa role i wejście do panelu administracyjnego", async () => {
    // Gość nie ma prawa wiedzieć, że patrzy na konto administratora.
    h.roles = ["admin"];
    h.isAdmin = true;
    await toggleToGuest();
    expect(screen.queryByText("profile.role.admin")).toBeNull();
    expect(screen.queryByText("profile.inline.adminPanel")).toBeNull();
  });

  it("pokazuje pasek akcji sieciowych - wyłącznie jako wizualizację", async () => {
    // Wszystkie CTA są nieaktywne (nie da się nawiązać relacji z samym sobą);
    // aktywny przycisk „Dodaj do sieci" na własnym profilu to zaproszenie do
    // wysłania prośby do siebie.
    await toggleToGuest();
    const group = screen.getByRole("group", { name: "network.guestPreview.hint" });
    const buttons = group.querySelectorAll("button");
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button.hasAttribute("disabled")).toBe(true);
      expect(button.getAttribute("aria-disabled")).toBe("true");
    }
    expect(screen.getByText("network.guestPreview.badge")).toBeTruthy();
    expect(screen.getByText("network.guestPreview.follow")).toBeTruthy();
    expect(screen.getByText("network.connect")).toBeTruthy();
    expect(screen.getByText("network.messageAction")).toBeTruthy();
    expect(screen.getByText("network.report")).toBeTruthy();
  });

  it("pasek akcji NIE istnieje w trybie edycji", async () => {
    await mount();
    expect(screen.queryByRole("group", { name: "network.guestPreview.hint" })).toBeNull();
  });

  it("stan podglądu jedzie do layoutu i JEST SPRZĄTANY po odmontowaniu", async () => {
    // Layout `/profile` ukrywa nawigację, gdy podgląd jest włączony. Brak
    // sprzątania zostawia panel bez nawigacji po powrocie z podstrony.
    const view = await toggleToGuest();
    // Środkowe `false` to SPRZĄTANIE poprzedniego przebiegu efektu, nie pomyłka:
    // efekt zależy od `previewAsGuest`, więc React najpierw woła jego funkcję
    // porządkującą, a dopiero potem ustawia nową wartość. Asertujemy pełną
    // sekwencję, bo to ona jest stanem faktycznym - i bo ostatnia wartość jest
    // tym, co widzi layout.
    expect(h.guestPreviewCalls).toEqual([false, false, true]);
    view.unmount();
    expect(h.guestPreviewCalls.at(-1)).toBe(false);
  });

  it("powrót do edycji przywraca pola i zakładkę „Ustawienia”", async () => {
    await toggleToGuest();
    fireEvent.click(screen.getByRole("button", { name: "profile.inline.editMode" }));
    await waitFor(() =>
      expect(screen.getByTestId("inline:profile.account.displayName")).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "profile.tabs.settings" })).toBeTruthy();
  });
});

describe("role i wejście do panelu administracyjnego", () => {
  it("każda rola dostaje własną plakietkę z KLUCZA", async () => {
    h.roles = ["admin", "author"];
    await mount();
    expect(screen.getByText("profile.role.admin")).toBeTruthy();
    expect(screen.getByText("profile.role.author")).toBeTruthy();
  });

  it("bez roli nie ma pustego rzędu plakietek", async () => {
    h.roles = [];
    await mount();
    expect(screen.queryByText("profile.inline.adminPanel")).toBeNull();
  });

  it("wejście do panelu widzi TYLKO administrator", async () => {
    // Odnośnik do `/admin` dla osoby bez uprawnień prowadzi na odmowę -
    // czyli obiecuje dostęp, którego nie ma.
    h.roles = ["author"];
    h.isAdmin = false;
    await mount();
    expect(screen.queryByText("profile.inline.adminPanel")).toBeNull();
    cleanup();

    h.roles = ["admin"];
    h.isAdmin = true;
    await mount();
    expect(screen.getByText("profile.inline.adminPanel").closest("a")?.getAttribute("href")).toBe(
      "/admin",
    );
  });
});

describe("zakładka „Ustawienia” - dane prywatne właściciela", () => {
  it("płeć da się ustawić na każdą z czterech wartości", async () => {
    // Płeć steruje formami gramatycznymi w całym produkcie (powitania, e-maile),
    // więc „automatycznie" MUSI zapisywać się jako brak wyboru, nie jako napis.
    await mount("?tab=settings");
    const select = screen.getByRole("combobox");
    // `value` na `<select>` jest WŁAŚCIWOŚCIĄ, nie atrybutem - `getAttribute`
    // zwróciłoby `null` niezależnie od wyboru, czyli test nie dowodziłby niczego.
    expect(select).toHaveValue("female");
    for (const [option, expected] of [
      ["male", "male"],
      ["neutral", "neutral"],
      ["auto", null],
    ] as const) {
      fireEvent.change(select, { target: { value: option } });
      expect(h.saved.at(-1)).toEqual({ field: "gender", value: expected });
    }
  });

  it("płeć nieustawiona pokazuje wybór „automatycznie”", async () => {
    h.profile = filledRow({ gender: null });
    await mount("?tab=settings");
    expect(screen.getByRole("combobox")).toHaveValue("auto");
    expect(screen.getByText("profile.account.genderAuto")).toBeTruthy();
  });

  it("miejsce zamieszkania ma tu WŁASNĄ etykietę pustki", async () => {
    // W kontakcie pustka zaprasza („Dodaj miejsce"), w ustawieniach informuje
    // („nie ustawiono") - to dwa różne komunikaty i nie wolno ich zlać.
    await mount("?tab=settings");
    expect(
      screen.getByTestId("inline:profile.account.location").getAttribute("data-empty-label"),
    ).toBe("profile.inline.notSet");
  });
});

describe("język interfejsu", () => {
  it("PL: podpowiedź rozmiaru okładki po polsku", async () => {
    h.language = "pl";
    h.profile = filledRow({ cover_url: null });
    await mount();
    expect(screen.getByText(/Zalecane: 1600/)).toBeTruthy();
  });

  it("EN: ta sama podpowiedź po angielsku", async () => {
    h.language = "en";
    h.profile = filledRow({ cover_url: null });
    await mount();
    expect(screen.getByText(/Recommended: 1600/)).toBeTruthy();
  });

  it("wariant regionalny `pl-PL` nadal jest polszczyzną", async () => {
    // i18next oddaje `pl-PL` po detekcji z przeglądarki - porównanie przez
    // równość dałoby angielski komunikat polskiemu użytkownikowi.
    h.language = "pl-PL";
    h.profile = filledRow({ cover_url: null });
    await mount();
    expect(screen.getByText(/Zalecane: 1600/)).toBeTruthy();
  });

  it("nieznany język schodzi na angielski, nie na pustkę", async () => {
    h.language = "de";
    h.profile = filledRow({ cover_url: null });
    await mount();
    expect(screen.getByText(/Recommended: 1600/)).toBeTruthy();
  });
});

describe("dostępność pulpitu", () => {
  it("pulpit w trybie edycji nie ma naruszeń axe", async () => {
    const view = await mount();
    const violations = await realAxeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("pulpit w „Podglądzie jak gość” nie ma naruszeń axe", async () => {
    const view = await mount();
    fireEvent.click(screen.getByRole("button", { name: "profile.inline.viewAsGuest" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "profile.inline.editMode" })).toBeTruthy(),
    );
    const violations = await realAxeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("zakładka „Aktywność” nie ma naruszeń axe", async () => {
    h.counts = { bookmarks: 3, authors: 1, categories: 0, tags: 0 };
    const view = await mount("?tab=activity");
    await waitFor(() => expect(statValue("profile.nav.bookmarks")).toBe("3"));
    const violations = await realAxeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it.fails("DEFEKT: konto BEZ adresu e-mail daje odnośnik bez nazwy", async () => {
    // CO JEST NIE TAK. Wiersz kontaktu (src/routes/profile.index.tsx:487-497)
    // renderuje `<a href={`mailto:${user?.email ?? ""}`}>{user?.email}</a>`
    // BEZWARUNKOWO. Gdy tożsamość nie ma adresu (konto z logowaniem bez adresu,
    // stan przejściowy odświeżania tokenu), powstaje odnośnik z pustą treścią
    // i adresem `mailto:` bez odbiorcy.
    //
    // KONSEKWENCJA DLA UŻYTKOWNIKA. Czytnik ekranu ogłasza „odnośnik" bez
    // nazwy, a kliknięcie otwiera klienta poczty z pustym adresatem. Naprawa
    // jest w tym samym wzorcu, którym trasa rysuje telefon: gdy pola nie ma,
    // wiersz pokazuje kreskę zamiast odnośnika.
    h.user = { id: "user-me" };
    h.profile = filledRow();
    const view = await mount();
    const violations = await realAxeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

/* ======================================================================
   NAGŁÓWEK: TŁO I AWATAR - jedyne miejsce w produkcie, w którym człowiek
   wysyła plik ze swojego dysku na własny profil.
   ====================================================================== */

/** Pudełko tła w nagłówku - nosi obsługę wskaźnika (`hoverCover`). */
function coverBox(): HTMLElement {
  const node = document.querySelector(".h-40");
  if (!(node instanceof HTMLElement)) throw new Error("test: brak pudełka tła w nagłówku");
  return node;
}

/** Pudełko awatara - nosi obsługę wskaźnika (`hoverAvatar`). */
function avatarBox(): HTMLElement {
  const node = document.querySelector(".z-20");
  if (!(node instanceof HTMLElement)) throw new Error("test: brak pudełka awatara");
  return node;
}

/**
 * Ukryte wejścia plików w KOLEJNOŚCI ŹRÓDŁOWEJ: [tło, awatar]. Oba mają tę
 * samą listę `accept`, więc nie da się ich rozróżnić atrybutem - dlatego
 * kolejność jest przedmiotem asercji w testach wysyłki (rodzaj przekazany do
 * `upload()` MUSI zgadzać się z wejściem, na którym zmieniono plik).
 */
function fileInputs(): HTMLInputElement[] {
  return [...document.querySelectorAll("input[type='file']")].filter(
    (node): node is HTMLInputElement => node instanceof HTMLInputElement,
  );
}

/**
 * Postęp wysyłki tak, jak go NAPRAWDĘ widać: przez przesunięcie wskaźnika.
 *
 * ŚWIADOMY OPIS RZECZYWISTOŚCI, nie życzenie. Naturalną asercją byłoby
 * `aria-valuenow`, ale wspólna otoczka `src/components/ui/progress.tsx:10-14`
 * WYŁUSKUJE `value` z propsów i przekazuje go WYŁĄCZNIE do stylu wskaźnika -
 * korzeń Radiksa nigdy go nie dostaje, więc `aria-valuenow` nie istnieje.
 * Postęp jest tu informacją czysto wizualną (konsekwencję zgłasza `it.fails`
 * niżej), a jedyny dowód, że trasa podaje WŁAŚCIWĄ liczbę WŁAŚCIWEMU paskowi,
 * siedzi w tym przesunięciu.
 */
function progressTransform(): string {
  const indicator = screen.getByRole("progressbar").firstElementChild;
  if (!(indicator instanceof HTMLElement)) {
    throw new Error("test: pasek postępu bez wskaźnika");
  }
  return indicator.style.transform;
}

/** Plik obrazu o ustalonej nazwie - żadnych losowych bajtów. */
function imageFile(name: string): File {
  return new File(["pojedynczy-piksel"], name, { type: "image/png" });
}

describe("wysyłka tła - trwa kontra gotowe", () => {
  it("przycisk wysyłki tła prowadzi do wejścia pliku o ZAWĘŻONEJ liście typów", async () => {
    // Lista `accept` jest tu regułą bezpieczeństwa, nie wygodą: `image/svg+xml`
    // na awatarze albo tle to wektor XSS (SVG niesie skrypt), a plik podpisany
    // URL-em ze Storage trafia potem pod domenę produktu.
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "profile.account.uploadCover" }));
    const [cover] = fileInputs();
    expect(cover?.getAttribute("accept")).toBe("image/jpeg,image/png,image/webp,image/avif");
    expect(cover?.hasAttribute("hidden")).toBe(true);
    expect(cover?.getAttribute("accept")).not.toContain("svg");
  });

  it("wskazanie pliku na wejściu TŁA wysyła go jako tło, nie jako awatar", async () => {
    // Pomyłka rodzaju podmienia awatar na obraz 1600x400 - i odwrotnie:
    // tło na kwadrat 400x400 rozciągnięty na całą szerokość.
    await mount();
    fireEvent.change(fileInputs()[0], { target: { files: [imageFile("tlo.png")] } });
    expect(h.uploads).toEqual([{ name: "tlo.png", kind: "cover" }]);
  });

  it("wskazanie pliku na wejściu AWATARA wysyła go jako awatar", async () => {
    await mount();
    fireEvent.change(fileInputs()[1], { target: { files: [imageFile("awatar.png")] } });
    expect(h.uploads).toEqual([{ name: "awatar.png", kind: "avatar" }]);
  });

  it("ANULOWANIE okna wyboru pliku nie wysyła niczego", async () => {
    // Zamknięcie systemowego okna wyboru daje zdarzenie `change` z PUSTĄ listą
    // plików. Wysyłka `undefined` skończyłaby się awarią Storage i toastem
    // o błędzie przy czynności, której człowiek świadomie NIE wykonał.
    await mount();
    fireEvent.change(fileInputs()[0], { target: { files: [] } });
    fireEvent.change(fileInputs()[1], { target: { files: [] } });
    expect(h.uploads).toEqual([]);
  });

  it("TEN SAM plik da się wskazać dwa razy pod rząd", async () => {
    // Wejście pliku jest zerowane po każdym wyborze. Bez tego druga próba
    // wysłania tego samego pliku (po nieudanej pierwszej) nie daje zdarzenia
    // `change` w ogóle - przycisk wygląda na zepsuty.
    await mount();
    const [cover] = fileInputs();
    if (!cover) throw new Error("test: brak wejścia pliku tła");
    fireEvent.change(cover, { target: { files: [imageFile("tlo.png")] } });
    expect(cover.value).toBe("");
    fireEvent.change(cover, { target: { files: [imageFile("tlo.png")] } });
    expect(h.uploads).toHaveLength(2);
  });

  it("WYSYŁKA W TOKU blokuje przycisk, nazywa się inaczej i pokazuje postęp", async () => {
    // Trzy sygnały naraz, bo każdy z nich osobno bywa przeoczony: nazwa
    // („Wysyłanie"), blokada (drugi klik nie zaczyna drugiej wysyłki tego
    // samego pola) i pasek postępu (wiadomo, że coś się dzieje).
    h.status = { avatar: "idle", cover: "uploading" };
    h.progress = { avatar: 0, cover: 42 };
    await mount();
    const button = screen.getByRole("button", { name: "profile.account.uploading" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.className).toContain("opacity-100");
    expect(screen.queryByRole("button", { name: "profile.account.uploadCover" })).toBeNull();
    // 42% postępu = wskaźnik cofnięty o 58% swojej szerokości.
    expect(progressTransform()).toBe("translateX(-58%)");
    expect(button.querySelector(".animate-spin")).toBeTruthy();
  });

  it("wysyłka AWATARA pokazuje własny postęp na nakładce awatara", async () => {
    // Osobny pasek, bo tło i awatar wysyłają się niezależnie - wspólny
    // wskaźnik kłamałby o tym, KTÓRE zdjęcie jest w drodze.
    h.status = { avatar: "uploading", cover: "idle" };
    h.progress = { avatar: 77, cover: 0 };
    await mount();
    const overlay = screen.getByRole("button", { name: "profile.inline.changeAvatar" });
    expect(overlay.hasAttribute("disabled")).toBe(true);
    expect(overlay.className).toContain("opacity-100");
    expect(progressTransform()).toBe("translateX(-23%)");
  });

  it("wysyłka PIERWSZEGO awatara kręci się na kafelku zastępczym", async () => {
    // Konto bez awatara nie ma nakładki - wskaźnik musi trafić na sam kafelek,
    // inaczej pierwsza wysyłka nie daje żadnego znaku życia.
    h.profile = filledRow({ avatar_url: null });
    h.status = { avatar: "uploading", cover: "idle" };
    h.progress = { avatar: 5, cover: 0 };
    await mount();
    const placeholder = screen.getByRole("button", { name: /profile\.inline\.addAvatar/ });
    expect(placeholder.hasAttribute("disabled")).toBe(true);
    expect(placeholder.querySelector(".animate-spin")).toBeTruthy();
    expect(progressTransform()).toBe("translateX(-95%)");
  });

  it.fails("DEFEKT: postęp wysyłki nie dociera do czytnika ekranu", async () => {
    // CO JEST NIE TAK. Trasa montuje pasek postępu (`<Progress value=...>`,
    // src/routes/profile.index.tsx:879-881 i 983-985), ale wspólna otoczka
    // `src/components/ui/progress.tsx:10-14` wyłuskuje `value` z propsów
    // i przekazuje je TYLKO do stylu wskaźnika - korzeń Radiksa nie dostaje
    // ani `value`, ani `max`, więc na wyjściu jest `role="progressbar"` BEZ
    // `aria-valuenow`. Rola obiecuje asystującemu odczyt postępu, którego nie
    // ma czym podać.
    //
    // KONSEKWENCJA DLA UŻYTKOWNIKA. Osoba korzystająca z czytnika ekranu
    // słyszy „pasek postępu" i nic więcej: przez całą wysyłkę nie wie, czy
    // przesyłanie stoi, czy idzie. Przy 5 MB tła na wolnym łączu to minuta
    // ciszy, po której naturalnym odruchem jest wysłać plik jeszcze raz.
    //
    // NAPRAWA JEST POZA TĄ TRASĄ: `ui/progress` musi przekazać `value` do
    // korzenia (jedna linia), a nagłówek dołożyć `aria-label` z klucza i18n.
    // Zgłoszone tutaj, bo tu widać skutek.
    h.status = { avatar: "idle", cover: "uploading" };
    h.progress = { avatar: 0, cover: 42 };
    await mount();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
  });

  it.fails("DEFEKT: NIEUDANA wysyłka wygląda dokładnie jak brak wysyłki", async () => {
    // CO JEST NIE TAK. `useProfileEditor` liczy cztery stany wysyłki
    // (`idle` / `uploading` / `success` / `failed`), a nagłówek trasy
    // (src/routes/profile.index.tsx:820-821) czyta z nich TYLKO jeden:
    // `status.cover === "uploading"`. Stan `failed` nie zmienia w nagłówku
    // ani jednego piksela - przycisk wraca do „Wyślij tło", tak jakby nikt
    // nigdy nic nie wysyłał.
    //
    // KONSEKWENCJA DLA UŻYTKOWNIKA. Jedynym śladem awarii jest toast, który
    // po kilku sekundach znika. Osoba, która w tym czasie patrzyła na
    // podgląd zdjęcia, nie wie, czy wysyłka przeszła - i wysyła ten sam plik
    // trzeci raz, za każdym razem płacąc pełnym transferem. Naprawa: stan
    // `failed` z komunikatem z klucza i18n i wyraźnym ponowieniem.
    h.status = { avatar: "idle", cover: "failed" };
    await mount();
    const poNiepowodzeniu = screen.getByRole("button", {
      name: "profile.account.uploadCover",
    }).outerHTML;
    cleanup();

    h.status = { avatar: "idle", cover: "idle" };
    await mount();
    const bezProby = screen.getByRole("button", { name: "profile.account.uploadCover" }).outerHTML;
    expect(poNiepowodzeniu).not.toBe(bezProby);
  });
});

describe("nagłówek - odsłanianie akcji wskaźnikiem", () => {
  it("przycisk wysyłki tła wychodzi z półprzejrzystości po najechaniu", async () => {
    // Przycisk stoi na zdjęciu, więc domyślnie jest przygaszony, żeby nie
    // zasłaniał tła. Bez reakcji na wskaźnik zostaje słabo widoczny na stałe.
    await mount();
    const button = screen.getByRole("button", { name: "profile.account.uploadCover" });
    expect(button.className).toContain("opacity-80");
    fireEvent.mouseEnter(coverBox());
    expect(screen.getByRole("button", { name: "profile.account.uploadCover" }).className).toContain(
      "opacity-100",
    );
    fireEvent.mouseLeave(coverBox());
    expect(screen.getByRole("button", { name: "profile.account.uploadCover" }).className).toContain(
      "opacity-80",
    );
  });

  it("nakładka „Zmień awatar” pojawia się dopiero po najechaniu na awatar", async () => {
    // To JEDYNA droga do podmiany istniejącego awatara. Nakładka, która nie
    // wychodzi z `opacity-0`, znaczy zdjęcie, którego nie da się zmienić.
    await mount();
    const overlay = screen.getByRole("button", { name: "profile.inline.changeAvatar" });
    expect(overlay.className).toContain("opacity-0");
    fireEvent.mouseEnter(avatarBox());
    expect(screen.getByRole("button", { name: "profile.inline.changeAvatar" }).className).toContain(
      "opacity-100",
    );
    fireEvent.mouseLeave(avatarBox());
    expect(screen.getByRole("button", { name: "profile.inline.changeAvatar" }).className).toContain(
      "opacity-0",
    );
  });

  it("kliknięcie nakładki otwiera wybór pliku awatara, nie tła", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "profile.inline.changeAvatar" }));
    fireEvent.change(fileInputs()[1], { target: { files: [imageFile("nowy.png")] } });
    expect(h.uploads).toEqual([{ name: "nowy.png", kind: "avatar" }]);
  });

  it("kafelek zastępczy awatara sam jest przyciskiem wyboru pliku", async () => {
    // Konto bez zdjęcia: kafelek MUSI być klikalny, bo nie ma nad nim nakładki.
    // Podpowiedź rozmiaru stoi na kafelku, żeby nikt nie wysyłał 5 MB panoramy.
    h.profile = filledRow({ avatar_url: null });
    await mount();
    const placeholder = screen.getByRole("button", { name: /profile\.inline\.addAvatar/ });
    expect(placeholder.textContent).toContain("profile.inline.avatarSize");
    fireEvent.click(placeholder);
    fireEvent.change(fileInputs()[1], { target: { files: [imageFile("pierwszy.png")] } });
    expect(h.uploads).toEqual([{ name: "pierwszy.png", kind: "avatar" }]);
  });

  it("w podglądzie gościa kafelek zastępczy jest MARTWY i bez podpowiedzi", async () => {
    // Gość nie wysyła zdjęć na cudzy profil, a podpowiedź o rozmiarze pliku
    // jest instrukcją dla właściciela - w podglądzie nie ma czego instruować.
    h.profile = filledRow({ avatar_url: null });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "profile.inline.viewAsGuest" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "profile.inline.editMode" })).toBeTruthy(),
    );
    expect(screen.queryByText("profile.inline.addAvatar")).toBeNull();
    expect(screen.queryByText("profile.inline.avatarSize")).toBeNull();
    expect(screen.queryByRole("button", { name: "profile.account.uploadCover" })).toBeNull();
  });

  it("odnośniki społecznościowe przy awatarze otwierają się w nowej karcie", async () => {
    // Wyjście z panelu konta w tej samej karcie gubi kontekst pracy;
    // `rel="noopener"` zamyka dostęp obcej strony do `window.opener`.
    await mount();
    const linkedin = screen.getByRole("link", { name: "LinkedIn" });
    expect(linkedin.getAttribute("target")).toBe("_blank");
    expect(linkedin.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: "X" }).getAttribute("href")).toBe(
      "https://example.org/anna",
    );
  });
});

describe("profil oczami gościa - wyłącznie do czytania", () => {
  /** Wchodzi w podgląd gościa na już zamontowanej trasie. */
  async function asGuest() {
    const view = await mount();
    fireEvent.click(screen.getByRole("button", { name: "profile.inline.viewAsGuest" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "profile.inline.editMode" })).toBeTruthy(),
    );
    return view;
  }

  it("bio jest ODHTMLOWANE - gość nie widzi znaczników", async () => {
    // Bio jedzie do bazy jako HTML (edytor `/profile/social`), a tu ma być
    // czytane jako tekst. Wyświetlenie `<p>` gościowi to raz brzydota,
    // dwa - sygnał, że gdzieś indziej ten sam napis wstrzykuje się jako HTML.
    await asGuest();
    expect(screen.getByText("Zajmuję się polityką energetyczną UE.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("<p>");
  });

  it("telefon staje się odnośnikiem `tel:`, a adresy - skróconymi adresami", async () => {
    // Skrócenie adresu zdejmuje `https://` i `www.`, zostawiając to, co
    // człowiek rozpoznaje. Pełny adres w wierszu kontaktu łamie układ.
    await asGuest();
    expect(screen.getByRole("link", { name: "+32 2 000 00 00" }).getAttribute("href")).toBe(
      "tel:+32 2 000 00 00",
    );
    expect(screen.getByText("example.org/in/anna-nowak")).toBeTruthy();
    expect(screen.getByText("example.org/anna")).toBeTruthy();
  });

  it("adres, którego NIE DA SIĘ sparsować, pokazuje się w całości", async () => {
    // Kolumna niesie to, co człowiek wpisał; `new URL` na napisie bez schematu
    // rzuca wyjątkiem. Skracanie „na siłę" pokazałoby pustkę zamiast danych -
    // a to wygląda jak utrata wpisanego odnośnika.
    h.profile = filledRow({ linkedin_url: "linkedin.example.org/in/anna" });
    await asGuest();
    expect(screen.getByText("linkedin.example.org/in/anna")).toBeTruthy();
  });

  it("PUSTY profil gościa to same kreski, ani jednego zaproszenia do edycji", async () => {
    // Najważniejszy test tego bloku. Zaproszenie „Dodaj telefon" na cudzym
    // profilu obiecuje gościowi uprawnienie, którego nie ma - a przy tym
    // sugeruje, że właściciel czegoś nie zrobił.
    h.profile = EMPTY_ROW;
    await asGuest();
    expect(screen.queryByText("profile.inline.addCompany")).toBeNull();
    expect(screen.queryByText("profile.inline.addJobTitle")).toBeNull();
    expect(screen.queryByText("profile.inline.addSpecialization")).toBeNull();
    expect(screen.queryByText("profile.inline.addLocation")).toBeNull();
    expect(screen.queryByText("profile.inline.addPhone")).toBeNull();
    expect(screen.queryByText("profile.inline.addLinkedin")).toBeNull();
    expect(screen.queryByText("profile.inline.addTwitter")).toBeNull();
    // Puste pola dostają kreskę - wiersz bez treści wygląda na zepsuty render.
    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(5);
  });

  it("PUSTY profil gościa nie pokazuje ani jednej pastylki meta", async () => {
    // Pastylki (specjalizacja, miejsce, adres e-mail) to jedyna warstwa, która
    // w podglądzie może zostać po kimś innym - pusta ramka bez treści.
    h.profile = EMPTY_ROW;
    h.user = { id: "user-me" };
    await asGuest();
    expect(screen.queryByRole("link", { name: /mailto/ })).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })?.textContent).toBe(
      "profile.account.unnamed",
    );
  });

  it("CV zostaje widoczne - to część publicznej wizytówki", async () => {
    // Podgląd gościa nie ma prawa ukryć dorobku: właściciel sprawdza właśnie
    // to, co świat zobaczy na jego hubie.
    await asGuest();
    expect(screen.getByTestId("CvSection")).toBeTruthy();
    expect(h.organism.CvSection).toMatchObject({ editable: false });
  });
});

describe("zapis pustej wartości - każde pole czyści się do `null`", () => {
  it("wszystkie pola zakładki „O mnie” zapisują `null`, nie pusty napis", async () => {
    // `""` w kolumnie przechodzi przez każdy warunek „jest wypełnione":
    // miernik kompletności profilu liczy pole jako gotowe, a na ekranie pusto.
    // Tu przejeżdżamy CAŁĄ zakładkę, bo regresja dotknęłaby jednego pola.
    h.inlineDraft = "";
    await mount();
    for (const testId of [
      "inline:profile.account.displayName",
      "inline:profile.account.jobTitle",
      "area:profile.account.bio",
      "inline:profile.account.phone",
      "inline:profile.account.location",
      "inline:LinkedIn",
      "inline:X",
    ]) {
      fireEvent.click(screen.getByTestId(testId));
    }
    expect(h.saved).toEqual([
      { field: "display_name", value: null },
      { field: "job_title", value: null },
      { field: "bio", value: null },
      { field: "phone", value: null },
      { field: "location", value: null },
      { field: "linkedin_url", value: null },
      { field: "twitter_url", value: null },
    ]);
  });

  it("stanowisko PUSTE też czyści się do `null`", async () => {
    // Osobna gałąź renderu: pole bez wartości ma własny egzemplarz edytora
    // (bez kropki rozdzielającej), więc własny `onSave`.
    h.profile = filledRow({ job_title: null });
    h.inlineDraft = "";
    await mount();
    fireEvent.click(screen.getByTestId("inline:profile.account.jobTitle"));
    expect(h.saved).toEqual([{ field: "job_title", value: null }]);
  });

  it("specjalizacja z samych spacji czyści się do `null`", async () => {
    // Dialog oddaje napis dosłownie; bez `trim() || null` w kolumnie zostaje
    // „   ", czyli pole „wypełnione" spacjami.
    h.promptAnswer = "   ";
    h.profile = filledRow({ specialization: null });
    await mount();
    fireEvent.click(metaPill("profile.inline.addSpecialization"));
    await waitFor(() => expect(h.saved).toEqual([{ field: "specialization", value: null }]));
  });

  it("miejsce zamieszkania w USTAWIENIACH zapisuje wartość i czyści ją do `null`", async () => {
    // To DRUGI egzemplarz tego samego pola (pierwszy jest w sekcji kontaktu)
    // z inną etykietą pustki. Rozjazd między nimi znaczy, że jedna z dwóch
    // ścieżek zapisu przestała działać, a użytkownik widzi to jako
    // „zapisuje się tylko z jednego miejsca".
    await mount("?tab=settings");
    fireEvent.click(screen.getByTestId("inline:profile.account.location"));
    expect(h.saved).toEqual([{ field: "location", value: "nowa wartość" }]);

    h.inlineDraft = "";
    fireEvent.click(screen.getByTestId("inline:profile.account.location"));
    expect(h.saved.at(-1)).toEqual({ field: "location", value: null });
  });
});

/* ======================================================================
   MARTWY KOD TEJ TRASY. Cztery gałęzie i jedna funkcja w
   `src/routes/profile.index.tsx` są NIEOSIĄGALNE - nie dlatego, że testy ich
   nie dotknęły, ale dlatego, że warunek nadrzędny wyklucza je z definicji.
   Ten blok dowodzi warunku nadrzędnego, żeby następna osoba nie szukała
   scenariusza, którego nie ma - i żeby usunięcie tego kodu było widocznym
   uproszczeniem, a nie utratą pokrycia.
   ====================================================================== */
describe("nieosiągalne gałęzie zakładki „Ustawienia” - świadomy opis stanu", () => {
  it("karta ustawień NIE ISTNIEJE bez prawa edycji, także z linku", async () => {
    // WARUNEK NADRZĘDNY: `{activeTab === "settings" && editable && (...)}`
    // (src/routes/profile.index.tsx:726). Wewnątrz karty stoją jeszcze DWA
    // warunki `editable ? ... : ...` (linie 730-753 i 756-768) - i ich gałęzie
    // „bez edycji" są z tego powodu nieosiągalne, razem z jedyną w pliku
    // konsumentką funkcji `cap()` (linia 751). To nie luka w testach, to
    // martwy kod: warto go usunąć przy najbliższym dotknięciu pliku.
    //
    // Dowód dwustronny: (1) właściciel widzi kartę, (2) podgląd gościa
    // ZDEJMUJE ją całkowicie, a nie zamienia na wersję do czytania.
    await mount("?tab=settings");
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.getByTestId("inline:profile.account.location")).toBeTruthy();
    cleanup();

    await mount("?tab=settings");
    fireEvent.click(screen.getByRole("button", { name: "profile.inline.viewAsGuest" }));
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    // Ani listy wyboru, ani jej odpowiednika „do czytania" - karty nie ma.
    expect(screen.queryByText("profile.account.genderFemale")).toBeNull();
    expect(screen.queryByText("profile.tabs.settings")).toBeNull();
  });

  it("każda karta pulpitu niesie ikonę - wariant bez ikony jest nieużywany", async () => {
    // WARUNEK NADRZĘDNY: lokalny komponent `Card` ma opcjonalny prop `icon`
    // (src/routes/profile.index.tsx:1040), ale wszystkie SIEDEM wywołań w tym
    // pliku go podaje - a `Card` nie jest eksportowany, więc innych wywołań być
    // nie może. Gałąź „bez ikony" jest nieosiągalna z tej trasy.
    await mount("?tab=activity");
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.length).toBeGreaterThanOrEqual(4);
    for (const heading of headings) {
      expect(heading.querySelector("span.text-primary svg")).toBeTruthy();
    }
  });
});
