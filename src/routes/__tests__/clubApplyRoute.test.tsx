// Trasa /club/apply - JEDYNA droga do zamkniętego klubu dyskusyjnego.
//
// CO TEN PLIK DOWODZI. Ta ścieżka ma incydent produkcyjny w historii
// (`source_type='club_application'` złamał CHECK na `crm_leads`, i dlatego
// istnieje bramka `check:pg-harness`), więc testujemy ją jak coś, co już raz
// zawiodło - warstwa po warstwie, od kontraktu adresu do payloadu wysyłki:
//
//   1. `validateSearch` - kontrakt LINKU, który ludzie wklejają do maila
//      i który stoi w kampaniach. Parametr złego typu nie może wywalić trasy.
//   2. GATE - kto widzi formularz. Dwie bramki są w tym pliku (konto,
//      warstwa PRO+), obie muszą pokazać WŁAŚCIWY klucz i WŁAŚCIWE CTA:
//      gość dostaje logowanie, użytkownik bez PRO dostaje cennik. Pomyłka
//      w tę stronę wysyła kandydata z ważnym kontem na stronę zakupu.
//   3. PREFILL - wypełnia WYŁĄCZNIE puste pola i JEDEN raz. Regresja wygląda
//      niewinnie („dane z profilu”), a kosztuje kandydata przepisany tekst,
//      bo nadpisuje to, co już wpisał.
//   4. `clubsInReach` - filtr `min_tier_rank <= rank` DOKŁADNIE na granicy.
//      Klub o progu wyższym niż ranga nie ma prawa być do wyboru: zgłoszenie
//      do niego przechodzi globalną bramkę PRO+, komisja je przyjmuje,
//      a `club_capabilities` potem odrzuca członka z `tier_too_low`.
//   5. `onSubmit` - błąd walidacji NIE wysyła żądania, podwójne kliknięcie
//      nie wysyła dwa razy, sukces unieważnia klucz historii, a błąd API
//      pokazuje KLUCZ i18n, nigdy surowego tekstu z Postgresa.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ walidacji: `applyValidation.ts` ma własne testy na czystym schemacie
//   Zoda. Tutaj dowodzimy tylko, że trasa je WOŁA i RESPEKTUJE (odmawia
//   wysyłki, pokazuje listę błędów, przełącza się na walidację „na żywo”).
// - MAPOWANIA błędów RPC: `clubApplyErrorCode` ma testy w `applyApi`. Tutaj
//   sprawdzamy, że trasa go używa i że wynik idzie do klucza i18n.
// - AUTORYTETU: twarda bramka jest w RPC `club_apply_submit` (konto, ranga,
//   zgoda, limit jednego otwartego zgłoszenia) i w pgTAP. Dwa powody odmowy,
//   których w tym pliku NIE MA jako bramki - „wniosek już złożony”
//   (`duplicate_open`) i próg konkretnego klubu (`club_tier_too_low`) -
//   przychodzą Z SERWERA po wysyłce, więc testujemy je jako komunikat błędu
//   wysyłki, a nie jako `GateCard`.
// - SEO: `buildClubApplyHead` mieszka w `applyHead.ts` i ma własny zakres;
//   tutaj tylko dowód, że trasa go PODPINA (bez `head` strona traci tytuł).
//
// TRZY GAŁĘZIE NIEDOBITE ŚWIADOMIE - i to nie jest luka w testach:
// - linia 171, `if (next[key] === "")` w updaterze `setForm`: to DEFENSYWNE
//   powtórzenie warunku na wypadek, że użytkownik zacznie pisać MIĘDZY
//   wyliczeniem `fillable` a wykonaniem updatera. Efekt biegnie po commicie,
//   więc z testu nie da się wcisnąć zdarzenia w tę szczelinę bez sterowania
//   harmonogramem Reacta. Gałąź jest tu warta swojej ceny (bez niej wraca
//   nadpisywanie tekstu kandydata), tylko nie da się jej wywołać.
// - linia 414, dwa `?? ""` w `okLead`: ARYTMETYCZNIE nieosiągalne. Ta bramka
//   renderuje się wyłącznie przy `isPro`, a `isPro` wymaga `tierQuery.data`
//   różnego od `null`; `name_pl`/`name_en` są w typie `string`, więc `??` nigdy
//   nie sięga po fallback. Bliźniacze `?? ""` w `proLead` (linia 399) SĄ
//   pokryte, bo tam bramka pokazuje się także bez danych warstwy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CurrentTier } from "@/lib/billing/tiers";
import type { ClubMyApplicationRow } from "@/lib/clubs/applyApi";
import type { ClubSpecializationRow } from "@/lib/clubs/specializationsApi";
import type { ClubApplyValues } from "@/lib/clubs/applyValidation";

const h = vi.hoisted(() => ({
  /** Język interfejsu - `undefined` odwzorowuje i18next PRZED inicjalizacją. */
  lang: "pl" as string | undefined,
  /** Wersja zgody z katalogu; `undefined` = katalog nie zna tego klucza. */
  consentVersion: "2.0" as string | undefined,
  user: null as { id: string } | null,
  tier: null as { rank: number; name_pl: string; name_en: string } | null,
  specs: [] as unknown[] | undefined,
  clubs: { rows: [] as unknown[], total: 0 },
  mine: [] as unknown[],
  prefill: undefined as Record<string, string> | undefined,
  submit: vi.fn(),
  consent: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Ile razy trasa poprosiła o dane prefillu - dowód `staleTime`/`enabled`. */
  prefillCalls: 0,
}));

// Atrapa i18n z JĘZYKIEM STEROWANYM Z TESTU. `reactI18nextStub()` typuje
// `language` jako `string`, a trasa ma gałąź `i18n.language ?? "pl"` na wypadek
// odczytu PRZED inicjalizacją i18next - żeby ją dosięgnąć bez rzutowania,
// budujemy tu obiekt z polem OPCJONALNYM. Getter, nie wartość: instancja `i18n`
// musi być stabilna (panele wpinają ją do tablic zależności efektów).
vi.mock("react-i18next", async () => {
  const { translateKey } = await import("@/test/i18nStub");
  const i18n: { language?: string; t: typeof translateKey } = {
    get language() {
      return h.lang;
    },
    t: translateKey,
  };
  return {
    useTranslation: () => ({ t: translateKey, i18n }),
    initReactI18next: { type: "3rdParty", init: () => {} },
    Trans: (props: { children?: unknown }) => props.children ?? null,
  };
});
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("@/lib/notifications/consentCatalog", () => ({
  getConsentDefinition: () =>
    h.consentVersion === undefined ? undefined : { version: h.consentVersion },
}));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/billing/tiers", () => ({
  useCurrentTier: () => ({ data: h.tier }),
}));
vi.mock("@/lib/clubs/useClubSpecializations", () => ({
  useClubSpecializations: () => ({ data: h.specs }),
  useClubsBySpecialization: (slug: string, _limit: number, enabled: boolean) => ({
    data: enabled && slug !== "" ? h.clubs : undefined,
  }),
}));
// Warstwa dostępu podmieniona na poziomie MODUŁU, nie klienta Supabase: trasa
// ma dowieść, CO do niej wysyła i co robi z odpowiedzią, a kształt RPC jest
// dowiedziony w `applyApi` i w pgTAP.
vi.mock("@/lib/clubs/applyApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clubs/applyApi")>()),
  submitClubApplication: h.submit,
  fetchMyClubApplications: () => Promise.resolve(h.mine),
}));
vi.mock("@/lib/clubs/applyPrefill.functions", () => ({
  getClubApplyPrefill: () => {
    h.prefillCalls += 1;
    return Promise.resolve(h.prefill);
  },
}));
vi.mock("@/lib/consents.functions", () => ({ setMyConsent: h.consent }));
// `useServerFn` w produkcji owija funkcję serwerową transportem RPC; w teście
// wołamy ją wprost, bo przedmiotem dowodu jest ARGUMENT, który trasa wysyła.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: <T,>(fn: T) => fn,
}));
// Radix Select nie działa pod happy-dom bez pełnego pointer API - atom
// zamieniamy na natywny `<select>`. Reguły wyboru pilnuje schemat Zoda,
// a tu chodzi o to, KTÓRE opcje trasa w ogóle wystawia.
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    value,
    onValueChange,
    options,
    disabled,
    "aria-label": ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: readonly { value: string; label: ReactNode }[];
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
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
  ),
}));

import { renderRoute, routeMeta, routeSearchValidator } from "@/test/routeHarness";
import { Route as ApplyRoute } from "@/routes/club.apply";
import { CLUB_BASE_ISO, clubIsoOffset, clubListRow } from "@/test/clubs/fixtures";

const PATH = "/club/apply";
const PRO_MIN_RANK = 20;

/** Warstwa członkostwa o zadanej randze - `null` = brak danych warstwy. */
function tier(rank: number): CurrentTier["rank"] extends number ? typeof h.tier : never {
  return { rank, name_pl: "PRO", name_en: "PRO" };
}

function specRow(overrides: Partial<ClubSpecializationRow> = {}): ClubSpecializationRow {
  return {
    slug: "bezpieczenstwo",
    key: "security",
    label_pl: "Bezpieczeństwo",
    label_en: "Security",
    lead_pl: null,
    lead_en: null,
    desc_pl: null,
    desc_en: null,
    icon: "shield",
    sort_order: 10,
    club_count: 2,
    ...overrides,
  };
}

function myApplication(overrides: Partial<ClubMyApplicationRow> = {}): ClubMyApplicationRow {
  return {
    id: "app-1",
    created_at: CLUB_BASE_ISO,
    specialization_slug: "bezpieczenstwo",
    club_id: "club-1",
    club_name_pl: "Klub bezpieczeństwa",
    club_name_en: "Security club",
    status: "pending",
    reviewed_at: null,
    ...overrides,
  };
}

async function mount(entry: string = PATH) {
  return renderRoute({ route: ApplyRoute, path: PATH, initialEntry: entry });
}

/** Pole tekstowe formularza - etykieta to KLUCZ i18n (atrapa echa klucza). */
function field(key: string): HTMLElement {
  return screen.getByLabelText(new RegExp(key.replace(/\./g, "\\.")));
}

function type(key: string, value: string): void {
  fireEvent.change(field(key), { target: { value } });
}

function select(key: string, value: string): void {
  fireEvent.change(screen.getByLabelText(key), { target: { value } });
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: /club\.spec\.apply\.(submit|sending)/ });
}

/** Kompletne, POPRAWNE zgłoszenie - minimum, które przechodzi schemat Zoda. */
function fillValidForm(): void {
  type("club.spec.apply.firstName", "Jan");
  type("club.spec.apply.lastName", "Kowalski");
  type("club.spec.apply.email", "jan.kowalski@example.com");
  type("club.spec.apply.phone", "+48 601 202 303");
  type("club.spec.apply.country", "Polska");
  type("club.spec.apply.company", "New European Strategies");
  type("club.spec.apply.jobPosition", "Dyrektor ds. polityk");
  type("club.spec.apply.expertise", "Regulacje energetyczne UE i bezpieczeństwo dostaw.");
  type(
    "club.spec.apply.motivation",
    "Chcę współtworzyć rekomendacje dla korytarza północ-południe.",
  );
  type("club.spec.apply.goals", "Wymiana wiedzy z decydentami krajowymi.");
  select("club.spec.apply.seniority", "director");
  select("club.spec.apply.industry", "energy");
  select("club.spec.apply.availability", "monthly");
  select("club.spec.apply.specialization", "bezpieczenstwo");
  fireEvent.click(screen.getByRole("checkbox", { name: "club.spec.apply.consent" }));
}

beforeEach(() => {
  cleanup();
  h.lang = "pl";
  h.consentVersion = "2.0";
  h.user = { id: "user-me" };
  h.tier = tier(PRO_MIN_RANK);
  h.specs = [specRow()];
  h.clubs = { rows: [], total: 0 };
  h.mine = [];
  h.prefill = undefined;
  h.prefillCalls = 0;
  h.submit.mockReset().mockResolvedValue(undefined);
  h.consent.mockReset().mockResolvedValue(undefined);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

// --- 1. kontrakt adresu ----------------------------------------------------

describe("validateSearch - kontrakt linku wklejanego do maila", () => {
  const validate = routeSearchValidator(ApplyRoute);

  it("przepuszcza preselekcję specjalizacji", () => {
    expect(validate({ spec: "bezpieczenstwo" })).toEqual({ spec: "bezpieczenstwo" });
  });

  it("brak parametru daje pusty obiekt, nie `undefined`", () => {
    // `search.spec ?? ""` w komponencie musi mieć na czym stanąć; `undefined`
    // zamiast obiektu wywala odczyt pierwszym renderem.
    expect(validate({})).toEqual({});
  });

  it.each([
    ["liczba", { spec: 7 }],
    ["tablica", { spec: ["a", "b"] }],
    ["null", { spec: null }],
    ["obiekt", { spec: { slug: "x" } }],
    ["wartość logiczna", { spec: true }],
  ])("parametr o złym typie (%s) jest ODRZUCANY, a nie przepuszczany dalej", (_label, raw) => {
    expect(validate(raw)).toEqual({});
  });

  it("parametry nadmiarowe są ODCINANE - adres nie jest kanałem na dowolne dane", () => {
    expect(validate({ spec: "bezpieczenstwo", utm_source: "newsletter", ref: "x" })).toEqual({
      spec: "bezpieczenstwo",
    });
  });

  it("pusty napis przechodzi jako pusty - trasa musi go potraktować jak brak wyboru", () => {
    expect(validate({ spec: "" })).toEqual({ spec: "" });
  });

  it("slug nieistniejący przechodzi walidację adresu - o istnieniu decyduje katalog", () => {
    // Świadoma decyzja: `validateSearch` nie zna katalogu specjalizacji (ten
    // przychodzi z RPC), więc nieznany slug NIE może odrzucić trasy - inaczej
    // usunięcie specjalizacji zamieniłoby stare linki w błąd zamiast w pusty
    // formularz.
    expect(validate({ spec: "specjalizacja-ktorej-nie-ma" })).toEqual({
      spec: "specjalizacja-ktorej-nie-ma",
    });
  });

  it("trasa PODPINA `head` - bez niego strona zgłoszenia traci tytuł i opis", async () => {
    const meta = await routeMeta(ApplyRoute);
    expect(meta.length).toBeGreaterThan(0);
    expect(meta.some((entry) => typeof entry.title === "string")).toBe(true);
  });
});

// --- 2. bramki -------------------------------------------------------------

describe("GateCard - kto widzi formularz", () => {
  it("gość dostaje bramkę KONTA z CTA do logowania, nie do cennika", async () => {
    h.user = null;
    h.tier = null;
    await mount();
    expect(screen.getByText("club.spec.apply.gate.signInTitle")).toBeTruthy();
    expect(screen.getByText("club.spec.apply.gate.signInLead")).toBeTruthy();
    const cta = screen.getByRole("link", { name: "club.spec.apply.gate.signIn" });
    expect(cta.getAttribute("href")).toBe("/login");
    expect(screen.queryByText("club.spec.apply.gate.proTitle")).toBeNull();
    expect(screen.queryByRole("button", { name: /club\.spec\.apply\.submit/ })).toBeNull();
  });

  it.each([
    ["brak danych warstwy", null],
    ["ranga 0", 0],
    ["ranga o jeden pod progiem", PRO_MIN_RANK - 1],
  ])(
    "zalogowany bez PRO+ (%s) dostaje bramkę WARSTWY z CTA do cennika",
    async (_label, rank) => {
      h.tier = rank === null ? null : tier(rank);
      await mount();
      expect(screen.getByText("club.spec.apply.gate.proTitle")).toBeTruthy();
      const cta = screen.getByRole("link", { name: "club.spec.apply.gate.proCta" });
      expect(cta.getAttribute("href")).toBe("/pricing");
      expect(screen.queryByText("club.spec.apply.gate.signInTitle")).toBeNull();
      expect(screen.queryByRole("button", { name: /club\.spec\.apply\.submit/ })).toBeNull();
    },
  );

  it("ranga DOKŁADNIE na progu PRO+ przechodzi - granica należy do wpuszczonych", async () => {
    h.tier = tier(PRO_MIN_RANK);
    await mount();
    expect(screen.getByText("club.spec.apply.gate.okTitle")).toBeTruthy();
    expect(submitButton()).toBeTruthy();
  });

  it("ranga wyższa niż próg też przechodzi", async () => {
    h.tier = tier(PRO_MIN_RANK + 30);
    await mount();
    expect(screen.getByText("club.spec.apply.gate.okTitle")).toBeTruthy();
  });

  it("nazwa warstwy w komunikacie bramki idzie z JĘZYKA, nie z jednego pola", async () => {
    h.tier = { rank: PRO_MIN_RANK, name_pl: "PRO polski", name_en: "PRO english" };
    await mount();
    // Atrapa i18n dokleja parametry, więc widać DOKŁADNIE to, co trasa podała.
    expect(screen.getByText("club.spec.apply.gate.okLead(tier=PRO polski)")).toBeTruthy();
  });

  it("bramka warstwy nazywa warstwę nawet bez danych o niej (pusty parametr)", async () => {
    h.tier = null;
    await mount();
    expect(screen.getByText("club.spec.apply.gate.proLead(tier=)")).toBeTruthy();
  });
});

// --- 3. prefill ------------------------------------------------------------

describe("prefill z profilu - wypełnia TYLKO puste pola", () => {
  const PROFILE = {
    firstName: "Anna",
    lastName: "Nowak",
    email: "anna.nowak@example.com",
    phone: "+48 500 100 200",
    company: "NES",
    jobPosition: "Analityk",
    country: "Polska",
    linkedinUrl: "https://www.linkedin.com/in/anna",
  };

  it("wypełnia pola z profilu i mówi o tym WPROST", async () => {
    h.prefill = PROFILE;
    await mount();
    await waitFor(() => {
      expect(screen.getByText("club.spec.apply.prefillNote")).toBeTruthy();
    });
    expect((field("club.spec.apply.firstName") as HTMLInputElement).value).toBe("Anna");
    expect((field("club.spec.apply.email") as HTMLInputElement).value).toBe(
      "anna.nowak@example.com",
    );
  });

  it("NIE nadpisuje tego, co użytkownik już wpisał", async () => {
    // To jest regresja, która wygląda niewinnie: „dane z profilu” wchodzą
    // asynchronicznie i zjadają tekst wpisany w międzyczasie.
    h.prefill = undefined;
    await mount();
    type("club.spec.apply.firstName", "Zbigniew");
    h.prefill = PROFILE;
    // Nowe dane docierają dopiero teraz - efekt musi ominąć wypełnione pole.
    fireEvent.change(field("club.spec.apply.lastName"), { target: { value: "" } });
    await waitFor(() => {
      expect((field("club.spec.apply.firstName") as HTMLInputElement).value).toBe("Zbigniew");
    });
  });

  it("puste pola w profilu nie kasują pól formularza", async () => {
    h.prefill = { ...PROFILE, phone: "", company: "" };
    await mount();
    await waitFor(() => {
      expect((field("club.spec.apply.firstName") as HTMLInputElement).value).toBe("Anna");
    });
    expect((field("club.spec.apply.phone") as HTMLInputElement).value).toBe("");
    expect((field("club.spec.apply.company") as HTMLInputElement).value).toBe("");
  });

  it("profil bez ANI JEDNEGO pola do wypełnienia nie ogłasza prefillu", async () => {
    h.prefill = {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      company: "",
      jobPosition: "",
      country: "",
      linkedinUrl: "",
    };
    await mount();
    await waitFor(() => {
      expect(h.prefillCalls).toBeGreaterThan(0);
    });
    expect(screen.queryByText("club.spec.apply.prefillNote")).toBeNull();
  });

  it("gość nie pyta o prefill - zapytanie jest wyłączone bez konta", async () => {
    h.user = null;
    h.prefill = PROFILE;
    await mount();
    expect(h.prefillCalls).toBe(0);
  });

  it("prefill nie cofa świadomego WYCZYSZCZENIA pola po wypełnieniu", async () => {
    // `prefillApplied` to ref, nie warunek „pole puste”: bez tego każde
    // wyczyszczenie pola przez użytkownika było natychmiast cofane.
    h.prefill = PROFILE;
    await mount();
    await waitFor(() => {
      expect((field("club.spec.apply.firstName") as HTMLInputElement).value).toBe("Anna");
    });
    fireEvent.change(field("club.spec.apply.firstName"), { target: { value: "" } });
    await waitFor(() => {
      expect((field("club.spec.apply.firstName") as HTMLInputElement).value).toBe("");
    });
  });
});

// --- 4. próg warstwy na liście klubów --------------------------------------

describe("clubsInReach - filtr progu klubu DOKŁADNIE na granicy", () => {
  const RANK = 30;

  function clubsWithRanks(...ranks: number[]): void {
    h.clubs = {
      rows: ranks.map((min_tier_rank, index) =>
        clubListRow({
          id: `club-${index}`,
          slug: `klub-${index}`,
          name_pl: `Klub ${min_tier_rank}`,
          name_en: `Club ${min_tier_rank}`,
          min_tier_rank,
        }),
      ),
      total: ranks.length,
    };
  }

  async function mountWithSpec(): Promise<void> {
    h.tier = tier(RANK);
    await mount(`${PATH}?spec=bezpieczenstwo`);
  }

  function clubOptionLabels(): string[] {
    const list = screen.getByLabelText("club.spec.apply.club");
    return Array.from(list.querySelectorAll("option")).map((option) => option.textContent ?? "");
  }

  it("próg RÓWNY randze PRZECHODZI - granica należy do dostępnych", async () => {
    clubsWithRanks(RANK);
    await mountWithSpec();
    expect(clubOptionLabels()).toContain(`Klub ${RANK}`);
    expect(screen.queryByText("club.spec.apply.gate.tierFilteredNote")).toBeNull();
  });

  it("próg o JEDEN wyższy jest ODCIĘTY i policzony jako ukryty", async () => {
    clubsWithRanks(RANK + 1);
    await mountWithSpec();
    expect(clubOptionLabels()).not.toContain(`Klub ${RANK + 1}`);
    expect(screen.getByText("club.spec.apply.gate.tierFilteredNote")).toBeTruthy();
  });

  it("próg niższy przechodzi, a lista zachowuje opcję „dowolny klub”", async () => {
    clubsWithRanks(RANK - 10);
    await mountWithSpec();
    expect(clubOptionLabels()).toContain("club.spec.apply.clubAny");
    expect(clubOptionLabels()).toContain(`Klub ${RANK - 10}`);
  });

  it("brak danych o warstwie nie wywala listy - ranga schodzi do 0", async () => {
    clubsWithRanks(0, 20);
    h.tier = null;
    // Bez PRO+ formularza nie ma, więc dowodzimy tu tylko, że brak warstwy
    // nie wywraca renderu - i że bramka warstwy jest tym, co użytkownik widzi.
    await mount(`${PATH}?spec=bezpieczenstwo`);
    expect(screen.getByText("club.spec.apply.gate.proTitle")).toBeTruthy();
  });

  it("mieszana lista dzieli się na dostępne i ukryte bez gubienia wiersza", async () => {
    clubsWithRanks(0, RANK, RANK + 1, RANK + 50);
    await mountWithSpec();
    const labels = clubOptionLabels();
    expect(labels).toContain("Klub 0");
    expect(labels).toContain(`Klub ${RANK}`);
    expect(labels).not.toContain(`Klub ${RANK + 1}`);
    expect(labels).not.toContain(`Klub ${RANK + 50}`);
    expect(screen.getByText("club.spec.apply.gate.tierFilteredNote")).toBeTruthy();
  });

  it("bez wybranej specjalizacji lista klubów jest ZABLOKOWANA i nie pyta bazy", async () => {
    clubsWithRanks(0);
    h.tier = tier(RANK);
    await mount();
    const list = screen.getByLabelText("club.spec.apply.club");
    expect(list.hasAttribute("disabled")).toBe(true);
  });

  it("zmiana specjalizacji CZYŚCI wybrany klub - inaczej zostaje obcy identyfikator", async () => {
    clubsWithRanks(0);
    await mountWithSpec();
    const clubList = screen.getByLabelText("club.spec.apply.club");
    fireEvent.change(clubList, { target: { value: "club-0" } });
    expect((clubList as HTMLSelectElement).value).toBe("club-0");
    select("club.spec.apply.specialization", "");
    expect((screen.getByLabelText("club.spec.apply.club") as HTMLSelectElement).value).toBe("");
  });
});

// --- 5. lista specjalizacji ------------------------------------------------

describe("lista specjalizacji - katalog i jego brak", () => {
  it("katalog z RPC wygrywa i etykietuje po polsku dla języka PL", async () => {
    h.specs = [specRow({ slug: "energia", label_pl: "Energetyka", label_en: "Energy" })];
    await mount();
    const labels = Array.from(
      screen.getByLabelText("club.spec.apply.specialization").querySelectorAll("option"),
    ).map((option) => option.textContent);
    expect(labels).toContain("Energetyka");
  });

  it("brak etykiety PL degraduje do EN, a nie do pustego napisu", async () => {
    h.specs = [specRow({ slug: "energia", label_pl: "", label_en: "Energy" })];
    await mount();
    const labels = Array.from(
      screen.getByLabelText("club.spec.apply.specialization").querySelectorAll("option"),
    ).map((option) => option.textContent);
    expect(labels).toContain("Energy");
  });

  it("milczący katalog degraduje do WBUDOWANEJ specjalizacji z adresu", async () => {
    // Preselekcja z linku musi zostać wybieralna nawet wtedy, gdy RPC nie
    // odpowiedział - inaczej kandydat z kampanii widzi PUSTĄ listę. Slug jest
    // brany ze `CLUB_SPECIALIZATIONS`, a nie wymyślony: dla nieznanego katalog
    // wbudowany też milczy (osobny test niżej).
    h.specs = [];
    await mount(`${PATH}?spec=defence-geopolitics`);
    const labels = Array.from(
      screen.getByLabelText("club.spec.apply.specialization").querySelectorAll("option"),
    ).map((option) => option.textContent);
    expect(labels).toContain("club.spec.items.defence.title");
  });

  it("BRAK odpowiedzi RPC (`undefined`) zachowuje się jak pusty katalog", async () => {
    // `specsQuery.data ?? []` - zapytanie w locie nie może wywalić renderu.
    h.specs = undefined;
    await mount(`${PATH}?spec=energy`);
    const labels = Array.from(
      screen.getByLabelText("club.spec.apply.specialization").querySelectorAll("option"),
    ).map((option) => option.textContent);
    expect(labels).toContain("club.spec.items.energy.title");
  });

  it("milczący katalog i nieznany slug dają listę bez opcji, ale bez wyjątku", async () => {
    h.specs = [];
    await mount(`${PATH}?spec=nie-ma-takiej`);
    const list = screen.getByLabelText("club.spec.apply.specialization");
    // Jedna opcja pusta z atrapy `FormSelect` - żadnej opcji z katalogu.
    expect(list.querySelectorAll("option").length).toBe(1);
  });
});

// --- 6. wysyłka ------------------------------------------------------------

describe("onSubmit - wysyłka zgłoszenia", () => {
  it("błąd walidacji NIE wysyła żądania i nazywa błędy z listy", async () => {
    await mount();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("club.spec.apply.errorsTitle");
    });
    expect(h.submit).not.toHaveBeenCalled();
    // Podsumowanie błędów to `aria-live="assertive"` NAD formularzem - poza nim
    // każde pole ma własny `role="alert"`, więc szukamy tego jednego, który
    // ogłasza całość.
    const summary = screen
      .getAllByRole("alert")
      .find((node) => node.getAttribute("aria-live") === "assertive");
    expect(summary?.textContent).toContain("club.spec.apply.errors");
  });

  it("po pierwszej próbie walidacja działa NA ŻYWO, a nie do kolejnego kliknięcia", async () => {
    await mount();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    });
    const before = screen.getAllByRole("listitem").length;
    type("club.spec.apply.firstName", "Jan");
    await waitFor(() => {
      expect(screen.getAllByRole("listitem").length).toBeLessThan(before);
    });
  });

  it("poprawne zgłoszenie leci do API z JĘZYKIEM i kompletnym payloadem", async () => {
    await mount();
    fillValidForm();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.submit).toHaveBeenCalledTimes(1);
    });
    const [values, lang] = h.submit.mock.calls[0] as [ClubApplyValues, string];
    expect(lang).toBe("pl");
    expect(values.firstName).toBe("Jan");
    expect(values.email).toBe("jan.kowalski@example.com");
    expect(values.specialization).toBe("bezpieczenstwo");
    expect(values.consent).toBe(true);
    expect(values.marketingConsent).toBe(false);
  });

  it("PODWÓJNE kliknięcie nie wysyła dwa razy - przycisk jest odcięty w czasie wysyłki", async () => {
    // Uchwyt trzymany w OBIEKCIE, nie w zmiennej: analiza przepływu TypeScriptu
    // zawęża `let x = null` do `null` i nie widzi przypisania z wnętrza
    // wykonawcy obietnicy, więc odczyt przestaje być wywoływalny.
    const held: { release: (() => void) | null } = { release: null };
    h.submit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          held.release = () => resolve();
        }),
    );
    await mount();
    fillValidForm();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.submit).toHaveBeenCalledTimes(1);
    });
    expect(submitButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(submitButton());
    fireEvent.click(submitButton());
    expect(h.submit).toHaveBeenCalledTimes(1);
    if (held.release !== null) held.release();
    await waitFor(() => {
      expect(h.toastSuccess).toHaveBeenCalledWith("club.spec.apply.ok");
    });
  });

  it("sukces UNIEWAŻNIA historię własnych zgłoszeń i czyści formularz bez specjalizacji", async () => {
    const { queryClient } = await mount(`${PATH}?spec=bezpieczenstwo`);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    fillValidForm();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.toastSuccess).toHaveBeenCalledWith("club.spec.apply.ok");
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["club-applications", "mine"] });
    // Specjalizacja ZOSTAJE - kandydat zwykle składa kolejne zgłoszenie w tej
    // samej dziedzinie, a przepisywanie jej od nowa to strata bez korzyści.
    expect((field("club.spec.apply.firstName") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("club.spec.apply.specialization") as HTMLSelectElement).value).toBe(
      "bezpieczenstwo",
    );
  });

  it("zgoda marketingowa ZAŚWIADCZONA w rejestrze zgód, z tą samą wersją i źródłem", async () => {
    await mount();
    fillValidForm();
    fireEvent.click(screen.getByRole("checkbox", { name: "club.spec.apply.marketingConsent" }));
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.consent).toHaveBeenCalledTimes(1);
    });
    const [payload] = h.consent.mock.calls[0] as [
      { data: { key: string; given: boolean; lang: string; source: string; version: string } },
    ];
    expect(payload.data.given).toBe(true);
    expect(payload.data.lang).toBe("pl");
    expect(payload.data.source).toBe("club_apply");
    expect(payload.data.version).not.toBe("");
  });

  it("bez zgody marketingowej rejestr zgód NIE jest dotykany", async () => {
    await mount();
    fillValidForm();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.submit).toHaveBeenCalledTimes(1);
    });
    expect(h.consent).not.toHaveBeenCalled();
  });

  it("błąd rejestru zgód NIE psuje wysyłki - zgłoszenie jest już w bazie", async () => {
    // Zapis zgody jest NIEKRYTYCZNY. Gdyby jego błąd przechodził dalej,
    // kandydat widziałby porażkę przy zgłoszeniu, które właśnie się zapisało,
    // i wysłałby je drugi raz - a to koliduje z indeksem `duplicate_open`.
    h.consent.mockRejectedValue(new Error("rejestr zgód padł"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await mount();
    fillValidForm();
    fireEvent.click(screen.getByRole("checkbox", { name: "club.spec.apply.marketingConsent" }));
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.toastSuccess).toHaveBeenCalledWith("club.spec.apply.ok");
    });
    expect(h.toastError).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it.each([
    ["duplicate_open", "duplicate_open"],
    ["club_tier_too_low", "club_tier_too_low"],
    ["pro_required", "pro_required"],
    ["auth_required", "auth_required"],
    ["consent_required", "consent_required"],
  ])(
    "błąd API `%s` pokazuje KLUCZ i18n, nie surowy tekst z Postgresa",
    async (raw, expected) => {
      h.submit.mockRejectedValue(new Error(`ERROR:  ${raw} (SQLSTATE P0001) at RAISE`));
      await mount();
      fillValidForm();
      fireEvent.click(submitButton());
      await waitFor(() => {
        expect(h.toastError).toHaveBeenCalledWith(`club.spec.apply.submitErrors.${expected}`);
      });
      const message = String(h.toastError.mock.calls.at(-1)?.[0]);
      expect(message).not.toContain("SQLSTATE");
      expect(message).not.toContain("RAISE");
    },
  );

  it("błąd nierozpoznany degraduje do `unknown`, a nie do pustego tostu", async () => {
    h.submit.mockRejectedValue(new Error("connection reset by peer"));
    await mount();
    fillValidForm();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("club.spec.apply.submitErrors.unknown");
    });
  });

  it("odrzucenie BEZ obiektu Error też kończy się kluczem `unknown`", async () => {
    h.submit.mockRejectedValue("padło");
    await mount();
    fillValidForm();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("club.spec.apply.submitErrors.unknown");
    });
  });

  it("po błędzie API przycisk WRACA do stanu gotowego - da się wysłać ponownie", async () => {
    h.submit.mockRejectedValueOnce(new Error("connection reset")).mockResolvedValueOnce(undefined);
    await mount();
    fillValidForm();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalled();
    });
    expect(submitButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.toastSuccess).toHaveBeenCalledWith("club.spec.apply.ok");
    });
  });
});

// --- 7. historia własnych zgłoszeń -----------------------------------------

describe("historia własnych zgłoszeń - powód, żeby nie wysyłać drugi raz", () => {
  it("stoi NAD bramkami i pokazuje status z klucza i18n", async () => {
    h.mine = [myApplication({ status: "review" })];
    h.tier = null;
    await mount();
    await waitFor(() => {
      expect(screen.getByText("club.spec.apply.mine.title")).toBeTruthy();
    });
    expect(screen.getByText("club.spec.apply.mine.status.review")).toBeTruthy();
    // Historia jest ważna także wtedy, gdy warstwa członkostwa wygasła.
    expect(screen.getByText("club.spec.apply.gate.proTitle")).toBeTruthy();
  });

  it("zgłoszenie BEZ wskazanego klubu mówi „dowolny”, a nie pokazuje pustki", async () => {
    h.mine = [myApplication({ club_id: null, club_name_pl: null, club_name_en: null })];
    await mount();
    await waitFor(() => {
      expect(screen.getByText("club.spec.apply.mine.clubAny")).toBeTruthy();
    });
  });

  it("klub z identyfikatorem, ale PUSTĄ nazwą, też degraduje do „dowolny”", async () => {
    h.mine = [myApplication({ club_id: "club-1", club_name_pl: "", club_name_en: "" })];
    await mount();
    await waitFor(() => {
      expect(screen.getByText("club.spec.apply.mine.clubAny")).toBeTruthy();
    });
  });

  it("brak nazwy PL degraduje do EN, zamiast gubić klub", async () => {
    h.mine = [myApplication({ club_name_pl: null, club_name_en: "Security club" })];
    await mount();
    await waitFor(() => {
      expect(screen.getByText("Security club")).toBeTruthy();
    });
  });

  it("data decyzji pojawia się TYLKO wtedy, gdy decyzja padła", async () => {
    h.mine = [myApplication({ reviewed_at: null })];
    const first = await mount();
    await waitFor(() => {
      expect(screen.getByText(/club\.spec\.apply\.mine\.submittedAt/)).toBeTruthy();
    });
    expect(screen.queryByText(/club\.spec\.apply\.mine\.reviewedAt/)).toBeNull();
    first.unmount();
    cleanup();

    h.mine = [myApplication({ reviewed_at: clubIsoOffset(60 * 24) })];
    await mount();
    await waitFor(() => {
      expect(screen.getByText(/club\.spec\.apply\.mine\.reviewedAt/)).toBeTruthy();
    });
  });

  it("etykieta specjalizacji w historii idzie z katalogu, a nieznana degraduje do sluga", async () => {
    h.specs = [specRow({ slug: "energia", label_pl: "Energetyka" })];
    h.mine = [
      myApplication({ id: "app-1", specialization_slug: "energia" }),
      myApplication({ id: "app-2", specialization_slug: "slug-bez-katalogu" }),
    ];
    await mount();
    await waitFor(() => {
      expect(screen.getByText("Energetyka")).toBeTruthy();
    });
    expect(screen.getByText("slug-bez-katalogu")).toBeTruthy();
  });

  it("gość nie pyta o historię - zapytanie jest wyłączone bez konta", async () => {
    h.user = null;
    h.mine = [myApplication()];
    await mount();
    expect(screen.queryByText("club.spec.apply.mine.title")).toBeNull();
  });

  it("pusta historia nie zostawia nagłówka sekcji bez treści", async () => {
    h.mine = [];
    await mount();
    expect(screen.queryByText("club.spec.apply.mine.title")).toBeNull();
  });
});

// --- 8. pola opcjonalne ----------------------------------------------------

describe("pola opcjonalne - każde ma własny handler i trafia do payloadu", () => {
  // Sześć pól nieobowiązkowych to sześć osobnych handlerów `onChange`. Bez
  // dotknięcia ich w teście nie wiadomo, czy `set()` dostaje WŁAŚCIWY klucz -
  // a przeklejona nazwa pola (`set("city", ...)` w polu miasta obok) przechodzi
  // przez `tsc`, bo oba są napisami, i cicho gubi dane kandydata.
  const OPTIONAL: readonly { label: string; value: string; key: keyof ClubApplyValues }[] = [
    { label: "club.spec.apply.city", value: "Warszawa", key: "city" },
    { label: "club.spec.apply.years", value: "12", key: "yearsExperience" },
    {
      label: "club.spec.apply.linkedin",
      value: "https://www.linkedin.com/in/jan-kowalski",
      key: "linkedinUrl",
    },
    { label: "club.spec.apply.languages", value: "polski, angielski", key: "languages" },
    { label: "club.spec.apply.contribution", value: "Analizy sektorowe.", key: "contribution" },
    { label: "club.spec.apply.referral", value: "Newsletter", key: "referralSource" },
  ];

  it.each(OPTIONAL)("pole $label zapisuje się pod kluczem $key", async ({ label, value, key }) => {
    await mount();
    fillValidForm();
    type(label, value);
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.submit).toHaveBeenCalledTimes(1);
    });
    const [values] = h.submit.mock.calls[0] as [ClubApplyValues, string];
    expect(values[key]).toBe(value);
  });

  it("wszystkie pola opcjonalne razem nie kolidują ze sobą", async () => {
    await mount();
    fillValidForm();
    for (const item of OPTIONAL) type(item.label, item.value);
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.submit).toHaveBeenCalledTimes(1);
    });
    const [values] = h.submit.mock.calls[0] as [ClubApplyValues, string];
    for (const item of OPTIONAL) expect(values[item.key]).toBe(item.value);
  });

  it("wersja zgody spada na `1.0`, gdy katalog zgód nie zna klucza", async () => {
    // Fallback broni zapisu do rejestru: bez wersji wpis w `user_consents` nie
    // powie, NA CO dokładnie zgodził się użytkownik.
    h.consentVersion = undefined;
    await mount();
    fillValidForm();
    fireEvent.click(screen.getByRole("checkbox", { name: "club.spec.apply.marketingConsent" }));
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.consent).toHaveBeenCalledTimes(1);
    });
    const [payload] = h.consent.mock.calls[0] as [{ data: { version: string } }];
    expect(payload.data.version).toBe("1.0");
  });
});

// --- 9. język --------------------------------------------------------------

describe("język interfejsu - PL, EN i stan przed inicjalizacją i18next", () => {
  it("brak `i18n.language` degraduje do polskiego, a nie do pustego języka", async () => {
    // Odczyt `head()`/pierwszego renderu może wyprzedzić inicjalizację i18next.
    h.lang = undefined;
    await mount();
    fillValidForm();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.submit).toHaveBeenCalledTimes(1);
    });
    expect(h.submit.mock.calls[0][1]).toBe("pl");
  });

  it("wariant regionalny `pl-PL` też jest polskim", async () => {
    h.lang = "pl-PL";
    await mount();
    fillValidForm();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.submit.mock.calls[0][1]).toBe("pl");
    });
  });

  it("każdy inny język to `en` - nie ma trzeciej ścieżki", async () => {
    h.lang = "de";
    await mount();
    fillValidForm();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(h.submit.mock.calls[0][1]).toBe("en");
    });
  });

  it("EN bierze etykiety angielskie specjalizacji i klubu", async () => {
    h.lang = "en";
    h.specs = [specRow({ slug: "energia", label_pl: "Energetyka", label_en: "Energy" })];
    h.clubs = {
      rows: [clubListRow({ min_tier_rank: 0, name_pl: "Klub PL", name_en: "Club EN" })],
      total: 1,
    };
    await mount(`${PATH}?spec=energia`);
    const specLabels = Array.from(
      screen.getByLabelText("club.spec.apply.specialization").querySelectorAll("option"),
    ).map((option) => option.textContent);
    expect(specLabels).toContain("Energy");
    const clubLabels = Array.from(
      screen.getByLabelText("club.spec.apply.club").querySelectorAll("option"),
    ).map((option) => option.textContent);
    expect(clubLabels).toContain("Club EN");
  });

  it("EN bez etykiety angielskiej degraduje do polskiej - nigdy do pustki", async () => {
    // To nie kosmetyka: pusta etykieta w liście rozwijanej daje opcję, której
    // nie da się wybrać wzrokiem, a wartość i tak poleci do zgłoszenia.
    h.lang = "en";
    h.specs = [specRow({ slug: "energia", label_pl: "Energetyka", label_en: "" })];
    h.clubs = {
      rows: [clubListRow({ min_tier_rank: 0, name_pl: "Klub PL", name_en: "" })],
      total: 1,
    };
    await mount(`${PATH}?spec=energia`);
    const specLabels = Array.from(
      screen.getByLabelText("club.spec.apply.specialization").querySelectorAll("option"),
    ).map((option) => option.textContent);
    expect(specLabels).toContain("Energetyka");
    const clubLabels = Array.from(
      screen.getByLabelText("club.spec.apply.club").querySelectorAll("option"),
    ).map((option) => option.textContent);
    expect(clubLabels).toContain("Klub PL");
  });

  it("PL bez etykiety polskiej degraduje do angielskiej", async () => {
    h.specs = [specRow({ slug: "energia", label_pl: "", label_en: "Energy" })];
    h.clubs = {
      rows: [clubListRow({ min_tier_rank: 0, name_pl: "", name_en: "Club EN" })],
      total: 1,
    };
    await mount(`${PATH}?spec=energia`);
    const clubLabels = Array.from(
      screen.getByLabelText("club.spec.apply.club").querySelectorAll("option"),
    ).map((option) => option.textContent);
    expect(clubLabels).toContain("Club EN");
  });

  it("EN bez PRO+ nazywa warstwę po angielsku", async () => {
    h.lang = "en";
    h.tier = { rank: PRO_MIN_RANK - 1, name_pl: "BASIC polski", name_en: "BASIC english" };
    await mount();
    expect(screen.getByText("club.spec.apply.gate.proLead(tier=BASIC english)")).toBeTruthy();
  });

  it("EN bez danych warstwy nie wypisuje `undefined` w bramce", async () => {
    h.lang = "en";
    h.tier = null;
    await mount();
    expect(screen.getByText("club.spec.apply.gate.proLead(tier=)")).toBeTruthy();
  });

  it("EN z PRO+ nazywa warstwę po angielsku w bramce zaliczonej", async () => {
    h.lang = "en";
    h.tier = { rank: PRO_MIN_RANK, name_pl: "PRO polski", name_en: "PRO english" };
    await mount();
    expect(screen.getByText("club.spec.apply.gate.okLead(tier=PRO english)")).toBeTruthy();
  });

  it("EN w historii zgłoszeń bierze angielskie nazwy klubu i specjalizacji", async () => {
    h.lang = "en";
    h.specs = [specRow({ slug: "energia", label_pl: "Energetyka", label_en: "Energy" })];
    h.mine = [
      myApplication({
        specialization_slug: "energia",
        club_name_pl: "Klub PL",
        club_name_en: "Club EN",
      }),
    ];
    await mount();
    // Etykieta specjalizacji żyje też w liście rozwijanej formularza, więc
    // asercja jest ZAWĘŻONA do sekcji historii - inaczej test przechodziłby na
    // opcji selecta i nie dowodziłby niczego o `specLabel`.
    const history = await waitFor(() => screen.getByRole("region"));
    expect(within(history).getByText("Club EN")).toBeTruthy();
    expect(within(history).getByText("Energy")).toBeTruthy();
  });

  it("EN w historii degraduje do polskich nazw, gdy angielskich brak", async () => {
    h.lang = "en";
    h.specs = [specRow({ slug: "energia", label_pl: "Energetyka", label_en: "" })];
    h.mine = [
      myApplication({ specialization_slug: "energia", club_name_pl: "Klub PL", club_name_en: "" }),
    ];
    await mount();
    const history = await waitFor(() => screen.getByRole("region"));
    expect(within(history).getByText("Klub PL")).toBeTruthy();
    expect(within(history).getByText("Energetyka")).toBeTruthy();
  });

  it("PL w historii degraduje do angielskiej etykiety specjalizacji, gdy polskiej brak", async () => {
    h.specs = [specRow({ slug: "energia", label_pl: "", label_en: "Energy" })];
    h.mine = [myApplication({ specialization_slug: "energia" })];
    await mount();
    const history = await waitFor(() => screen.getByRole("region"));
    expect(within(history).getByText("Energy")).toBeTruthy();
  });

  it("historia bez katalogu RPC sięga po katalog WBUDOWANY, zamiast pokazać slug", async () => {
    h.specs = undefined;
    h.mine = [myApplication({ specialization_slug: "transport" })];
    await mount();
    await waitFor(() => {
      expect(screen.getByText("club.spec.items.transport.title")).toBeTruthy();
    });
  });
});
