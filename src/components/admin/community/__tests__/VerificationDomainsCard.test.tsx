// Katalog zaufanych domen - kontrakt DOPUSZCZENIA DO SPOŁECZNOŚCI.
//
// PO CO TEN PLIK ISTNIEJE. Wpis w tym katalogu to REGUŁA UPRAWNIENIOWA, nie
// notatka porządkowa: konto z potwierdzonym adresem w domenie z listy dostaje
// automatycznie odznakę „Zweryfikowany”, a gdy admin wskaże plan - także
// bezterminowe członkostwo (domyślnie VIP, czyli pełny dostęp do materiałów
// płatnych). Odwrotnie: usunięcie domeny odbiera podstawę tych nadań kolejnym
// kontom. Panel stał bez ANI JEDNEGO testu (0/51 linii, 0/22 funkcji), więc
// nic nie pilnowało, jaka wartość naprawdę idzie do RPC nadającego uprawnienia
// ani czy usunięcie w ogóle o cokolwiek pyta. Brak testu na regule wstępu do
// społeczności jest defektem uprawnień, nie brakiem kosmetyki.
//
// PRZEDMIOT DOWODU:
//   1. NORMALIZACJA WEJŚCIA. Do RPC ma pójść goły host małymi literami -
//      niezależnie od tego, czy operator wklei „ Example.COM ”, „@example.com”,
//      „https://example.com/kontakt”, adres z kropką na końcu czy cały adres
//      e-mail. To nie kosmetyka: `example.com` i `Example.com` jako dwa wiersze
//      dałyby dwa różne katalogi zaufania, z których jeden nikt nie usunie.
//   2. ODRZUCENIE ŚMIECI. Pusty napis, host bez kropki, spacja i znaki spoza
//      dozwolonego zestawu NIE MOGĄ dać wywołania RPC - przycisk „Dodaj”
//      pozostaje wyłączony. Dowód mierzy BRAK SKUTKU (zero wywołań), nie kolor
//      przycisku.
//   3. DUPLIKAT. Ta sama domena w innej pisowni składa się w JEDEN klucz, więc
//      drugi wpis nie powstaje po stronie klienta.
//   4. USUNIĘCIE PYTA I RESPEKTUJE ODMOWĘ. `confirmDialog` dostaje domenę
//      w treści pytania i wariant destrukcyjny; „nie” NIE woła RPC usuwającego.
//      Usunięcie odbiera ludziom prawo wstępu, więc pytanie jest częścią
//      kontraktu, a nie uprzejmością.
//   5. BŁĄD ZAPISU. Każda z czterech mutacji (dodanie, przełączenie, usunięcie,
//      przegląd) na błędzie RPC melduje toast błędu i NIE rusza listy.
//   6. INWALIDACJA. Sukces unieważnia trzy klucze cache (`admin-verification-
//      domains`, `admin-badges`, `profile-badges`) - odznaka nadana z katalogu
//      musi zniknąć/pojawić się też w widokach profilu, nie tylko tutaj.
//   7. STAN PUSTY, STAN ŁADOWANIA, BRAK TENANTA.
//   8. DOSTĘPNOŚĆ mierzona `axeViolations`, nie okiem.
//
// RYZYKO ZASTANE, KTÓREGO TEN PANEL NIE ADRESUJE (pinowane testami niżej,
// świadomie NIE naprawiane w pakiecie testowym): kod nie odsiewa PUBLICZNYCH
// domen pocztowych. `gmail.com`, `wp.pl` czy `outlook.com` przechodzą walidację
// jak każdy inny host, a wklejony adres z darmowej skrzynki normalizuje się do
// samej `gmail.com`. Skutek jednego kliknięcia: każde konto Gmaila z potwierdzonym
// adresem dostaje odznakę „Zweryfikowany” i - przy domyślnym ustawieniu selecta,
// czyli VIP - bezterminowe członkostwo z pełnym dostępem do materiałów. To nie
// jest literówka do wyłapania w code review, bo panel wygląda wtedy dokładnie
// tak samo jak przy domenie firmowej. Miejsce na lekarstwo: lista blokująca
// w `@/lib/admin/verificationDomains` (obok `isValidVerificationDomain`), żeby
// bramka działała także dla wywołań spoza tego panelu.
//
// CO JEST ATRAPOWANE I DLACZEGO:
//   * klient Supabase (`rpc` + `from`) - granica sieci; żaden test nie wychodzi
//     do sieci. Atrapa ZAPISUJE nazwę funkcji i argumenty, bo cały dowód
//     normalizacji polega na tym, CO poszło do `admin_upsert_verification_domain`.
//   * `@/lib/appDialogs` - prawdziwy dialog rysuje `<AppDialogHost />` z
//     `__root.tsx`, którego w tym drzewie nie ma, więc obietnica nigdy by się
//     nie rozwiązała. Atrapa przyjmuje argument, żeby test asertował TREŚĆ
//     pytania (domena, wariant destrukcyjny).
//   * `sonner` - toast jest tu jedynym kanałem meldunku o błędzie.
//   * `@/components/atoms/FormSelect` - Radix Select nie rozwija listy pod
//     happy-dom (brak pointer API); natywny `<select>` przenosi tę samą wartość
//     tą samą drogą (konwencja repo, patrz `EventTypesManager.test.tsx`).
// PRAWDZIWE biegną: `@/lib/admin/verificationDomains` (normalizacja, walidacja,
// mapowanie wiersza, `parseSweepResult`), słownik `i18n-admin-community`
// (`realT`, więc asercje mierzą napisy ze słownika, nie kopie z komponentu),
// `ProfileBadge`, `Switch`, `Card`.
//
// GRANICA DOWODU. Prawdziwą unikalność domeny egzekwuje baza (indeks unikalny
// i `ON CONFLICT` w RPC SECURITY DEFINER), a przypisanie do tenanta wyprowadza
// się z sesji administratora - klient nie podaje `tenant_id` i nie ma go czym
// podać. Na atrapie RPC nie da się tego dowieść i ten plik tego nie udaje:
// dowodzi wyłącznie, że klient wysyła JEDEN, znormalizowany klucz i nie dokłada
// własnego filtra tenanta. Reszta należy do testów RLS/RPC w `supabase/`.
//
// RODO: wszystkie domeny i notatki są zmyślone, adresy wyłącznie `@example.com`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, fail, supabaseFromStub, pgError, type SupabaseResult } from "@/test/supabaseChain";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { VerificationDomainsCard } from "@/components/admin/community/VerificationDomainsCard";

/** Kształt pytania, które panel zadaje przed usunięciem (`@/lib/appDialogs`). */
interface ConfirmDialogOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

/** Odpowiedź RPC: albo gotowa, albo obliczana (np. obietnica bez końca). */
type RpcResponder = () => Promise<SupabaseResult> | SupabaseResult;

interface RpcCall {
  readonly fn: string;
  readonly args: Record<string, unknown> | undefined;
}

const h = vi.hoisted(() => {
  const state: {
    from: (table: string) => unknown;
    rpc: (fn: string, args?: Record<string, unknown>) => Promise<SupabaseResult>;
  } = {
    from: () => ({}),
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return {
    state,
    toastSuccess: vi.fn<(message: string) => void>(),
    toastError: vi.fn<(message: string) => void>(),
    confirm: vi.fn<(opts: ConfirmDialogOptions) => Promise<boolean>>(),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.state.from(table),
    rpc: (fn: string, args?: Record<string, unknown>) => h.state.rpc(fn, args),
  },
}));

// `react-i18next` ŚWIADOMIE NIE JEST ATRAPOWANY. Przedmiotem dowodu są napisy
// ZE SŁOWNIKA (`realT` czyta tę samą instancję i18next, co aplikacja), a skrót
// `vi.mock("react-i18next", () => reactI18nextMock())` jest tu zakazany:
// fabryka sięgnęłaby po `@/lib/i18n`, który importuje właśnie atrapowany moduł,
// i plik zawiesiłby się bez komunikatu (zmierzone: przebieg bez końca; ta sama
// pułapka opisana w `AdminDonations.test.tsx`). Domyślnym językiem instancji
// jest polski i tak zostaje - wariant angielski panelu jedzie propsem
// `language`, nie zmianą języka interfejsu.
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: h.confirm }));

// Radix Select nie renderuje opcji bez pointer API - droplista planu jest tu
// natywnym `<select>`, którego wartość jedzie do `onValueChange` tak samo.
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    value,
    options,
    onValueChange,
    "aria-label": ariaLabel,
  }: {
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (next: string) => void;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const LIST_FN = "admin_list_verification_domains";
const UPSERT_FN = "admin_upsert_verification_domain";
const DELETE_FN = "admin_delete_verification_domain";
const SWEEP_FN = "admin_run_org_verification";

const TENANT = "tenant-nes-example";
const ROW_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const OTHER_ROW_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const t = realT("pl");
const KEY = (suffix: string): string => `adminCommunity.verificationDomains.${suffix}`;
const S = {
  emailDomain: t(KEY("emailDomain")),
  domainNote: t(KEY("domainNote")),
  grantedMembershipPlan: t(KEY("grantedMembershipPlan")),
  requireEmailConfirmation: t(KEY("requireEmailConfirmation")),
  academicDomain: t(KEY("academicDomain")),
  academicBadge: t(KEY("academicBadge")),
  addDomain: t(KEY("addDomain")),
  removeDomain: t(KEY("removeDomain")),
  removeConfirmTitle: t(KEY("removeConfirmTitle")),
  remove: t(KEY("remove")),
  runReview: t(KEY("runReview")),
  noTrustedDomains: t(KEY("noTrustedDomains")),
  noMembershipGrant: t(KEY("noMembershipGrant")),
  noEmailConfirmation: t(KEY("noEmailConfirmation")),
  domainSaved: t(KEY("domainSaved")),
  couldNotSaveDomain: t(KEY("couldNotSaveDomain")),
  couldNotUpdateDomain: t(KEY("couldNotUpdateDomain")),
  domainRemoved: t(KEY("domainRemoved")),
  couldNotRemoveDomain: t(KEY("couldNotRemoveDomain")),
  reviewFailed: t(KEY("reviewFailed")),
} as const;

/** Wiersz w kształcie, w jakim oddaje go RPC (`badge` jako goły napis). */
interface RawDomainRow {
  id: string;
  tenant_id: string;
  domain: string;
  badge: string;
  note: string | null;
  active: boolean;
  require_email_confirmed: boolean;
  grants_tier_key: string | null;
  academic: boolean;
  created_at: string;
  updated_at: string;
}

function domainRow(over: Partial<RawDomainRow> = {}): RawDomainRow {
  return {
    id: ROW_ID,
    tenant_id: TENANT,
    domain: "example.com",
    badge: "verified",
    note: null,
    active: true,
    require_email_confirmed: true,
    grants_tier_key: null,
    academic: false,
    created_at: "2026-01-02T10:00:00.000Z",
    updated_at: "2026-01-02T10:00:00.000Z",
    ...over,
  };
}

/** Warstwy członkostwa czytane osobnym zapytaniem (`membership_tiers`). */
function tierRows() {
  return [
    { key: "vip", name_pl: "VIP NES", name_en: "NES VIP", rank: 40, active: true },
    { key: "pro", name_pl: "Profesjonalny", name_en: "Professional", rank: 20, active: true },
  ];
}

const rpcCalls: RpcCall[] = [];
const rpcPlan = new Map<string, RpcResponder>();

function setRpc(fn: string, responder: RpcResponder | SupabaseResult): void {
  rpcPlan.set(fn, typeof responder === "function" ? responder : () => responder);
}

function rpcHandler(fn: string, args?: Record<string, unknown>): Promise<SupabaseResult> {
  rpcCalls.push({ fn, args });
  const planned = rpcPlan.get(fn);
  // Brak zaplanowanej odpowiedzi to błąd testu, nie „pusty wynik” - cichy
  // `null` udawałby poprawny odczyt katalogu, którego test nie zaplanował.
  if (!planned) {
    return Promise.resolve({
      data: null,
      error: pgError(`test: brak zaplanowanej odpowiedzi RPC "${fn}"`),
    });
  }
  return Promise.resolve(planned());
}

function callsOf(fn: string): RpcCall[] {
  return rpcCalls.filter((call) => call.fn === fn);
}

function lastArgs(fn: string): Record<string, unknown> | undefined {
  return callsOf(fn).at(-1)?.args;
}

let chains = supabaseFromStub();

beforeEach(() => {
  rpcCalls.length = 0;
  rpcPlan.clear();
  chains = supabaseFromStub();
  chains.setResponse("membership_tiers", ok(tierRows()));
  h.state.from = chains.from;
  h.state.rpc = rpcHandler;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(true);
  setRpc(LIST_FN, ok([domainRow()]));
  setRpc(UPSERT_FN, ok(ROW_ID));
  setRpc(DELETE_FN, ok(null));
  setRpc(SWEEP_FN, ok({ checked: 12, granted: 3, revoked: 1 }));
});

function renderCard(props: { tenantId?: string | null; language?: "pl" | "en" } = {}) {
  const view = renderWithQueryClient(
    <VerificationDomainsCard
      language={props.language ?? "pl"}
      tenantId={props.tenantId === undefined ? TENANT : props.tenantId}
    />,
  );
  const invalidated = vi.spyOn(view.queryClient, "invalidateQueries");
  return { ...view, invalidated };
}

/** Render + czekanie na pierwszy odczyt katalogu, żeby klik nie wyprzedzał danych. */
async function renderReady(props: { language?: "pl" | "en" } = {}) {
  const view = renderCard(props);
  await waitFor(() => expect(callsOf(LIST_FN)).toHaveLength(1));
  return view;
}

function typeDomain(value: string): void {
  fireEvent.change(screen.getByLabelText(S.emailDomain), { target: { value } });
}

function addButton(): HTMLElement {
  return screen.getByRole("button", { name: S.addDomain });
}

/** Liczba wierszy katalogu liczona po przyciskach usunięcia - jeden na wiersz. */
function rowCount(): number {
  return screen.queryAllByRole("button", { name: S.removeDomain }).length;
}

/**
 * Oddaje sterowanie pętli zdarzeń. Potrzebne tam, gdzie dowodzimy BRAKU skutku
 * po rozwiązaniu obietnicy (odmowa w dialogu): bez tego asercja mierzyłaby
 * moment, w którym mutacja i tak by jeszcze nie wystartowała.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("VerificationDomainsCard - normalizacja domeny przed zapisem", () => {
  it.each([
    ["  Example.COM  ", "spacje i wielkie litery"],
    ["@Example.com", "małpa na początku"],
    ["https://Example.com/kontakt", "wklejony adres strony"],
    ["example.com.", "kropka na końcu"],
    ["biuro@Example.com", "cały adres e-mail zamiast domeny"],
  ])("„%s” (%s) idzie do RPC jako example.com", async (input) => {
    await renderReady();
    typeDomain(input);
    fireEvent.click(addButton());

    await waitFor(() => expect(callsOf(UPSERT_FN)).toHaveLength(1));
    // Skutek mierzony w argumencie RPC, nie w polu formularza: to ta wartość
    // stanie się regułą nadawania odznaki i planu.
    expect(lastArgs(UPSERT_FN)?.p_domain).toBe("example.com");
  });

  it("subdomena zostaje subdomeną - zaufanie nie rozlewa się na cały host", async () => {
    await renderReady();
    typeDomain("Kadry.Example.COM");
    fireEvent.click(addButton());

    await waitFor(() => expect(callsOf(UPSERT_FN)).toHaveLength(1));
    // Gdyby normalizacja obcinała do domeny drugiego poziomu, wpis dla działu
    // kadr otworzyłby weryfikację całej firmie.
    expect(lastArgs(UPSERT_FN)?.p_domain).toBe("kadry.example.com");
  });

  it("ta sama domena w dwóch pisowniach daje JEDEN klucz, nie drugi wpis", async () => {
    const { container } = await renderReady();

    typeDomain("example.com");
    fireEvent.click(addButton());
    await waitFor(() => expect(callsOf(UPSERT_FN)).toHaveLength(1));

    typeDomain("  EXAMPLE.com ");
    fireEvent.click(addButton());
    await waitFor(() => expect(callsOf(UPSERT_FN)).toHaveLength(2));

    // Oba wywołania niosą IDENTYCZNY klucz, więc `ON CONFLICT` w RPC ma na czym
    // zadziałać, a lista po odświeżeniu nadal ma jeden wiersz. Sama unikalność
    // to indeks w bazie - tego atrapa RPC nie dowodzi i nie udaje.
    expect(callsOf(UPSERT_FN).map((call) => call.args?.p_domain)).toEqual([
      "example.com",
      "example.com",
    ]);
    await waitFor(() => expect(rowCount()).toBe(1));
    expect(within(container).getAllByText("example.com")).toHaveLength(1);
  });

  it("udany zapis czyści domenę i notatkę, ale ZOSTAWIA wybrany plan", async () => {
    await renderReady();
    // Opcje planów przychodzą osobnym zapytaniem - zmiana wartości selecta
    // przed ich dojściem byłaby bezgłośnym brakiem trafienia.
    await screen.findByRole("option", { name: "Profesjonalny" });
    fireEvent.change(screen.getByLabelText(S.grantedMembershipPlan), {
      target: { value: "pro" },
    });
    typeDomain("example.org");
    fireEvent.change(screen.getByLabelText(S.domainNote), {
      target: { value: "Partner konferencyjny" },
    });
    fireEvent.click(addButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(S.domainSaved));
    // Wpisywanie serii domen tego samego partnera nie ma zmuszać do
    // przeklikiwania planu za każdym razem - czyszczone jest tylko wejście.
    expect(screen.getByLabelText(S.emailDomain)).toHaveValue("");
    expect(screen.getByLabelText(S.domainNote)).toHaveValue("");
    expect(screen.getByLabelText(S.grantedMembershipPlan)).toHaveValue("pro");
  });
});

describe("VerificationDomainsCard - odrzucenie wejścia, które nie jest domeną", () => {
  it.each([
    ["", "pusty napis"],
    ["example", "host bez kropki"],
    ["exa mple.com", "spacja w środku"],
    ["ex_ample.com", "podkreślenie"],
    ["-example.com", "dywiz na początku etykiety"],
    ["example..com", "podwójna kropka"],
    ["@", "sama małpa"],
  ])("„%s” (%s) nie daje ANI JEDNEGO wywołania RPC", async (input) => {
    await renderReady();
    typeDomain(input);

    // Bramka to `isValidVerificationDomain` z prawdziwej warstwy danych.
    // Dowodem jest brak skutku: przycisk wyłączony ORAZ zero wywołań RPC
    // nawet po kliknięciu (klik w wyłączony przycisk nie może przeciekać).
    expect(addButton()).toBeDisabled();
    fireEvent.click(addButton());
    await flush();
    expect(callsOf(UPSERT_FN)).toHaveLength(0);
  });

  it("poprawna domena ODBLOKOWUJE przycisk - bramka nie jest zawsze zamknięta", async () => {
    await renderReady();
    typeDomain("example");
    expect(addButton()).toBeDisabled();

    // KONTROLA DODATNIA dla tabeli wyżej: gdyby przycisk był wyłączony na
    // stałe, wszystkie tamte przypadki przechodziłyby bez żadnej walidacji.
    typeDomain("example.com");
    expect(addButton()).toBeEnabled();
  });
});

describe("VerificationDomainsCard - publiczne domeny pocztowe (ryzyko zastane)", () => {
  it.each(["gmail.com", "wp.pl", "outlook.com"])(
    "%s przechodzi walidację jak domena firmowa - katalog NIE ma listy blokującej",
    async (freemail) => {
      await renderReady();
      typeDomain(freemail);
      fireEvent.click(addButton());

      // STAN ZASTANY PRZYPIĘTY ŚWIADOMIE. Panel przyjmuje publiczną domenę
      // pocztową bez ostrzeżenia, więc jedno kliknięcie otwiera weryfikację
      // (i domyślnie plan VIP) każdemu, kto ma tam skrzynkę. Jeśli ktoś dołoży
      // listę blokującą, TEN test padnie - i to jest jego rola: zmiana reguły
      // wstępu do społeczności ma być decyzją widoczną w diffie, nie efektem
      // ubocznym. Opis skutku i miejsce na lekarstwo: nagłówek pliku.
      await waitFor(() => expect(callsOf(UPSERT_FN)).toHaveLength(1));
      expect(lastArgs(UPSERT_FN)?.p_domain).toBe(freemail);
      expect(h.toastError).not.toHaveBeenCalled();
    },
  );

  it("wklejony adres z darmowej skrzynki normalizuje się do samej gmail.com", async () => {
    await renderReady();
    typeDomain("ktos.zmyslony@Gmail.com");
    fireEvent.click(addButton());

    // Najbardziej prawdopodobna pomyłka operatora: wkleja adres kontaktowy
    // osoby z Gmaila, a dostaje regułę dla całego Gmaila.
    await waitFor(() => expect(lastArgs(UPSERT_FN)?.p_domain).toBe("gmail.com"));
  });

  it.fails("PREFIKS www NIE JEST OBCINANY - wpis nigdy nie trafi w adres", async () => {
    // ZNALEZISKO. `normalizeDomainInput` obcina protokół i ścieżkę (czyli
    // wklejenie URL-a jest ŚWIADOMIE obsługiwaną drogą wejścia), ale zostawia
    // `www.`. Wpis `www.example.com` przechodzi walidację i ląduje w katalogu,
    // tylko że żaden adres e-mail nie kończy się na `@www.example.com` - reguła
    // jest martwa. Administrator widzi domenę na liście i uznaje partnera za
    // zaufanego, a konta z tej firmy nie dostają ani odznaki, ani planu: awaria
    // CICHA, bez błędu i bez toastu. Lekarstwo to jedna linia w
    // `@/lib/admin/verificationDomains` (`value.replace(/^www\./, "")`), ale to
    // zmiana zachowania produkcyjnego, więc idzie do raportu, nie do kodu.
    await renderReady();
    typeDomain("https://www.Example.com/o-nas");
    fireEvent.click(addButton());

    await waitFor(() => expect(callsOf(UPSERT_FN)).toHaveLength(1));
    expect(lastArgs(UPSERT_FN)?.p_domain).toBe("example.com");
  });

  it("KONTROLA DODATNIA znaleziska: bez www ten sam URL normalizuje się poprawnie", async () => {
    await renderReady();
    typeDomain("https://Example.com/o-nas");
    fireEvent.click(addButton());

    // Ten sam wklejony URL bez `www` daje czysty host, więc `it.fails` wyżej
    // mierzy WYŁĄCZNIE brak obcięcia prefiksu, a nie zepsuty tor wklejania.
    await waitFor(() => expect(lastArgs(UPSERT_FN)?.p_domain).toBe("example.com"));
    expect(callsOf(UPSERT_FN)).toHaveLength(1);
  });
});

describe("VerificationDomainsCard - co dokładnie nadaje wpis", () => {
  it("domyślnie nadaje VIP i wymaga potwierdzenia adresu", async () => {
    await renderReady();
    typeDomain("example.com");
    fireEvent.click(addButton());

    await waitFor(() => expect(callsOf(UPSERT_FN)).toHaveLength(1));
    const args = lastArgs(UPSERT_FN);
    // Domyślny stan formularza JEST decyzją uprawnieniową: dodanie domeny bez
    // dotykania selecta rozdaje bezterminowe członkostwo VIP.
    expect(args?.p_grants_tier_key).toBe("vip");
    expect(args?.p_require_email_confirmed).toBe(true);
    expect(args?.p_academic).toBe(false);
    expect(args?.p_badge).toBe("verified");
  });

  it("wybór „bez nadania planu” nie wysyła żadnej warstwy", async () => {
    await renderReady();
    fireEvent.change(screen.getByLabelText(S.grantedMembershipPlan), {
      target: { value: "none" },
    });
    typeDomain("example.com");
    fireEvent.click(addButton());

    await waitFor(() => expect(callsOf(UPSERT_FN)).toHaveLength(1));
    // `null` z formularza staje się `undefined`, a takiego pola JSON nie wysyła
    // wcale - RPC dostaje brak nadania, nie napis „none”.
    expect(lastArgs(UPSERT_FN)?.p_grants_tier_key).toBeUndefined();
  });

  it("zdjęcie wymogu potwierdzenia adresu jedzie do RPC jako false", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("switch", { name: S.requireEmailConfirmation }));
    typeDomain("example.com");
    fireEvent.click(addButton());

    await waitFor(() => expect(callsOf(UPSERT_FN)).toHaveLength(1));
    // Bez potwierdzenia adresu wystarczy WPISAĆ adres w tej domenie, żeby dostać
    // odznakę - dlatego ta flaga musi jechać dokładnie tak, jak ją ustawiono.
    expect(lastArgs(UPSERT_FN)?.p_require_email_confirmed).toBe(false);
  });

  it("znacznik uczelni jedzie do RPC i wraca do zera po zapisie", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("switch", { name: S.academicDomain }));
    typeDomain("uczelnia.example.org");
    fireEvent.click(addButton());

    await waitFor(() => expect(callsOf(UPSERT_FN)).toHaveLength(1));
    expect(lastArgs(UPSERT_FN)?.p_academic).toBe(true);
    // Znacznik uczelni zwalnia ze RĘCZNEJ weryfikacji stawki studenckiej, więc
    // nie może „przykleić się” do następnej wpisywanej domeny.
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: S.academicDomain })).not.toBeChecked(),
    );
  });

  it("notatka wysyłana jest bez otoczki, a pusta nie jest wysyłana wcale", async () => {
    await renderReady();
    typeDomain("example.com");
    fireEvent.change(screen.getByLabelText(S.domainNote), {
      target: { value: "  Umowa 2026  " },
    });
    fireEvent.click(addButton());

    await waitFor(() => expect(callsOf(UPSERT_FN)).toHaveLength(1));
    expect(lastArgs(UPSERT_FN)?.p_note).toBe("Umowa 2026");

    typeDomain("example.net");
    fireEvent.click(addButton());
    await waitFor(() => expect(callsOf(UPSERT_FN)).toHaveLength(2));
    expect(lastArgs(UPSERT_FN)?.p_note).toBeUndefined();
  });
});

describe("VerificationDomainsCard - usunięcie domeny wymaga potwierdzenia", () => {
  it("pyta z nazwą domeny w treści i wariantem destrukcyjnym", async () => {
    await renderReady();
    await waitFor(() => expect(rowCount()).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: S.removeDomain }));

    // Usunięcie odbiera kolejnym kontom prawo wstępu, więc pytanie musi
    // powiedzieć O KTÓRĄ domenę chodzi i wyglądać na nieodwracalne.
    await waitFor(() =>
      expect(h.confirm).toHaveBeenCalledWith({
        title: S.removeConfirmTitle,
        description: t(KEY("removeConfirmBody"), { domain: "example.com" }),
        confirmLabel: S.remove,
        destructive: true,
      }),
    );
  });

  it("potwierdzenie usuwa WSKAZANY wiersz i melduje sukces", async () => {
    setRpc(
      LIST_FN,
      ok([domainRow(), domainRow({ id: OTHER_ROW_ID, domain: "partner.example.org" })]),
    );
    await renderReady();
    await waitFor(() => expect(rowCount()).toBe(2));

    fireEvent.click(screen.getAllByRole("button", { name: S.removeDomain })[1]);

    // Identyfikator DRUGIEGO wiersza, nie pierwszego i nie indeksu na liście.
    await waitFor(() => expect(callsOf(DELETE_FN)).toHaveLength(1));
    expect(lastArgs(DELETE_FN)?.p_id).toBe(OTHER_ROW_ID);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(S.domainRemoved));
  });

  it("ODMOWA w dialogu nie woła RPC i zostawia wiersz na liście", async () => {
    h.confirm.mockResolvedValue(false);
    await renderReady();
    await waitFor(() => expect(rowCount()).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: S.removeDomain }));

    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1));
    await flush();
    // Brak skutku: żadnego usunięcia, żadnego toastu, wiersz nadal na liście.
    expect(callsOf(DELETE_FN)).toHaveLength(0);
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(rowCount()).toBe(1);
  });
});

describe("VerificationDomainsCard - przełącznik aktywności wiersza", () => {
  it("wyłączenie domeny zachowuje WSZYSTKIE pozostałe pola wiersza", async () => {
    setRpc(
      LIST_FN,
      ok([
        domainRow({
          academic: true,
          grants_tier_key: "pro",
          require_email_confirmed: false,
          note: "Uczelnia partnerska",
        }),
      ]),
    );
    await renderReady();

    const rowSwitch = await screen.findByRole("switch", {
      name: t(KEY("domainActive"), { domain: "example.com" }),
    });
    fireEvent.click(rowSwitch);

    await waitFor(() => expect(callsOf(UPSERT_FN)).toHaveLength(1));
    const args = lastArgs(UPSERT_FN);
    // RPC to UPSERT całego wiersza: pominięcie któregokolwiek pola skasowałoby
    // je przy pierwszym kliknięciu w suwak (znacznik uczelni, plan, wymóg
    // potwierdzenia). Dokładnie o to ostrzega komentarz w komponencie.
    expect(args?.p_active).toBe(false);
    expect(args?.p_academic).toBe(true);
    expect(args?.p_grants_tier_key).toBe("pro");
    expect(args?.p_require_email_confirmed).toBe(false);
    expect(args?.p_domain).toBe("example.com");
  });

  it("błąd przełączenia melduje toast i nie zmienia listy", async () => {
    setRpc(UPSERT_FN, fail("permission denied for function", "42501"));
    await renderReady();

    fireEvent.click(
      await screen.findByRole("switch", {
        name: t(KEY("domainActive"), { domain: "example.com" }),
      }),
    );

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(S.couldNotUpdateDomain));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(rowCount()).toBe(1);
  });
});

describe("VerificationDomainsCard - błąd zapisu i inwalidacja cache", () => {
  it("błąd dodania melduje toast, NIE czyści pola i nie dopisuje wiersza", async () => {
    setRpc(UPSERT_FN, fail("duplicate key value violates unique constraint", "23505"));
    const { container } = await renderReady();

    typeDomain("nowa.example.org");
    fireEvent.click(addButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(S.couldNotSaveDomain));
    // Wpisana wartość zostaje, żeby operator mógł ponowić bez przepisywania.
    expect(screen.getByLabelText(S.emailDomain)).toHaveValue("nowa.example.org");
    expect(within(container).queryByText("nowa.example.org")).not.toBeInTheDocument();
    expect(rowCount()).toBe(1);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("błąd usunięcia melduje toast i zostawia wiersz", async () => {
    setRpc(DELETE_FN, fail("permission denied for function", "42501"));
    await renderReady();
    await waitFor(() => expect(rowCount()).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: S.removeDomain }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(S.couldNotRemoveDomain));
    expect(rowCount()).toBe(1);
  });

  it("sukces dodania unieważnia katalog ORAZ odznaki w widokach profilu", async () => {
    const { invalidated } = await renderReady();
    typeDomain("example.org");
    fireEvent.click(addButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(S.domainSaved));
    // Katalog nadaje odznakę i plan, więc odświeżenie samej listy zostawiłoby
    // nieaktualną odznakę w panelu odznak i na profilu.
    expect(invalidated.mock.calls.map((call) => call[0]?.queryKey)).toEqual([
      ["admin-verification-domains"],
      ["admin-badges"],
      ["profile-badges"],
    ]);
  });

  it("błąd dodania NIE unieważnia niczego", async () => {
    setRpc(UPSERT_FN, fail("permission denied for function", "42501"));
    const { invalidated } = await renderReady();
    typeDomain("example.org");
    fireEvent.click(addButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(S.couldNotSaveDomain));
    // Odświeżenie cache po porażce udawałoby, że coś się zmieniło.
    expect(invalidated).not.toHaveBeenCalled();
  });
});

describe("VerificationDomainsCard - przegląd weryfikacji", () => {
  it("uruchamia przegląd i pokazuje policzone skutki", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: S.runReview }));

    await waitFor(() => expect(callsOf(SWEEP_FN)).toHaveLength(1));
    // Liczby z RPC docierają do komunikatu ze SŁOWNIKA (nadane/cofnięte), bo to
    // jedyny ślad po operacji masowej na uprawnieniach.
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        t(KEY("sweepDone"), { checked: 12, granted: 3, revoked: 1 }),
      ),
    );
  });

  it("śmieciowa odpowiedź przeglądu daje zera, nie NaN na ekranie", async () => {
    setRpc(SWEEP_FN, ok({ checked: "dużo", granted: null }));
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: S.runReview }));

    // `parseSweepResult` biegnie prawdziwy: nieliczba to zero, a nie „NaN”.
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        t(KEY("sweepDone"), { checked: 0, granted: 0, revoked: 0 }),
      ),
    );
  });

  it("błąd przeglądu melduje porażkę i nie unieważnia cache", async () => {
    setRpc(SWEEP_FN, fail("statement timeout", "57014"));
    const { invalidated } = await renderReady();
    fireEvent.click(screen.getByRole("button", { name: S.runReview }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(S.reviewFailed));
    expect(invalidated).not.toHaveBeenCalled();
  });

  it("przegląd w toku blokuje przycisk - jedno kliknięcie, jeden przebieg", async () => {
    let release: (result: SupabaseResult) => void = () => undefined;
    setRpc(SWEEP_FN, () => new Promise<SupabaseResult>((resolve) => (release = resolve)));
    await renderReady();

    const button = screen.getByRole("button", { name: S.runReview });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);

    // Przegląd chodzi po wszystkich profilach tenanta - podwójne kliknięcie
    // nie może go uruchomić dwa razy równolegle.
    expect(callsOf(SWEEP_FN)).toHaveLength(1);
    release(ok({ checked: 1, granted: 0, revoked: 0 }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(1));
  });
});

describe("VerificationDomainsCard - lista, stan pusty i stan ładowania", () => {
  it("wiersz pokazuje domenę, odznakę, plan, uczelnię i notatkę", async () => {
    setRpc(
      LIST_FN,
      ok([
        domainRow({
          domain: "uczelnia.example.org",
          grants_tier_key: "pro",
          academic: true,
          require_email_confirmed: false,
          note: "Wydział prawa",
        }),
      ]),
    );
    const { container } = await renderReady();

    expect(await screen.findByText("uczelnia.example.org")).toBeInTheDocument();
    // Etykieta planu pochodzi z `membership_tiers`, nie z klucza technicznego.
    // Szukamy CAŁEJ plakietki („Plan: " + nazwa), bo sama nazwa stoi też
    // w opcji droplisty i test mierzyłby wtedy formularz, nie wiersz.
    expect(within(container).getByText(`${t(KEY("plan"))}Profesjonalny`)).toBeInTheDocument();
    expect(within(container).getByText(S.academicBadge)).toBeInTheDocument();
    // Brak wymogu potwierdzenia adresu MUSI być widoczny - to najsłabszy
    // wariant reguły wstępu.
    expect(within(container).getByText(S.noEmailConfirmation)).toBeInTheDocument();
    expect(within(container).getByText("Wydział prawa")).toBeInTheDocument();
    expect(within(container).getByText("Zweryfikowany")).toBeInTheDocument();
  });

  it("nieznany klucz planu pokazuje się wersalikami, nie znika", async () => {
    setRpc(LIST_FN, ok([domainRow({ grants_tier_key: "legacy_gold" })]));
    const { container } = await renderReady();

    // Warstwa usunięta z `membership_tiers` nie może zostawić PUSTEJ plakietki:
    // operator musi widzieć, że wiersz nadaje coś, czego już nie ma w cenniku.
    expect(await within(container).findByText(`${t(KEY("plan"))}LEGACY_GOLD`)).toBeInTheDocument();
  });

  it("wiersz z nieznaną odznaką jest odsiewany, a nie renderowany połowicznie", async () => {
    setRpc(
      LIST_FN,
      ok([
        domainRow(),
        domainRow({ id: OTHER_ROW_ID, domain: "obca.example.net", badge: "wizard" }),
      ]),
    );
    const { container } = await renderReady();

    // Mapowanie w warstwie danych (`isProfileBadgeKind`) biegnie prawdziwe:
    // wiersz z odznaką spoza katalogu wypada, zamiast wywalić render panelu.
    await waitFor(() => expect(rowCount()).toBe(1));
    expect(within(container).queryByText("obca.example.net")).not.toBeInTheDocument();
  });

  it("puste katalog mówi to wprost", async () => {
    setRpc(LIST_FN, ok([]));
    await renderReady();

    expect(await screen.findByText(S.noTrustedDomains)).toBeInTheDocument();
    expect(rowCount()).toBe(0);
  });

  it("brak tenanta wstrzymuje odczyt katalogu i warstw", async () => {
    renderCard({ tenantId: null });

    await flush();
    // `enabled: !!tenantId` - bez tenanta nie ma czego czytać, więc panel nie
    // dobija się do RPC ani do `membership_tiers`.
    expect(callsOf(LIST_FN)).toHaveLength(0);
    expect(chains.chainsFor("membership_tiers")).toHaveLength(0);
    expect(screen.getByText(S.noTrustedDomains)).toBeInTheDocument();
  });

  it.fails("STAN ŁADOWANIA UDAJE PUSTY KATALOG", async () => {
    // ZNALEZISKO. Render czyta wyłącznie `q.data ?? []`, więc dopóki odczyt
    // trwa, panel pokazuje zdanie „Brak zaufanych domen” - identycznie jak przy
    // katalogu naprawdę pustym. Operator, który wejdzie na wolnym łączu, widzi
    // „nie ma nic” i albo dopisze domenę już istniejącą, albo (gorzej) uzna, że
    // ktoś skasował katalog i zacznie odtwarzać wpisy z pamięci. Lekarstwo:
    // gałąź na `q.isPending` ze szkieletem lub jednym zdaniem o ładowaniu
    // (słownik ma już wzorce takich napisów w innych sekcjach panelu).
    setRpc(LIST_FN, () => new Promise<SupabaseResult>(() => undefined));
    renderCard();

    await waitFor(() => expect(callsOf(LIST_FN)).toHaveLength(1));
    expect(screen.queryByText(S.noTrustedDomains)).not.toBeInTheDocument();
  });

  it.fails("BŁĄD ODCZYTU KATALOGU UDAJE PUSTY KATALOG", async () => {
    // ZNALEZISKO (ten sam mechanizm, cięższy skutek). Odmowa RLS, wygasła sesja
    // i literówka w nazwie RPC też schodzą do `q.data ?? []`, więc katalog reguł
    // wstępu wygląda na pusty i NIE MA ani alertu, ani toastu. Administrator nie
    // dowiaduje się, że nie widzi listy - dowiaduje się, że lista jest pusta.
    // Przy panelu, którego jedyną treścią są uprawnienia, to najgorszy możliwy
    // wariant cichej awarii.
    setRpc(LIST_FN, fail("permission denied for function", "42501"));
    renderCard();

    await waitFor(() => expect(callsOf(LIST_FN)).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("KONTROLA DODATNIA obu znalezisk: rozwiązany odczyt renderuje wiersze", async () => {
    let release: (result: SupabaseResult) => void = () => undefined;
    setRpc(LIST_FN, () => new Promise<SupabaseResult>((resolve) => (release = resolve)));
    renderCard();

    await waitFor(() => expect(callsOf(LIST_FN)).toHaveLength(1));
    expect(screen.getByText(S.noTrustedDomains)).toBeInTheDocument();

    release(ok([domainRow()]));

    // Ta sama ścieżka renderu POKAZUJE dane, gdy je ma - czyli oba `it.fails`
    // wyżej mierzą brak ROZRÓŻNIENIA stanów, a nie zepsuty odczyt.
    expect(await screen.findByText("example.com")).toBeInTheDocument();
    expect(screen.queryByText(S.noTrustedDomains)).not.toBeInTheDocument();
  });
});

describe("VerificationDomainsCard - dostępność i dwujęzyczność", () => {
  it("formularz dodawania nie ma naruszeń axe", async () => {
    setRpc(LIST_FN, ok([]));
    const { container } = await renderReady();
    await screen.findByText(S.noTrustedDomains);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("lista domen z plakietkami nie ma naruszeń axe", async () => {
    setRpc(
      LIST_FN,
      ok([
        domainRow({ grants_tier_key: "pro", academic: true, require_email_confirmed: false }),
        domainRow({ id: OTHER_ROW_ID, domain: "partner.example.org", note: "Umowa 2026" }),
      ]),
    );
    const { container } = await renderReady();
    await waitFor(() => expect(rowCount()).toBe(2));

    // TEN test był CZERWONY przed naprawą w komponencie: `ProfileBadge` niesie
    // `role="listitem"`, a stał samotnie w `<div>`, więc axe zgłaszał
    // `aria-required-parent` (waga „serious", WCAG 1.3.1) po jednym naruszeniu
    // na wiersz. Sierota-listitem to dla czytnika ekranu element bez kontekstu:
    // ogłasza się jako pozycja listy, której nie ma. Naprawa (jednoelementowy
    // pojemnik `role="list"` wokół odznaki) jest w komponencie; zdjęcie jej
    // gasi tę asercję natychmiast.
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("każda kontrolka formularza ma etykietę, a usuwanie ma dostępną nazwę", async () => {
    await renderReady();

    // Etykiety NIE są ozdobą: pole domeny i suwak „bez potwierdzenia adresu”
    // decydują o regule wstępu, a bez nazwy czytnik ekranu ogłasza je jako
    // „pole edycji” i „przełącznik”.
    expect(screen.getByLabelText(S.emailDomain)).toBeInTheDocument();
    expect(screen.getByLabelText(S.domainNote)).toBeInTheDocument();
    expect(screen.getByLabelText(S.grantedMembershipPlan)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: S.requireEmailConfirmation })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: S.academicDomain })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: S.removeDomain })).toBeInTheDocument(),
    );
  });

  it("żaden surowy klucz i18n nie trafia na ekran", async () => {
    setRpc(LIST_FN, ok([domainRow({ grants_tier_key: "pro", academic: true, note: "Nota" })]));
    await renderReady();
    await waitFor(() => expect(rowCount()).toBe(1));

    expect(document.body.textContent ?? "").not.toContain("adminCommunity.");
  });

  it("każdy napis panelu ma wpis w słowniku PL I EN", () => {
    const keys = [
      "domainVerification",
      "accountWithConfirmedAddress",
      "runReview",
      "emailDomain",
      "domainNote",
      "noteOptional",
      "domainCom",
      "grantedMembershipPlan",
      "noMembershipGrant",
      "requireEmailConfirmation",
      "academicDomain",
      "academicBadge",
      "addDomain",
      "noTrustedDomains",
      "plan",
      "noEmailConfirmation",
      "removeDomain",
      "removeConfirmTitle",
      "removeConfirmBody",
      "remove",
      "domainActive",
      "domainSaved",
      "domainRemoved",
      "couldNotSaveDomain",
      "couldNotUpdateDomain",
      "couldNotRemoveDomain",
      "sweepDone",
      "reviewFailed",
    ];

    for (const suffix of keys) {
      // `getResource` czyta BEZ fallbacku, więc brak klucza w EN nie schowa się
      // za polskim zdaniem - inaczej test dwujęzyczności byłby ozdobą.
      const pl: unknown = i18n.getResource("pl", "translation", KEY(suffix));
      const en: unknown = i18n.getResource("en", "translation", KEY(suffix));
      expect(typeof pl, `PL brak: ${suffix}`).toBe("string");
      expect(typeof en, `EN brak: ${suffix}`).toBe("string");
    }
  });

  it("angielski render pokazuje angielskie nazwy warstw", async () => {
    setRpc(LIST_FN, ok([domainRow({ grants_tier_key: "vip" })]));
    const { container } = await renderReady({ language: "en" });

    // `language` steruje nie tylko odznaką, ale i nazwą planu z bliźniaczych
    // kolumn `name_pl`/`name_en`.
    expect(await within(container).findByText(`${t(KEY("plan"))}NES VIP`)).toBeInTheDocument();
    expect(within(container).getByText("Verified")).toBeInTheDocument();
  });
});
