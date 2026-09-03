/**
 * Trasa `/admin/hiring` („Oferty pracy") ZAMONTOWANA - redakcja całej treści
 * strony /zatrudniamy: CRUD ofert (`career_roles`), widoczność i nagłówki
 * sekcji (`career_page_sections`) oraz okresy retencji plików CV
 * (`career_settings`). Przed tym plikiem 0/148 linii, 0/81 funkcji,
 * 0/90 gałęzi - największa czarna dziura modułu 21.
 *
 * PO CO TEN PLIK. Ta jedna trasa niesie 901 linii i cztery różne ciężary:
 *   1. TREŚĆ PUBLICZNĄ. `is_published` na ofercie to jedyny przełącznik między
 *      szkicem a ogłoszeniem widocznym w internecie; `slug` to jego adres.
 *      Zły ładunek zapisu nie „psuje panelu" - wypuszcza albo gasi ogłoszenie.
 *   2. IMPORT WBUDOWANEGO KATALOGU. Jeden przycisk bez potwierdzenia robi
 *      UPSERT dziesięciu wierszy po parze `(tenant_id, slug)`. Komentarz
 *      w kodzie produkcyjnym (`admin.hiring.tsx:281-284`) opisuje defekt,
 *      który to kiedyś dało: słownik `careers.*` nie był zarejestrowany
 *      w chunku admina, więc `getFixedT` zwracał SUROWE KLUCZE i import
 *      zapisywał do bazy tytuły „careers.roles.<id>.title", które trafiały na
 *      stronę /zatrudniamy. Ten plik pilnuje tego wprost - i to jest jedyny
 *      test w repo, który to mierzy.
 *   3. USUNIĘCIE OFERTY. Jedyna operacja nieodwracalna na tym ekranie -
 *      stoi za `window.confirm`, i to jest tu przedmiotem dowodu.
 *   4. RETENCJĘ CV, czyli decyzję RODO. Okno retencji i okno łaski wprost
 *      steruje jobem `career-cv-retention`, który USUWA dane osobowe
 *      kandydatów z prywatnego bucketu. Zapis liczby w tym formularzu jest
 *      zapisem polityki przetwarzania danych, nie ustawieniem kosmetycznym.
 *
 * ---------------------------------------------------------------------------
 * PYTANIE 1: GDZIE STOI BRAMKA UPRAWNIEŃ - USTALENIE, NIE ZAŁOŻENIE
 * ---------------------------------------------------------------------------
 * Sprawdzone przed napisaniem asercji:
 *   1. `src/routes/admin.tsx` (layout `/admin`) - JEDYNA bramka renderu:
 *      `useAuth()` daje `isStaff`, efekt robi `navigate({ to: "/login" })`,
 *      komponent zwraca `null` przy `!session || !isStaff`.
 *   2. TA trasa - zero warunku roli: bez `useAuth`, bez `beforeLoad`, bez
 *      `redirect`, bez `<Navigate/>`.
 *   3. Warstwa danych siedzi WPROST w trasie (`supabase.from(...)` w czterech
 *      `mutationFn`) plus `@/lib/careers/catalog(Admin)` na odczytach. Żadna
 *      z tych ścieżek nie jest funkcją serwerową z middleware, więc
 *      autorytetem ostatecznym jest RLS.
 * Dlatego NIE MA tu testu „bez roli nie widzi panelu" udającego dowód na
 * poziomie tej trasy - taki test mierzyłby atrapę `useAuth`, której ta trasa
 * nie woła. Są zamiast tego asercje mierzące TO, CO JEST: render nie zależy od
 * roli, warunek roli stoi w layoucie, a polityki bazy wymienione są w SQL.
 *
 * ZNALEZISKO A (KŁAMSTWO INTERFEJSU, defekt produkcyjny).
 * `/admin` wpuszcza `isStaff`, czyli TAKŻE `editor` i `author`
 * (`useAuth.tsx:174`). Polityki obu tabel treściowych są z tym zgodne
 * (`career_roles_staff_*`, `career_sections_staff_*` = `public.is_staff()`).
 * Ale `career_settings` - tabela retencji CV - ma
 * `career_settings_admin_write` / `career_settings_admin_update` wymagające
 * `has_role(..., 'admin') OR has_role(..., 'super_admin')`
 * (`20260814110000_careers_pipeline_and_cv_retention.sql`), a zakładka
 * „Retencja CV" i jej „Zapisz" renderują się KAŻDEMU, kogo wpuszcza layout.
 * Redaktor widzi więc formularz, który wygląda, jakby ustawiał politykę
 * przetwarzania danych osobowych, i przy każdej próbie dostaje surowy błąd
 * RLS. To dokładnie ta klasa defektu, którą `adminRouteAuthority.gate.test.ts`
 * znalazła w `admin.users.$id` („panel oferuje akcję, którą baza odrzuci").
 * Zachowanie ISTNIEJĄCE jest tu zaasertowane; kontrakt oczekiwany stoi
 * w `it.fails` „zakładka retencji nie oferuje zapisu komu baza go odmówi",
 * z kontrolą dodatnią na `admin.names.tsx` (ta trasa DOKŁADA `isSuperAdmin`).
 *
 * ZNALEZISKO B (DZIURA W DOWODZIE, NIE W KODZIE).
 * Bramka `src/routes/__tests__/adminRouteAuthority.gate.test.ts` ma jawne
 * listy rodzin (`CLUB_ROUTES`, `NEWSLETTER_ROUTES`, `MODULE19_ROUTES`,
 * `SEO_ROUTES`, `COMMUNITY_ROUTES`) i ŻADNA nie obejmuje `admin.hiring.tsx`.
 * Nie dopisuję jej tam (to plik innej paczki roboczej) - zapisuję dziurę
 * jako `it.fails` z kontrolą dodatnią.
 *
 * ZNALEZISKO C (DEFEKT PRODUKCYJNY, EDYCJA LISTY PUNKTÓW).
 * Pola „Zakres obowiązków" / „Wymagania" są kontrolkami sterowanymi przez
 * parę `toText(list)` / `toList(text)`, a `toList` USUWA puste linie
 * (`.filter(Boolean)`). Skutek: pojedynczy `Enter` na końcu pola nie ma jak
 * przeżyć round-tripu - stan wraca bez końcowego „\n", więc kontrolka
 * natychmiast go zjada. Operator pisząc znak po znaku NIE ZAŁOŻY drugiego
 * punktu: po `Enter` kursor zostaje w tej samej linii, a kolejna litera
 * dokleja się do punktu poprzedniego. Wklejenie dwóch linii naraz działa.
 * Zachowanie istniejące jest zaasertowane, kontrakt oczekiwany - w `it.fails`.
 *
 * ZNALEZISKO D (DEFEKT PRODUKCYJNY, TRZY STANY ODCZYTU ZLANE W JEDEN).
 * Panel nie ma stanu ładowania ani stanu odmowy: `rolesQuery.data ?? []`
 * sprowadza „jeszcze nie wiem", „baza pusta" i „RLS odmówił" do tej samej
 * gałęzi, a komunikat brzmi „Brak ofert w bazie - strona pokazuje katalog
 * wbudowany." Operator czyta więc TWIERDZENIE O STANIE BAZY i o treści
 * strony publicznej w sytuacji, w której odczyt w ogóle nie doszedł.
 * Ta sama klasa wraca na wszystkich czterech odczytach tego ekranu:
 *   * sekcje strony - odmowa daje zakładkę bez ŻADNEGO komunikatu,
 *   * kolejka usunięć CV - `queue.data ? ... : L.queueEmpty` czyta awarię jako
 *     „Kolejka pusta.", czyli najbardziej uspokajająco z możliwych,
 *   * ustawienia retencji - `settings.data?.cv_retention_days ?? 365` pokazuje
 *     po nieudanym odczycie DOMYŚLNE 365/24 jako obowiązującą politykę, a te
 *     liczby da się jednym kliknięciem „Zapisz" nadpisać na realne, krótsze
 *     okno retencji danych osobowych. To najcięższy wariant tego defektu.
 *
 * ZNALEZISKO E (DEFEKT PRODUKCYJNY, RETENCJA BEZ WALIDACJI).
 * `min={1} max={3650}` na polu dni jest dekoracją: przycisk „Zapisz" nie jest
 * `type="submit"` i nie stoi w `<form>`, więc walidacja HTML nigdy nie
 * uruchamia się. Wyczyszczone pole jedzie do bazy jako `Number("") === 0`,
 * czyli wartość świadomie zakazana CHECK-iem `BETWEEN 1 AND 3650`. Panel
 * oddaje decyzję RODO bazie i pokazuje operatorowi surowy błąd PostgREST.
 *
 * ZNALEZISKO F (DEFEKT PRODUKCYJNY, KOMUNIKAT = ETYKIETA POLA).
 * Zapis oferty bez slugu i bez tytułów rzuca `new Error(L.slug)`, więc
 * operator dostaje toast o treści „Identyfikator (slug)" - nazwę pola zamiast
 * zdania mówiącego, co zrobić.
 *
 * ZNALEZISKO H (BRAK DWUJĘZYCZNOŚCI W TOŻSAMOŚCI REKORDU).
 * Panel przełącza się na angielski w całości OPRÓCZ nazwy edytowanego
 * rekordu: lista używa `row.title_pl || row.slug`, a nagłówek formularza
 * `draft.title_pl || draft.slug`. Operator anglojęzyczny wybiera więc ofertę
 * po polskim tytule, choć oferta ma tytuł EN w bazie. Podpowiedź slugu ma tę
 * samą asymetrię: liczy się WYŁĄCZNIE z `title_pl`, podczas gdy zapis
 * fallbackuje na `title_en` - przy ofercie tylko angielskiej operator nie
 * widzi adresu, który zostanie zapisany.
 *
 * ZNALEZISKO G (DEFEKT PRODUKCYJNY, UTRATA NIEZAPISANYCH ZMIAN W SEKCJACH).
 * `SectionsTab` kopiuje `rows` do stanu lokalnego efektem na `[rows]`, a każdy
 * zapis dowolnej sekcji unieważnia klucz `career-page-sections`. Refetch
 * oddaje NOWĄ tablicę, efekt biegnie ponownie i nadpisuje stan lokalny -
 * więc zapis sekcji A cicho kasuje niezapisane zmiany w sekcji B.
 *
 * ---------------------------------------------------------------------------
 * CO JEST PRZEDMIOTEM DOWODU
 * ---------------------------------------------------------------------------
 * `head()` (tytuł karty + `noindex`); dwujęzyczność panelu PL/EN wraz
 * z tym, skąd bierze się język; kształt ŁADUNKU każdego z pięciu zapisów
 * (update oferty, insert oferty, delete oferty, upsert importu, upsert sekcji,
 * upsert retencji) - pole po polu, z `onConflict` włącznie; brak filtra
 * najemcy na odczytach (autorytet = RLS) przy JAWNYM najemcy na zapisach
 * (defense in depth); slugify i domyślny slug z tytułu PL albo EN;
 * `emptyDraft` i kolejność nowej oferty; potwierdzenie usunięcia (obie
 * odpowiedzi); trzy stany listy; kanoniczna kolejność sekcji (a nie
 * `sort_order` z bazy); odczyt sekcji z TABELI, nie z widoku publicznego;
 * domyślne 365/24 retencji; kolejka usunięć; toasty sukcesu i błędu każdej
 * mutacji; brak naruszeń axe na wszystkich trzech zakładkach.
 *
 * CO JEST ATRAPOWANE I DLACZEGO. Trzy granice, każda z własnym dowodem:
 *   * `@/integrations/supabase/client` - atrapa łańcucha PostgREST
 *     (`@/test/supabaseChain`, jej własny przedmiot dowodu to wierność
 *     kształtu). Dzięki temu WIDZIMY ładunek i ogniwa, a nie tylko efekt.
 *   * `sonner` - toasty; ich renderowanie ma dowód w `@/components/ui`.
 *   * `@/hooks/useAuth` - tożsamość sesji. To jedyne wejście, którym da się
 *     ustawić „sesja bez profilu najemcy"; sam `useCurrentTenantId`
 *     ZOSTAJE PRAWDZIWY, więc dowód „najemca bierze się z profilu w bazie"
 *     jest tu mierzony, a nie założony.
 *
 * CO ZOSTAJE PRAWDZIWE: i18n (`@/lib/i18n-careers` rejestruje `careers.*`
 * przy imporcie modułu trasy - jego atrapowanie zabiłoby dowód nr 2 wyżej),
 * react-query (inwalidacje i refetch to część kontraktu), router (`head()`),
 * Radix (`Switch`), `@/lib/careers/catalog(Admin)` (to ich zapytania
 * asertujemy) oraz `@/lib/tenant`.
 *
 * ŚWIADOMIE POZA ZAKRESEM (i gdzie mieszka tamten dowód):
 *   * czy RLS faktycznie odcina wiersze obcego najemcy - to twierdzenie
 *     O BAZIE; pgTAP `career_sections_visibility_public_read_test.sql`
 *     (dwóch najemców, sekcje) - i tam jest DZIURA dla `career_settings`
 *     (patrz `it.fails` o autorytecie zapisu retencji);
 *   * sam job `career-cv-retention` - `src/lib/careers/__tests__/cvRetention.test.ts`;
 *   * kształt katalogu wbudowanego - `src/lib/careers/__tests__/roles.test.ts`;
 *   * zapytania warstwy katalogu - `src/lib/careers/__tests__/catalog.test.ts`;
 *   * zgłoszenia kandydatów (`/admin/careers`) - osobna trasa, osobny plik.
 *
 * RODO: żadnych prawdziwych osób ani treści. Nazwy ofert, tytuły i teksty są
 * zmyślone, identyfikatory najemcy i użytkownika sztuczne, adresy wyłącznie
 * `@example.com`.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { CareerRoleRow, CareerSectionRow } from "@/lib/careers/catalog";
import type { SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";

/** Zmyślony najemca (profil operatora) - nigdy z produkcji. */
const TENANT = "11111111-1111-4111-8111-111111111111";
/** Zmyślony operator panelu. */
const OPERATOR = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** `null` = sesja bez użytkownika, czyli najemca nierozstrzygnięty. */
  user: null as { id: string } | null,
  /** Tabele, których zapytanie NIGDY nie odpowiada (stan „w locie"). */
  hang: new Set<string>(),
  confirmAnswer: true,
  confirmMessages: [] as string[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

// GRANICA TOŻSAMOŚCI. `useCurrentTenantId` (PRAWDZIWY) czyta `profiles` po
// `user.id`, więc to jedyne wejście, którym test ustawia „sesja bez profilu".
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));

// GRANICA DANYCH. Atrapa oddaje pełny łańcuch PostgREST, więc test czyta
// OGNIWA I ŁADUNEK, a nie tylko skutek. `h.hang` dokłada jedną rzecz, której
// atrapa nie ma: zapytanie, które nie odpowiada nigdy - bez tego stanu
// „ładowanie" nie da się odróżnić od „pustki", a to jest tu przedmiotem
// dowodu (ZNALEZISKO D). Lista ogniw jest JAWNA, bo literówka w nazwie ogniwa
// w kodzie produkcyjnym MA oblać test, a nie zniknąć w Proxy.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const db = supabaseFromStub();
  h.db = db;
  const LINKS = ["select", "insert", "update", "upsert", "delete", "eq", "limit", "order"];
  const TERMINALS = ["single", "maybeSingle"];
  const pending = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    for (const link of LINKS) builder[link] = () => builder;
    for (const terminal of TERMINALS) builder[terminal] = () => new Promise(() => {});
    builder.then = () => new Promise(() => {});
    return builder;
  };
  return {
    supabase: { from: (table: string) => (h.hang.has(table) ? pending() : db.from(table)) },
  };
});

// `react-i18next` NIE JEST atrapowany: skrót `reactI18nextMock()` sięga po
// `@/lib/i18n`, czyli moduł importujący właśnie atrapowany pakiet
// (zakleszczenie - ostrzeżenie z nagłówka `@/test/i18nReal`). Napisy taksonomii
// mają pochodzić ze słownika `careers.*`, więc `t` musi być prawdziwe.

import i18n from "@/lib/i18n";
import { fail, ok, okCount } from "@/test/supabaseChain";
import { renderRoute, routeHead, type RenderedRoute } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { CAREER_DEPARTMENTS, CAREER_SENIORITIES } from "@/lib/careers/roles";
import { CAREER_SECTION_KEYS } from "@/lib/careers/catalog";
import { fallbackRoleRows } from "@/lib/careers/catalogAdmin";
import { Route as HiringRoute } from "@/routes/admin.hiring";

const PATH = "/admin/hiring";
const ROUTE_FILE = "src/routes/admin.hiring.tsx";
const ADMIN_LAYOUT = "src/routes/admin.tsx";
const SUPER_ADMIN_ROUTE = "src/routes/admin.names.tsx";
const AUTHORITY_GATE = "src/routes/__tests__/adminRouteAuthority.gate.test.ts";
/** Migracja nadająca tabelom karier najemcę, indeks (tenant_id, slug) i RLS. */
const TENANT_MIGRATION = "supabase/migrations/20260814100000_careers_tenant_scope.sql";
/** Migracja z `career_settings` (retencja CV) i kolejką usunięć plików. */
const RETENTION_MIGRATION =
  "supabase/migrations/20260814110000_careers_pipeline_and_cv_retention.sql";
/** Jedyny pgTAP modułu karier - widoczność sekcji na powierzchni publicznej. */
const CAREERS_PGTAP = "supabase/tests/career_sections_visibility_public_read_test.sql";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Słownik TEJ trasy - świadomie literały.
 *
 * Napisy panelu „Oferty pracy" NIE mieszkają w i18n: trasa trzyma własne
 * stałe `PL`/`EN` (`admin.hiring.tsx:104-200`) i nie eksportuje ich. Asercja
 * na nich jest więc asercją na literale i tak musi być - to jedyne miejsce
 * w tym pliku, w którym napis nie pochodzi ze słownika. Napisy TAKSONOMII
 * (dział, wymiar, poziom, lokalizacja) idą przez `t("careers.*")` i są
 * asertowane przez `realT`, czyli mierzą słownik.
 */
const PANEL = {
  title: "Oferty pracy",
  titleEn: "Job offers",
  subtitle: "Treść strony „Dołącz do zespołu” (/zatrudniamy): oferty i sekcje.",
  inbox: "Zgłoszenia kandydatów",
  tabRoles: "Oferty",
  tabSections: "Sekcje strony",
  tabRetention: "Retencja CV",
  tabRolesEn: "Offers",
  tabSectionsEn: "Page sections",
  tabRetentionEn: "CV retention",
  add: "Nowa oferta",
  importI18n: "Importuj wbudowane oferty",
  imported: "Zaimportowano wbudowane oferty.",
  save: "Zapisz",
  saved: "Zapisano.",
  remove: "Usuń",
  removed: "Usunięto ofertę.",
  confirmRemove: "Usunąć tę ofertę na stałe?",
  empty: "Brak ofert w bazie - strona pokazuje katalog wbudowany.",
  pickOne: "Wybierz ofertę z listy albo dodaj nową.",
  published: "Opublikowana",
  draft: "Szkic",
  slug: "Identyfikator (slug)",
  order: "Kolejność",
  department: "Dział",
  engagement: "Wymiar",
  seniority: "Poziom",
  location: "Lokalizacja",
  titlePl: "Tytuł (PL)",
  titleEn2: "Tytuł (EN)",
  summaryPl: "Opis (PL)",
  summaryEn: "Opis (EN)",
  respPl: "Zakres obowiązków (PL)",
  respEn: "Zakres obowiązków (EN)",
  reqPl: "Wymagania (PL)",
  reqEn: "Wymagania (EN)",
  listHint: "Jeden punkt w każdej linii.",
  sectionVisible: "Widoczna",
  sectionHint: "Puste pole = tekst domyślny ze słownika.",
  sectionTitlePl: "Nagłówek (PL / EN) · PL",
  sectionTitleEn: "Nagłówek (PL / EN) · EN",
  sectionSubtitlePl: "Podtytuł (PL / EN) · PL",
  sectionSubtitleEn: "Podtytuł (PL / EN) · EN",
  retentionDays: "Retencja CV po domknięciu procesu (dni)",
  graceHours: "Okno łaski dla pliku bez zgłoszenia (godziny)",
  queueTitle: "Kolejka usunięć",
  queueEmpty: "Kolejka pusta.",
  queuePending: "Pozycje czekające na usunięcie z magazynu:",
} as const;

/** Zaplanowane odpowiedzi bazy - jedno miejsce, które testy nadpisują. */
interface Plan {
  profile: SupabaseResult;
  rolesRead: SupabaseResult;
  rolesWrite: SupabaseResult;
  rolesInsert: SupabaseResult;
  sectionsRead: SupabaseResult;
  sectionsWrite: SupabaseResult;
  settingsRead: SupabaseResult;
  settingsWrite: SupabaseResult;
  queue: SupabaseResult;
}
let plan: Plan;

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa klienta bazy nie została ustawiona");
  return h.db;
}

/** Oferta w kształcie wiersza `career_roles`. Treść ZMYŚLONA (RODO). */
function offer(over: Partial<CareerRoleRow> = {}): CareerRoleRow {
  return {
    id: "oferta-1",
    slug: "analityk-zmyslony",
    department: "analysis",
    engagement: "contract",
    seniority: "senior",
    location: "remote",
    sort_order: 10,
    is_published: true,
    title_pl: "Analityk zmyślonego rejestru",
    title_en: "Analyst of a made-up register",
    summary_pl: "Zmyślony opis roli w zmyślonym zespole.",
    summary_en: "Made-up summary of a made-up role.",
    responsibilities_pl: ["Obowiązek pierwszy", "Obowiązek drugi"],
    responsibilities_en: ["First duty"],
    requirements_pl: ["Wymaganie pierwsze"],
    requirements_en: ["First requirement"],
    ...over,
  };
}

/** Wiersz `career_page_sections` w wersji redakcyjnej (z nagłówkami). */
function section(over: Partial<CareerSectionRow> = {}): CareerSectionRow {
  return {
    key: "hero",
    is_visible: true,
    sort_order: 0,
    title_pl: "Nagłówek zmyślony",
    title_en: "Made-up heading",
    subtitle_pl: "Podtytuł zmyślony",
    subtitle_en: "Made-up subtitle",
    ...over,
  };
}

/** Klient bez ponowień - test odmowy odczytu nie ma na co czekać. */
function testClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function mount(): Promise<RenderedRoute> {
  const rendered = await renderRoute({
    route: HiringRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: testClient(),
  });
  // Domknięcie asynchronicznych efektów montowania w akcie - bez tego React
  // zgłasza aktualizację poza `act(...)`. Czekamy TAKŻE na rozstrzygnięcie
  // najemcy: `useCurrentTenantId` jest prawdziwy, więc dopóki odczyt `profiles`
  // nie dojedzie, KAŻDY zapis leciałby na gałąź „tenant_unresolved" - i test
  // mierzyłby wyścig, nie zachowanie.
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  const user = h.user;
  if (user) {
    await waitFor(() =>
      expect(rendered.queryClient.getQueryState(["current_tenant_id", user.id])?.status).toBe(
        "success",
      ),
    );
  }
  return rendered;
}

/** Kontrolka formularza po etykiecie `Field` (label owija kontrolkę). */
function field(
  label: string,
  scope?: HTMLElement,
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  // `exact: false` NIE jest wygodą: `Field` owija także podpowiedź pod polem
  // (zakładka retencji), więc tekst etykiety liczony przez Testing Library to
  // etykieta PLUS hint. Dopasowanie po fragmencie mierzy więc ten sam napis,
  // który widzi operator, i nie zmusza testu do przepisywania hintów.
  const node = (scope ? within(scope) : screen).getByLabelText(label, { exact: false });
  // STRAŻNIK, nie rzutowanie: `getByLabelText` oddaje `HTMLElement`, a test
  // czyta `.value` - warunek sprawdza w RUNTIME, że to kontrolka.
  if (
    !(node instanceof HTMLInputElement) &&
    !(node instanceof HTMLTextAreaElement) &&
    !(node instanceof HTMLSelectElement)
  ) {
    throw new Error(`test: „${label}" nie jest kontrolką formularza`);
  }
  return node;
}

/**
 * Kontrolka zawężona do `<input>` - potrzebna tam, gdzie test czyta
 * `placeholder` (podpowiedź slugu). STRAŻNIK, nie rzutowanie: `field` oddaje
 * unię trzech typów kontrolek, a `placeholder` ma tylko `<input>`.
 */
function inputField(label: string): HTMLInputElement {
  const node = field(label);
  if (!(node instanceof HTMLInputElement)) {
    throw new Error(`test: „${label}" nie jest polem <input>`);
  }
  return node;
}

/** Kontrolka, na którą trzeba poczekać (przełączenie zakładki, dojazd danych). */
async function awaitField(label: string): Promise<HTMLElement> {
  return screen.findByLabelText(label, { exact: false });
}

function type(label: string, value: string, scope?: HTMLElement): void {
  fireEvent.change(field(label, scope), { target: { value } });
}

/** Wybiera ofertę na liście i czeka na formularz edycji. */
async function pickOffer(title: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(title) }));
  await awaitField(PANEL.slug);
}

/** Otwiera formularz nowej oferty. */
async function newOffer(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: PANEL.add }));
  await awaitField(PANEL.slug);
}

function switchTo(tab: string): void {
  fireEvent.click(screen.getByRole("button", { name: tab }));
}

/**
 * Otwiera zakładkę retencji i czeka, aż OBA jej odczyty przestaną wisieć.
 *
 * PO CO OSOBNY HELPER. `RetentionTab` synchronizuje pola z odpowiedzią efektem
 * na `[settings.data]`, więc wpisanie liczby PRZED dojazdem odczytu zostałoby
 * po chwili nadpisane wartością z bazy (albo domyślną). Test, który tego nie
 * dopilnuje, mierzy wyścig, a nie ładunek zapisu.
 */
async function openRetention(view: RenderedRoute): Promise<void> {
  switchTo(PANEL.tabRetention);
  await awaitField(PANEL.retentionDays);
  for (const key of [["admin-career-settings"], ["admin-career-cv-queue"]]) {
    await waitFor(() => expect(view.queryClient.getQueryState(key)?.status).not.toBe("pending"));
  }
}

/** Karta jednej sekcji strony - namierzana po kluczu w nagłówku. */
function sectionCard(key: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: key });
  const card = heading.closest("section");
  // STRAŻNIK, nie rzutowanie: `closest` oddaje `Element | null`.
  if (!(card instanceof HTMLElement)) {
    throw new Error(`test: sekcja „${key}" nie ma kontenera <section>`);
  }
  return card;
}

/** Ostatni ładunek wysłany danym ogniwem do danej tabeli. */
function payload(table: string, link: string): Record<string, unknown> {
  const chain = db()
    .chainsFor(table)
    .filter((item) => item.has(link))
    .at(-1);
  const args = chain?.argsOf(link);
  const first = args?.[0];
  // STRAŻNIK, nie rzutowanie: brak ładunku to błąd testu, nie pusty obiekt.
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    throw new Error(`test: brak ładunku „${link}" dla tabeli „${table}"`);
  }
  return first as Record<string, unknown>;
}

/** Opcje `onConflict` przekazane do `upsert`. */
function upsertOptions(table: string): Record<string, unknown> {
  const chain = db()
    .chainsFor(table)
    .filter((item) => item.has("upsert"))
    .at(-1);
  const options = chain?.argsOf("upsert")?.[1];
  if (options === null || typeof options !== "object") {
    throw new Error(`test: brak opcji upsert dla tabeli „${table}"`);
  }
  return options as Record<string, unknown>;
}

beforeEach(() => {
  h.user = { id: OPERATOR };
  h.hang = new Set<string>();
  h.confirmAnswer = true;
  h.confirmMessages = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();

  plan = {
    profile: ok({ tenant_id: TENANT }),
    rolesRead: ok([]),
    rolesWrite: ok(null),
    rolesInsert: ok({ id: "oferta-nowa" }),
    sectionsRead: ok([]),
    sectionsWrite: ok(null),
    settingsRead: ok(null),
    settingsWrite: ok(null),
    queue: okCount(0),
  };

  db().reset();
  db().setResponse("profiles", () => plan.profile);
  db().setResponse("career_roles", (chain) => {
    if (chain.has("insert")) return plan.rolesInsert;
    if (chain.has("update") || chain.has("upsert") || chain.has("delete")) return plan.rolesWrite;
    return plan.rolesRead;
  });
  db().setResponse("career_page_sections", (chain) =>
    chain.has("upsert") ? plan.sectionsWrite : plan.sectionsRead,
  );
  db().setResponse("career_settings", (chain) =>
    chain.has("upsert") ? plan.settingsWrite : plan.settingsRead,
  );
  db().setResponse("career_cv_gc_queue", () => plan.queue);

  // happy-dom nie implementuje `window.confirm`, a panel pyta nim przed
  // usunięciem oferty. Definiujemy WŁASNOŚĆ okna - tak brzmi wywołanie
  // w produkcji, więc `vi.stubGlobal` by w nie nie trafił.
  Object.defineProperty(window, "confirm", {
    configurable: true,
    writable: true,
    value: (message?: string) => {
      h.confirmMessages.push(message ?? "");
      return h.confirmAnswer;
    },
  });
});

afterEach(async () => {
  cleanup();
  // Język jest stanem GLOBALNYM instancji i18n - test dwujęzyczny musi go
  // oddać, inaczej kolejny plik dostaje panel po angielsku.
  if (i18n.language !== "pl") await i18n.changeLanguage("pl");
});

// ---------------------------------------------------------------------------
// SKLEJENIE TRASY I AUTORYTET DOSTĘPU
// ---------------------------------------------------------------------------

describe("/admin/hiring - sklejenie trasy", () => {
  it("head() daje tytuł karty i wypisuje stronę z indeksu wyszukiwarek", async () => {
    // Czytamy `head()` DWIEMA drogami: wprost (kontrakt funkcji) i przez
    // zamontowany router (to, co trafiłoby do `<HeadContent/>`). `noindex` nie
    // jest ozdobą: panel redakcyjny w indeksie Google to wyciek struktury
    // organizacji i zaproszenie do zgadywania adresów.
    expect(routeHead(HiringRoute).meta).toEqual([
      { title: "Oferty pracy | Admin" },
      { name: "robots", content: "noindex" },
    ]);

    const { meta } = await mount();
    expect(meta()).toContainEqual({ title: "Oferty pracy | Admin" });
    expect(meta()).toContainEqual({ name: "robots", content: "noindex" });
  });

  it("trasa wisi pod `/admin`, więc chroni ją bramka `isStaff` z układu nadrzędnego", () => {
    const source = read(ROUTE_FILE);
    expect(source).toMatch(/createFileRoute\("\/admin\/hiring"\)/);
    expect(PATH.startsWith("/admin/")).toBe(true);
  });

  it("ta trasa NIE bramkuje dostępu sama - renderuje się bez pytania o rolę", async () => {
    // Dowód pozytywny: komponent nie woła `useAuth` ani nie przekierowuje, więc
    // renderuje się w harnessie bez żadnej sesji. To nie dziura - to podział
    // pracy: jedna bramka w layoucie zamiast kopii w każdej trasie. Gdyby ktoś
    // dołożył warunek roli TUTAJ, ten test zapali się pierwszy.
    const source = read(ROUTE_FILE);
    expect(source).not.toMatch(/isStaff|isAdmin|isSuperAdmin|useAuth/);
    expect(source).not.toMatch(/beforeLoad|redirect\(|<Navigate/);

    await mount();
    expect(screen.getByRole("heading", { level: 1, name: PANEL.title })).toBeInTheDocument();
  });

  it("bramka renderu żyje w layoucie `/admin` i prowadzi na /login", () => {
    // Odczyt pliku, nie render: layout jest RODZICEM tej trasy, a harness
    // montuje pojedynczą trasę pod zastępczym korzeniem.
    const layout = read(ADMIN_LAYOUT);
    expect(layout).toMatch(/isStaff/);
    expect(layout).toMatch(/navigate\(\{\s*to:\s*"\/login"\s*\}\)/);
    expect(layout).toMatch(/if \(!session \|\| !isStaff\) return null;/);
  });

  it("nagłówek panelu mówi, CZYM steruje ten ekran, i prowadzi do zgłoszeń", async () => {
    // Podtytuł jest instrukcją, nie ozdobą: „Oferty pracy" i „Zgłoszenia
    // kandydatów" to dwa różne ekrany na tej samej domenie problemu, a link
    // jest jedyną afordancją przejścia między nimi.
    await mount();
    expect(screen.getByText(PANEL.subtitle)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: PANEL.inbox })).toHaveAttribute(
      "href",
      "/admin/careers",
    );
  });

  /**
   * ZNALEZISKO B (DZIURA W DOWODZIE): bramka rodzin tras panelu nie widzi
   * `admin.hiring`. `adminRouteAuthority.gate.test.ts` pilnuje autorytetu
   * dostępu przez JAWNE listy rodzin - klubów, newslettera, modułu 19, SEO
   * i społeczności. Trasy karier nie ma na żadnej z nich, więc dołożenie tu
   * własnego (i niezgodnego z bazą) warunku roli przeszłoby po cichu.
   *
   * ZNALEZISKO ZAMKNIĘTE 03.09.2026 (ta sama gałąź, osobny commit): bramka ma
   * teraz sekcję „panel rekrutacji - autorytet dostępu" z rodziną
   * `CAREERS_ROUTES` i sześcioma asercjami - m.in. zakazem klienta z rolą
   * serwisową (oba panele obracają danymi osobowymi kandydatów) i ratchetem
   * zbioru dotykanych tabel. Dlatego to już NIE jest `it.fails`: marker
   * zapalił się jako nieoczekiwanie zielony przy pierwszym przebiegu po
   * dopisaniu sekcji i wymusił tę zamianę - czyli wzorzec `it.fails` zadziałał
   * dokładnie tak, jak ma działać.
   * KONTROLA DODATNIA stoi w teście obok, żeby ten dowód nie przechodził
   * z powodu zepsutego wzorca odczytu.
   */
  it("bramka rodzin tras panelu WIDZI rodzinę `admin.hiring`", () => {
    expect(read(AUTHORITY_GATE)).toContain("admin.hiring.tsx");
  });

  it("kontrola dodatnia: ten sam odczyt ZNAJDUJE w bramce rodzinę newslettera", () => {
    expect(read(AUTHORITY_GATE)).toContain("admin.newsletter.tsx");
  });
});

// ---------------------------------------------------------------------------
// ZNALEZISKO A: PANEL OFERUJE ZAPIS, KTÓRY BAZA ODRZUCI
// ---------------------------------------------------------------------------

describe("/admin/hiring - autorytet zapisu: panel kontra polityki bazy", () => {
  it("treść ofert i sekcji wymaga w bazie DOKŁADNIE tego, co wpuszcza layout", () => {
    // Zgodność, której nie wolno stracić: obie tabele treściowe pytają
    // `public.is_staff()`, czyli o to samo, co bramka `/admin`.
    const sql = read(TENANT_MIGRATION);
    for (const policy of [
      "career_roles_staff_write",
      "career_roles_staff_update",
      "career_roles_staff_delete",
      "career_sections_staff_write",
      "career_sections_staff_update",
    ]) {
      expect(sql, `zniknęła polityka ${policy}`).toContain(policy);
    }
    expect(sql).toMatch(
      /WITH CHECK \(public\.is_staff\(\) AND tenant_id = public\.current_tenant_id\(\)\)/,
    );
    expect(read(ADMIN_LAYOUT)).toMatch(/isStaff/);
  });

  it("retencja CV wymaga w bazie ROLI ADMINA - a zakładka renderuje się każdemu", async () => {
    // ZNALEZISKO A. Zachowanie ISTNIEJĄCE: formularz i „Zapisz" pojawiają się
    // bez żadnego warunku roli, choć `career_settings_admin_write` /
    // `career_settings_admin_update` przepuszczają wyłącznie admina.
    // Redaktor (też `isStaff`) zobaczy więc formularz polityki RODO, który
    // przy każdej próbie zapisu zwróci mu surowy błąd RLS.
    const sql = read(RETENTION_MIGRATION);
    expect(sql).toContain("career_settings_admin_write");
    expect(sql).toContain("career_settings_admin_update");
    expect(sql).toMatch(
      /has_role\(auth\.uid\(\), 'admin'\) OR public\.has_role\(auth\.uid\(\), 'super_admin'\)/,
    );

    await mount();
    switchTo(PANEL.tabRetention);
    expect(await awaitField(PANEL.retentionDays)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PANEL.save })).toBeEnabled();
  });

  /**
   * OCZEKIWANY KONTRAKT dla ZNALEZISKA A: zakładka, której zapis baza
   * przepuszcza tylko adminowi, pyta o `isAdmin` PRZED pokazaniem formularza -
   * dokładnie tak, jak trasy wrażliwsze pytają o `isSuperAdmin`.
   *
   * Zapisane jako `it.fails`, bo naprawa oznacza zmianę kodu produkcyjnego
   * (nowy warunek roli w trasie), a ten plik zachowania nie zmienia.
   * KONTROLA DODATNIA: test obok znajduje ten sam wzorzec w `admin.names`.
   */
  it.fails("zakładka retencji nie oferuje zapisu komu baza go odmówi", () => {
    expect(read(ROUTE_FILE)).toMatch(/isAdmin|isSuperAdmin/);
  });

  it("kontrola dodatnia: trasa dla samego super-admina JAWNIE pyta o rolę", () => {
    expect(read(SUPER_ADMIN_ROUTE)).toMatch(/isSuperAdmin/);
  });

  /**
   * DZIURA W DOWODZIE: autorytet zapisu `career_settings` nie ma pgTAP.
   * Jedyny plik pgTAP modułu karier
   * (`career_sections_visibility_public_read_test.sql`) pracuje na sekcjach
   * i nie dotyka tabeli retencji - a to ona trzyma decyzję RODO i jest
   * jedyną tabelą tego ekranu z INNYM progiem roli niż bramka `/admin`.
   *
   * KONTROLA DODATNIA w teście obok: ten sam odczyt ZNAJDUJE dowód dla sekcji.
   */
  it.fails("autorytet zapisu `career_settings` jest dowiedziony w pgTAP", () => {
    expect(read(CAREERS_PGTAP)).toContain("career_settings");
  });

  it("kontrola dodatnia: pgTAP karier dowodzi widoczności sekcji u dwóch najemców", () => {
    const sql = read(CAREERS_PGTAP);
    expect(sql).toContain("career_page_sections");
    expect(sql).toMatch(/INSERT INTO public\.tenants/);
  });
});

// ---------------------------------------------------------------------------
// NAJEMCA: JAWNY W ZAPISACH, NIEOBECNY W ODCZYTACH
// ---------------------------------------------------------------------------

describe("/admin/hiring - najemca: skąd się bierze i gdzie jedzie", () => {
  it("najemca pochodzi z PROFILU operatora w bazie, nie z niczego, co da się podać", async () => {
    // `useCurrentTenantId` zostaje PRAWDZIWY, więc to jest dowód mierzony:
    // panel pyta `profiles` po id sesji i dopiero ta odpowiedź trafia
    // do ładunku zapisu.
    await mount();
    await waitFor(() => expect(db().chainsFor("profiles").length).toBeGreaterThan(0));
    const chain = db().lastChain("profiles");
    expect(chain?.argsOf("select")).toEqual(["tenant_id"]);
    expect(chain?.argsOf("eq")).toEqual(["id", OPERATOR]);
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  it("odczyt ofert NIE niesie warunku najemcy ani filtra publikacji", async () => {
    // Dwa ustalenia w jednym: (a) zakres najemcy wyznacza WYŁĄCZNIE polityka
    // bazy - panel nie ma filtra, który mógłby skłamać albo zostać podmieniony
    // w DevTools; (b) panel czyta też SZKICE (`includeDrafts`), bo to on nimi
    // zarządza - stąd brak `.eq("is_published", true)` obecnego w odczycie
    // publicznym. Kolejność liczy BAZA, nie klient.
    plan.rolesRead = ok([offer()]);
    await mount();
    await screen.findByText(/Analityk zmyślonego rejestru/);

    const chain = db().lastChain("career_roles");
    expect(chain?.calls.filter((call) => call.method === "eq")).toEqual([]);
    expect(chain?.argsOf("order")).toEqual(["sort_order", { ascending: true }]);
    expect(chain?.calls.filter((call) => call.method === "order")).toHaveLength(2);
    expect(read(TENANT_MIGRATION)).toMatch(
      /USING \(public\.is_staff\(\) AND tenant_id = public\.current_tenant_id\(\)\)/,
    );
  });

  it("sekcje czyta z TABELI, nie z widoku publicznego - inaczej kasowałby brudnopis", async () => {
    // Widok `career_page_sections_public` tnie nagłówki sekcji UKRYTEJ do
    // NULL (migracja 20260817230000). Panel edytuje właśnie te nagłówki, więc
    // czytanie widoku zerowałoby operatorowi tekst przy każdym odświeżeniu.
    plan.sectionsRead = ok([section()]);
    await mount();
    await waitFor(() => expect(db().chainsFor("career_page_sections").length).toBeGreaterThan(0));
    expect(db().chainsFor("career_page_sections_public")).toHaveLength(0);
    expect(db().lastChain("career_page_sections")?.argsOf("select")).toEqual([
      "key,is_visible,sort_order,title_pl,title_en,subtitle_pl,subtitle_en",
    ]);
  });
});

// ---------------------------------------------------------------------------
// DWUJĘZYCZNOŚĆ PANELU
// ---------------------------------------------------------------------------

describe("/admin/hiring - dwujęzyczność panelu", () => {
  it("po polsku pokazuje polskie zakładki, a taksonomię bierze ze słownika", async () => {
    const t = realT("pl");
    plan.rolesRead = ok([offer({ department: "policy" })]);
    await mount();

    expect(screen.getByRole("button", { name: PANEL.tabRoles })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PANEL.tabSections })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PANEL.tabRetention })).toBeInTheDocument();
    // Etykieta działu na liście POCHODZI ZE SŁOWNIKA - zniknięcie klucza
    // `careers.departments.policy` oblewa ten test.
    expect(
      await screen.findByText(new RegExp(t("careers.departments.policy"))),
    ).toBeInTheDocument();
  });

  it("po angielsku przełącza CAŁY panel, bo język czyta z instancji i18n", async () => {
    // `L = i18n.language.startsWith("en") ? EN : PL` - to jedno wyrażenie
    // decyduje o kilkudziesięciu napisach ekranu. Bez tego dowodu gałąź EN
    // (druga połowa słownika trasy) nie jest wykonywana ani razu.
    await i18n.changeLanguage("en");
    plan.rolesRead = ok([offer()]);
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: PANEL.titleEn })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PANEL.tabRolesEn })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PANEL.tabSectionsEn })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PANEL.tabRetentionEn })).toBeInTheDocument();
    // Taksonomia też przechodzi na angielski - i to prawdziwym słownikiem.
    expect(
      await screen.findByText(new RegExp(realT("en")("careers.departments.analysis"))),
    ).toBeInTheDocument();
  });

  it("po angielsku pola formularza i przełącznik publikacji mówią po angielsku", async () => {
    await i18n.changeLanguage("en");
    plan.rolesRead = ok([offer()]);
    await mount();
    // USTALENIE, NIE USTERKA TESTU: tożsamość wiersza jest ZAWSZE polska.
    // Lista używa `row.title_pl || row.slug`, a nagłówek formularza
    // `draft.title_pl || draft.slug` - dwujęzyczność panelu nie obejmuje więc
    // nazwy edytowanego rekordu i operator anglojęzyczny wybiera ofertę po
    // polskim tytule. Klikamy tak, jak faktycznie wygląda ekran.
    fireEvent.click(await screen.findByRole("button", { name: /Analityk zmyślonego rejestru/ }));

    expect(await awaitField("Identifier (slug)")).toBeInTheDocument();
    expect(field("Responsibilities (PL)")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Analityk zmyślonego rejestru",
    );
  });
});

// ---------------------------------------------------------------------------
// LISTA OFERT: TRZY STANY ODCZYTU (ZNALEZISKO D)
// ---------------------------------------------------------------------------

describe("/admin/hiring - lista ofert: trzy stany odczytu zlane w jeden", () => {
  it("pusta baza mówi wprost, że ofert nie ma i że strona pokazuje katalog wbudowany", async () => {
    await mount();
    expect(screen.getByText(PANEL.empty)).toBeInTheDocument();
  });

  it("ZNALEZISKO D: w trakcie pobierania panel pokazuje TEN SAM komunikat co pustka", async () => {
    // Zachowanie ISTNIEJĄCE. Zapytanie wisi (nie odpowiedziało ani błędem, ani
    // danymi), a operator już czyta twierdzenie o stanie bazy.
    h.hang.add("career_roles");
    const { queryClient } = await mount();
    expect(queryClient.getQueryState(["career-roles", "all"])?.status).toBe("pending");
    expect(screen.getByText(PANEL.empty)).toBeInTheDocument();
  });

  it("ZNALEZISKO D: odmowa odczytu też pokazuje pustkę - i zero wierszy widmo", async () => {
    // Połowa kontraktu, która DZIAŁA i której nie wolno stracić przy naprawie:
    // po odmowie lista jest pusta, a nie wypełniona resztkami z cache.
    plan.rolesRead = fail("odmowa RLS: career_roles_staff_read", "42501");
    const { container, queryClient } = await mount();
    await waitFor(() =>
      expect(queryClient.getQueryState(["career-roles", "all"])?.status).toBe("error"),
    );
    // Liczymy PRZYCISKI wierszy, nie `<li>`: komunikat pustki sam jest `<li>`,
    // więc licznik elementów listy nigdy nie spada do zera.
    expect(container.querySelectorAll("li button")).toHaveLength(0);
    expect(screen.getByText(PANEL.empty)).toBeInTheDocument();
  });

  /**
   * OCZEKIWANY KONTRAKT: odmowa odczytu ma własny komunikat, różny od pustki.
   * Dziś `rolesQuery.data ?? []` (linia 302) zlewa trzy stany w jeden, więc
   * operator dostaje zdanie o STANIE BAZY zamiast informacji, że odczyt nie
   * doszedł - i może w dobrej wierze kliknąć „Importuj wbudowane oferty".
   *
   * Zapisane jako `it.fails`, bo naprawa wymaga zmiany trasy i nowego napisu.
   * KONTROLA DODATNIA: test „pusta baza mówi wprost…" wyżej dowodzi, że ta
   * sama technika wykrywa poprawny przypadek pustki.
   */
  it.fails("odmowa odczytu ofert NIE wygląda jak pusta baza", async () => {
    plan.rolesRead = fail("odmowa RLS", "42501");
    const { queryClient } = await mount();
    await waitFor(() =>
      expect(queryClient.getQueryState(["career-roles", "all"])?.status).toBe("error"),
    );
    expect(screen.queryByText(PANEL.empty)).toBeNull();
  });

  it("wiersz oferty pokazuje tytuł, dział i slug - to po nich operator wybiera", async () => {
    plan.rolesRead = ok([offer()]);
    const { container } = await mount();
    const row = (await screen.findByText("Analityk zmyślonego rejestru")).closest("li");
    expect(row?.textContent).toContain("analityk-zmyslony");
    expect(row?.textContent).toContain(realT("pl")("careers.departments.analysis"));
    expect(container.querySelectorAll("li button")).toHaveLength(1);
  });

  it("oferta bez tytułu PL identyfikuje się slugiem, a nie pustym wierszem", async () => {
    // Bez tego wiersz byłby nie do kliknięcia „na oko": pusty pasek na liście.
    plan.rolesRead = ok([offer({ title_pl: "", slug: "bez-tytulu-pl" })]);
    await mount();
    expect(await screen.findByText("bez-tytulu-pl")).toBeInTheDocument();
  });

  it("stan publikacji widać na liście IKONĄ, osobną dla szkicu i dla ogłoszenia", async () => {
    // To jedyny sygnał na liście mówiący, co jest widoczne w internecie.
    plan.rolesRead = ok([
      offer({ id: "opublikowana", slug: "widoczna", title_pl: "Widoczna oferta" }),
      offer({
        id: "szkic",
        slug: "ukryta",
        title_pl: "Ukryta oferta",
        is_published: false,
      }),
    ]);
    const { container } = await mount();
    await screen.findByText("Widoczna oferta");
    expect(container.querySelector(".lucide-eye")).not.toBeNull();
    expect(container.querySelector(".lucide-eye-off")).not.toBeNull();
    expect(container.querySelectorAll("li button")).toHaveLength(2);
  });

  it("panel renderuje DOKŁADNIE te wiersze, które oddała baza - nic nie dokłada", async () => {
    // Druga połowa granicy izolacji: nawet szczelny RLS nie pomoże, jeśli panel
    // sklei odpowiedź z katalogiem wbudowanym. Nie sklei - lista jest
    // odwzorowaniem 1:1, a katalog wbudowany wchodzi wyłącznie importem.
    plan.rolesRead = ok([
      offer({ id: "a", slug: "pierwsza", title_pl: "Pierwsza zmyślona" }),
      offer({ id: "b", slug: "druga", title_pl: "Druga zmyślona" }),
    ]);
    const { container } = await mount();
    await screen.findByText("Pierwsza zmyślona");
    expect(container.querySelectorAll("li button")).toHaveLength(2);
    expect(screen.queryByText(PANEL.empty)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WYBÓR OFERTY, PUSTY FORMULARZ, SLUG
// ---------------------------------------------------------------------------

describe("/admin/hiring - wybór oferty i wypełnienie formularza", () => {
  it("bez wyboru prawa kolumna prosi o wybór, a nie udaje pustego formularza", async () => {
    plan.rolesRead = ok([offer()]);
    await mount();
    await screen.findByText("Analityk zmyślonego rejestru");
    expect(screen.getByText(PANEL.pickOne)).toBeInTheDocument();
    expect(screen.queryByLabelText(PANEL.slug, { exact: false })).toBeNull();
  });

  it("klik w wiersz wypełnia WSZYSTKIE pola z bazy, a listy punktów jako linie", async () => {
    // `toText` jest jedynym mostem między tablicą w bazie a polem tekstowym.
    plan.rolesRead = ok([offer()]);
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");

    expect(field(PANEL.slug).value).toBe("analityk-zmyslony");
    expect(field(PANEL.order).value).toBe("10");
    expect(field(PANEL.department).value).toBe("analysis");
    expect(field(PANEL.engagement).value).toBe("contract");
    expect(field(PANEL.seniority).value).toBe("senior");
    expect(field(PANEL.location).value).toBe("remote");
    expect(field(PANEL.titlePl).value).toBe("Analityk zmyślonego rejestru");
    expect(field(PANEL.titleEn2).value).toBe("Analyst of a made-up register");
    expect(field(PANEL.summaryPl).value).toBe("Zmyślony opis roli w zmyślonym zespole.");
    expect(field(PANEL.summaryEn).value).toBe("Made-up summary of a made-up role.");
    expect(field(PANEL.respPl).value).toBe("Obowiązek pierwszy\nObowiązek drugi");
    expect(field(PANEL.respEn).value).toBe("First duty");
    expect(field(PANEL.reqPl).value).toBe("Wymaganie pierwsze");
    expect(field(PANEL.reqEn).value).toBe("First requirement");
    // Nagłówek formularza to tytuł wybranej oferty, nie „Nowa oferta".
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Analityk zmyślonego rejestru",
    );
    expect(screen.getByText(PANEL.published)).toBeInTheDocument();
  });

  it("wybrana oferta bez tytułu PL nagłówkuje się slugiem", async () => {
    plan.rolesRead = ok([offer({ title_pl: "", slug: "bez-tytulu" })]);
    await mount();
    await pickOffer("bez-tytulu");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("bez-tytulu");
  });

  it("szkic pokazuje etykietę „Szkic” przy przełączniku publikacji", async () => {
    plan.rolesRead = ok([offer({ is_published: false })]);
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");
    expect(screen.getByText(PANEL.draft)).toBeInTheDocument();
    expect(screen.queryByText(PANEL.published)).toBeNull();
  });

  it("„Nowa oferta” daje PUSTY szkic z kolejnością na koniec listy i bez usuwania", async () => {
    // `emptyDraft(rows.length * 10)` - nowa oferta ląduje ZA istniejącymi, bo
    // `sort_order` decyduje o kolejności na stronie publicznej.
    plan.rolesRead = ok([
      offer({ id: "a", slug: "pierwsza", title_pl: "Pierwsza zmyślona" }),
      offer({ id: "b", slug: "druga", title_pl: "Druga zmyślona" }),
    ]);
    await mount();
    await screen.findByText("Druga zmyślona");
    await newOffer();

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(PANEL.add);
    expect(field(PANEL.slug).value).toBe("");
    expect(field(PANEL.order).value).toBe("20");
    expect(field(PANEL.department).value).toBe("analysis");
    expect(field(PANEL.engagement).value).toBe("full_time");
    expect(field(PANEL.seniority).value).toBe("mid");
    expect(field(PANEL.location).value).toBe("hybrid");
    expect(field(PANEL.respPl).value).toBe("");
    // Nowa oferta startuje jako SZKIC - nic nie wychodzi na stronę przez pomyłkę.
    expect(screen.getByText(PANEL.draft)).toBeInTheDocument();
    // Nie ma czego usuwać, więc przycisku usuwania nie ma.
    expect(screen.queryByRole("button", { name: PANEL.remove })).toBeNull();
  });

  it("podpowiedź slugu powstaje z tytułu PL: bez diakrytyków, bez interpunkcji, do 60 znaków", async () => {
    // `slugify` decyduje o ADRESIE ogłoszenia. Polskie znaki i interpunkcja
    // w adresie to link, którego nie da się wkleić w mail bez kaleczenia.
    await mount();
    await newOffer();

    type(PANEL.titlePl, "Łączny Analityk – Bezpieczeństwo!! ");
    expect(inputField(PANEL.slug).placeholder).toBe("laczny-analityk-bezpieczenstwo");

    type(PANEL.titlePl, `${"a".repeat(80)}`);
    expect(inputField(PANEL.slug).placeholder).toHaveLength(60);
  });

  it("droplisty niosą PEŁNE zbiory taksonomii, a etykiety biorą ze słownika", async () => {
    const t = realT("pl");
    await mount();
    await newOffer();

    const department = field(PANEL.department);
    expect(department.querySelectorAll("option")).toHaveLength(CAREER_DEPARTMENTS.length);
    expect(
      within(department).getByRole("option", { name: t("careers.departments.editorial") }),
    ).toBeInTheDocument();
    expect(field(PANEL.seniority).querySelectorAll("option")).toHaveLength(
      CAREER_SENIORITIES.length,
    );
    expect(
      within(field(PANEL.engagement)).getByRole("option", {
        name: t("careers.engagement.internship"),
      }),
    ).toBeInTheDocument();
    expect(
      within(field(PANEL.location)).getByRole("option", { name: t("careers.location.brussels") }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ZAPIS OFERTY: ŁADUNEK
// ---------------------------------------------------------------------------

describe("/admin/hiring - zapis oferty: co dokładnie jedzie do bazy", () => {
  it("edycja istniejącej oferty idzie UPDATE po id, bez najemcy w ładunku i w filtrze", async () => {
    // Zapis aktualizujący celuje w JEDEN wiersz po kluczu głównym. Najemcy nie
    // ma ani w ładunku (nie da się go „przestawić" edycją), ani w filtrze
    // (autorytetem jest polityka `career_roles_staff_update`).
    plan.rolesRead = ok([offer()]);
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");

    type(PANEL.titlePl, "  Nowy tytuł zmyślony  ");
    type(PANEL.summaryEn, "  Trimmed summary  ");
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.saved));
    const sent = payload("career_roles", "update");
    expect(sent).toEqual({
      slug: "analityk-zmyslony",
      department: "analysis",
      engagement: "contract",
      seniority: "senior",
      location: "remote",
      sort_order: 10,
      is_published: true,
      // Białe znaki są OBCINANE - inaczej tytuł ze spacją na końcu psuje
      // złożenie nagłówka na stronie publicznej.
      title_pl: "Nowy tytuł zmyślony",
      title_en: "Analyst of a made-up register",
      summary_pl: "Zmyślony opis roli w zmyślonym zespole.",
      summary_en: "Trimmed summary",
      responsibilities_pl: ["Obowiązek pierwszy", "Obowiązek drugi"],
      responsibilities_en: ["First duty"],
      requirements_pl: ["Wymaganie pierwsze"],
      requirements_en: ["First requirement"],
    });
    expect(Object.keys(sent)).not.toContain("tenant_id");
    const chain = db()
      .chainsFor("career_roles")
      .filter((item) => item.has("update"))
      .at(-1);
    expect(chain?.calls.filter((call) => call.method === "eq")).toEqual([
      { method: "eq", args: ["id", "oferta-1"] },
    ]);
  });

  it("zapis unieważnia OBA klucze treści karier, więc strona publiczna też się odświeża", async () => {
    // `["career-roles"]` i `["career-page-sections"]` to PREFIKSY: pod nimi
    // żyją rodzeństwa `published`/`all` i `public`/`admin`. Jedna inwalidacja
    // musi trafić w oba, inaczej strona /zatrudniamy pokazuje starą treść.
    plan.rolesRead = ok([offer()]);
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");
    const readsBefore = db()
      .chainsFor("career_roles")
      .filter((item) => item.has("select") && !item.has("insert")).length;
    const sectionReadsBefore = db().chainsFor("career_page_sections").length;

    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("career_roles")
          .filter((item) => item.has("select") && !item.has("insert")).length,
      ).toBeGreaterThan(readsBefore),
    );
    await waitFor(() =>
      expect(db().chainsFor("career_page_sections").length).toBeGreaterThan(sectionReadsBefore),
    );
  });

  it("nowa oferta idzie INSERT z JAWNYM najemcą i oddaje id, które panel zapamiętuje", async () => {
    // Kolumna ma w bazie DEFAULT `public_tenant_id()`, ale ON CONFLICT
    // (tenant_id, slug) wymaga wartości JAWNIE w ładunku - a jawny najemca to
    // druga bramka obok RLS. Po zapisie panel przechodzi w tryb edycji nowego
    // wiersza, co widać po pojawieniu się przycisku usuwania.
    await mount();
    await newOffer();
    type(PANEL.slug, "nowa-zmyslona-rola");
    type(PANEL.titlePl, "Nowa zmyślona rola");
    plan.rolesRead = ok([offer({ id: "oferta-nowa", slug: "nowa-zmyslona-rola" })]);
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.saved));
    const sent = payload("career_roles", "insert");
    expect(sent.tenant_id).toBe(TENANT);
    expect(sent.slug).toBe("nowa-zmyslona-rola");
    expect(sent.is_published).toBe(false);
    expect(sent.sort_order).toBe(0);
    const chain = db()
      .chainsFor("career_roles")
      .filter((item) => item.has("insert"))
      .at(-1);
    expect(chain?.argsOf("select")).toEqual(["id"]);
    expect(chain?.has("single")).toBe(true);
    expect(await screen.findByRole("button", { name: PANEL.remove })).toBeInTheDocument();
    expect(read(TENANT_MIGRATION)).toMatch(
      /ALTER COLUMN tenant_id SET DEFAULT public\.public_tenant_id\(\)/,
    );
  });

  it("odmowa INSERTU nie zostawia panelu w trybie edycji nieistniejącego wiersza", async () => {
    // Osobna gałąź od odmowy UPDATE: tam wiersz istnieje i wybór ma sens,
    // tutaj baza NIE nadała id, więc panel nie może udawać, że oferta powstała
    // (inaczej kolejny „Zapisz" poszedłby UPDATE na id, którego nie ma).
    plan.rolesInsert = fail("new row violates row-level security policy", "42501");
    await mount();
    await newOffer();
    type(PANEL.slug, "odrzucona-zmyslona");
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("new row violates row-level security policy"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(PANEL.add);
    expect(screen.queryByRole("button", { name: PANEL.remove })).toBeNull();
  });

  it("slug pusty wylicza się z tytułu PL, a gdy PL nie ma - z tytułu EN", async () => {
    // Fallback na EN jest istotny: ogłoszenie tylko po angielsku też musi mieć
    // adres. UWAGA: podpowiedź w polu liczy się WYŁĄCZNIE z tytułu PL, więc
    // przy pustym PL operator nie widzi slugu, który zostanie zapisany.
    await mount();
    await newOffer();
    type(PANEL.titleEn2, "Made Up English Role");
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.saved));
    expect(payload("career_roles", "insert").slug).toBe("made-up-english-role");
    expect(inputField(PANEL.slug).placeholder).toBe("");
  });

  it("ZNALEZISKO F: zapis bez slugu i bez tytułów NIE dotyka bazy, a błąd to ETYKIETA pola", async () => {
    // Zachowanie ISTNIEJĄCE: `throw new Error(L.slug)` daje toast o treści
    // „Identyfikator (slug)" - nazwę pola, nie zdanie mówiące, co zrobić.
    // Ważne jest to, że mutacja zatrzymuje się PRZED bazą: adres pusty to
    // ogłoszenie bez adresu.
    await mount();
    await newOffer();
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(PANEL.slug));
    expect(
      db()
        .chainsFor("career_roles")
        .some((item) => item.has("insert")),
    ).toBe(false);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("sesja bez profilu najemcy nie zapisuje nowej oferty - zamiast pisać, mówi dlaczego", async () => {
    // Wiersz bez najemcy nie byłby widoczny dla ŻADNEJ strony publicznej.
    h.user = null;
    await mount();
    await newOffer();
    type(PANEL.slug, "bez-najemcy");
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("tenant_unresolved"));
    expect(db().chainsFor("profiles")).toHaveLength(0);
    expect(
      db()
        .chainsFor("career_roles")
        .some((item) => item.has("insert")),
    ).toBe(false);
  });

  it("odmowa zapisu pokazuje komunikat bazy i NIE przełącza panelu w tryb sukcesu", async () => {
    plan.rolesRead = ok([offer()]);
    plan.rolesWrite = fail("new row violates row-level security policy", "42501");
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("new row violates row-level security policy"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("przełącznik publikacji jedzie do ładunku - to on wypuszcza ogłoszenie na stronę", async () => {
    plan.rolesRead = ok([offer({ is_published: false })]);
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");
    fireEvent.click(screen.getByRole("switch"));

    expect(screen.getByText(PANEL.published)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.saved));
    expect(payload("career_roles", "update").is_published).toBe(true);
  });

  it("kolejność przyjmuje liczbę, a wartość niebędącą liczbą sprowadza do zera", async () => {
    // `Number(value) || 0` - pole numeryczne bez tej gałęzi wysyłałoby NaN,
    // czyli `null` w JSON i wiersz wypadający z sortowania strony publicznej.
    plan.rolesRead = ok([offer()]);
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");

    type(PANEL.order, "70");
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(1));
    expect(payload("career_roles", "update").sort_order).toBe(70);

    type(PANEL.order, "");
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(2));
    expect(payload("career_roles", "update").sort_order).toBe(0);
  });

  it("wszystkie cztery droplisty taksonomii przestawiają ładunek", async () => {
    plan.rolesRead = ok([offer()]);
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");

    type(PANEL.department, "editorial");
    type(PANEL.engagement, "internship");
    type(PANEL.seniority, "junior");
    type(PANEL.location, "brussels");
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.saved));
    const sent = payload("career_roles", "update");
    expect(sent.department).toBe("editorial");
    expect(sent.engagement).toBe("internship");
    expect(sent.seniority).toBe("junior");
    expect(sent.location).toBe("brussels");
  });

  it("obie wersje językowe tytułu i opisu jadą OSOBNO - jedna nie nadpisuje drugiej", async () => {
    plan.rolesRead = ok([offer()]);
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");

    type(PANEL.titlePl, "Tytuł polski");
    type(PANEL.titleEn2, "English title");
    type(PANEL.summaryPl, "Opis polski");
    type(PANEL.summaryEn, "English summary");
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.saved));
    const sent = payload("career_roles", "update");
    expect(sent.title_pl).toBe("Tytuł polski");
    expect(sent.title_en).toBe("English title");
    expect(sent.summary_pl).toBe("Opis polski");
    expect(sent.summary_en).toBe("English summary");
  });

  it("wszystkie cztery listy punktów jadą jako tablice, po jednym punkcie na linię", async () => {
    plan.rolesRead = ok([offer()]);
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");

    type(PANEL.respPl, "Punkt PL 1\nPunkt PL 2");
    type(PANEL.respEn, "Duty 1\nDuty 2");
    type(PANEL.reqPl, "Wymóg 1");
    type(PANEL.reqEn, "Requirement 1\nRequirement 2");
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.saved));
    const sent = payload("career_roles", "update");
    expect(sent.responsibilities_pl).toEqual(["Punkt PL 1", "Punkt PL 2"]);
    expect(sent.responsibilities_en).toEqual(["Duty 1", "Duty 2"]);
    expect(sent.requirements_pl).toEqual(["Wymóg 1"]);
    expect(sent.requirements_en).toEqual(["Requirement 1", "Requirement 2"]);
    expect(screen.getByText(PANEL.listHint)).toBeInTheDocument();
  });

  it("puste linie i wcięcia w liście punktów są przycinane, nie zapisywane", async () => {
    // `toList` = split + trim + filter(Boolean). Punkt „ " na stronie
    // publicznej byłby kropką bez treści.
    plan.rolesRead = ok([offer()]);
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");

    type(PANEL.reqPl, "  Pierwszy  \n\n   \nDrugi\n");
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.saved));
    expect(payload("career_roles", "update").requirements_pl).toEqual(["Pierwszy", "Drugi"]);
  });

  it("ZNALEZISKO C: pojedynczy Enter na końcu listy punktów ZNIKA z pola", async () => {
    // Zachowanie ISTNIEJĄCE i defekt edycji: `toList` zjada puste linie, więc
    // round-trip przez stan gubi końcowe „\n" i kontrolka wraca bez niego.
    // Operator piszący znak po znaku nie założy drugiego punktu klawiszem
    // Enter - kolejna litera dokleja się do punktu poprzedniego.
    plan.rolesRead = ok([offer()]);
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");

    type(PANEL.reqPl, "Pierwszy\n");
    expect(field(PANEL.reqPl).value).toBe("Pierwszy");
    // Wklejenie dwóch linii naraz działa - to jedyna droga do drugiego punktu.
    type(PANEL.reqPl, "Pierwszy\nDrugi");
    expect(field(PANEL.reqPl).value).toBe("Pierwszy\nDrugi");
  });

  /**
   * OCZEKIWANY KONTRAKT dla ZNALEZISKA C: świeżo wstawiona pusta linia
   * przeżywa w polu, bo dopiero ona pozwala zacząć następny punkt. Naprawa to
   * zmiana kodu produkcyjnego (stan tekstowy pola albo `toList` bez
   * `filter(Boolean)` przy renderze), więc dziura zostaje opisana, nie
   * załatana testem. KONTROLA DODATNIA: test wyżej dowodzi, że wklejenie dwóch
   * linii zachowuje się poprawnie, czyli technika pomiaru jest sprawna.
   */
  it.fails("Enter w polu listy punktów zostaje w polu", async () => {
    plan.rolesRead = ok([offer()]);
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");
    type(PANEL.reqPl, "Pierwszy\n");
    expect(field(PANEL.reqPl).value).toBe("Pierwszy\n");
  });
});

// ---------------------------------------------------------------------------
// USUNIĘCIE OFERTY
// ---------------------------------------------------------------------------

describe("/admin/hiring - usunięcie oferty jest nieodwracalne, więc pyta", () => {
  it("anulowane potwierdzenie NIE dotyka bazy i nie gasi formularza", async () => {
    plan.rolesRead = ok([offer()]);
    h.confirmAnswer = false;
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");

    fireEvent.click(screen.getByRole("button", { name: PANEL.remove }));

    expect(h.confirmMessages).toEqual([PANEL.confirmRemove]);
    expect(
      db()
        .chainsFor("career_roles")
        .some((item) => item.has("delete")),
    ).toBe(false);
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(field(PANEL.slug).value).toBe("analityk-zmyslony");
  });

  it("potwierdzone usunięcie idzie DELETE po id i zwalnia formularz", async () => {
    plan.rolesRead = ok([offer()]);
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");

    fireEvent.click(screen.getByRole("button", { name: PANEL.remove }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.removed));
    const chain = db()
      .chainsFor("career_roles")
      .filter((item) => item.has("delete"))
      .at(-1);
    expect(chain?.argsOf("delete")).toEqual([]);
    // Kasowanie celuje w klucz główny; najemcy pilnuje polityka, nie klient.
    expect(chain?.calls.filter((call) => call.method === "eq")).toEqual([
      { method: "eq", args: ["id", "oferta-1"] },
    ]);
    expect(await screen.findByText(PANEL.pickOne)).toBeInTheDocument();
    expect(read(TENANT_MIGRATION)).toContain("career_roles_staff_delete");
  });

  it("odmowa usunięcia zostawia ofertę wybraną i pokazuje komunikat bazy", async () => {
    plan.rolesRead = ok([offer()]);
    plan.rolesWrite = fail("permission denied for table career_roles", "42501");
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");

    fireEvent.click(screen.getByRole("button", { name: PANEL.remove }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("permission denied for table career_roles"),
    );
    expect(field(PANEL.slug).value).toBe("analityk-zmyslony");
  });
});

// ---------------------------------------------------------------------------
// IMPORT WBUDOWANEGO KATALOGU
// ---------------------------------------------------------------------------

describe("/admin/hiring - import wbudowanego katalogu ofert", () => {
  it("ładunek importu to PRZETŁUMACZONE teksty katalogu, a NIE klucze i18n", async () => {
    // TO JEST DOWÓD DEFEKTU OPISANEGO W KODZIE PRODUKCYJNYM
    // (`admin.hiring.tsx:281-284`): słownik `careers.*` mieszka w chunku trasy
    // publicznej, a w chunku admina go nie było, więc `getFixedT` zwracał
    // SUROWE KLUCZE i import zapisywał do bazy tytuły „careers.roles.<id>.title",
    // które trafiały na stronę /zatrudniamy. Rejestracja słownika jest tu
    // PRAWDZIWA (import modułu trasy ciągnie `@/lib/i18n-careers`), więc ten
    // test oblałby się natychmiast po jej usunięciu.
    await mount();
    fireEvent.click(screen.getByRole("button", { name: PANEL.importI18n }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.imported));
    const chain = db()
      .chainsFor("career_roles")
      .filter((item) => item.has("upsert"))
      .at(-1);
    const rows = chain?.argsOf("upsert")?.[0];
    expect(Array.isArray(rows)).toBe(true);
    const expected = fallbackRoleRows(realT("pl"), realT("en")).map((row) => ({
      ...row,
      tenant_id: TENANT,
    }));
    expect(rows).toEqual(expected);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("careers.roles.");
    expect(serialized).not.toContain("careers.departments.");
    expect(expected[0].title_pl.length).toBeGreaterThan(0);
    expect(expected[0].title_en).not.toBe(expected[0].title_pl);
  });

  it("import celuje w PARĘ (tenant_id, slug), więc powtórne kliknięcie nie wywraca się", async () => {
    // Unikalność slugu jest parą od migracji 20260814100000. `onConflict:
    // "slug"` celowałby w indeks, którego już nie ma, i drugie uruchomienie
    // importu kończyłoby się błędem konfliktu.
    await mount();
    fireEvent.click(screen.getByRole("button", { name: PANEL.importI18n }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.imported));
    expect(upsertOptions("career_roles")).toEqual({ onConflict: "tenant_id,slug" });
    expect(read(TENANT_MIGRATION)).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*ON public\.career_roles \(tenant_id, slug\)/,
    );
  });

  it("każdy wiersz importu niesie najemcę i wchodzi jako OPUBLIKOWANY", async () => {
    // Import wypuszcza treść na stronę od razu - dlatego jest to operacja
    // o skutku zewnętrznym, a nie „wypełnienie tabeli przykładami".
    await mount();
    fireEvent.click(screen.getByRole("button", { name: PANEL.importI18n }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.imported));
    const rows = db()
      .chainsFor("career_roles")
      .filter((item) => item.has("upsert"))
      .at(-1)
      ?.argsOf("upsert")?.[0];
    expect(Array.isArray(rows)).toBe(true);
    const list = rows as Array<Record<string, unknown>>;
    expect(list.length).toBeGreaterThan(0);
    for (const row of list) {
      expect(row.tenant_id).toBe(TENANT);
      expect(row.is_published).toBe(true);
    }
    // Kolejność katalogu jest ZAPISYWANA (co dziesięć), a nie zostawiona bazie.
    expect(list.map((row) => row.sort_order)).toEqual(list.map((_row, index) => index * 10));
  });

  it("import NIE pyta o potwierdzenie, choć UPSERT nadpisuje ręczne edycje", async () => {
    // Zachowanie ISTNIEJĄCE i asymetria warta zapisania: usunięcie JEDNEJ
    // oferty stoi za `window.confirm`, a jeden klik ikony pobrania nadpisuje
    // tytuły, opisy i flagę publikacji WSZYSTKICH ofert o slugach katalogu
    // wbudowanego. Przycisk rozpoznaje się wyłącznie po `title`, bo nie ma
    // etykiety tekstowej.
    await mount();
    fireEvent.click(screen.getByRole("button", { name: PANEL.importI18n }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.imported));
    expect(h.confirmMessages).toEqual([]);
  });

  it("sesja bez profilu najemcy nie importuje niczego", async () => {
    h.user = null;
    await mount();
    fireEvent.click(screen.getByRole("button", { name: PANEL.importI18n }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("tenant_unresolved"));
    expect(
      db()
        .chainsFor("career_roles")
        .some((item) => item.has("upsert")),
    ).toBe(false);
  });

  it("odmowa importu pokazuje komunikat bazy zamiast fałszywego sukcesu", async () => {
    plan.rolesWrite = fail("duplicate key value violates unique constraint", "23505");
    await mount();
    fireEvent.click(screen.getByRole("button", { name: PANEL.importI18n }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("duplicate key value violates unique constraint"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ZAKŁADKA „SEKCJE STRONY"
// ---------------------------------------------------------------------------

describe("/admin/hiring - zakładka sekcji strony", () => {
  /** Siedem kluczy sekcji w kolejności ODWROTNEJ do kanonicznej. */
  function shuffledSections(): CareerSectionRow[] {
    return [...CAREER_SECTION_KEYS]
      .slice()
      .reverse()
      .map((key, index) => section({ key, sort_order: index * 10 }));
  }

  it("kolejność sekcji jest KANONICZNA, a nie taka, jaką oddała baza", async () => {
    // `sort_order` w bazie da się przestawić (albo zaseedować odwrotnie), ale
    // kolejność sekcji na stronie /zatrudniamy jest ustalona w kodzie. Panel
    // porządkuje listę po `CAREER_SECTION_KEYS`, żeby operator widział ekran
    // w tej samej kolejności, w jakiej zobaczy go czytelnik.
    plan.sectionsRead = ok(shuffledSections());
    const { container } = await mount();
    switchTo(PANEL.tabSections);
    await screen.findByRole("heading", { name: "hero" });

    const keys = [...container.querySelectorAll("section h2")].map((node) => node.textContent);
    expect(keys).toEqual([...CAREER_SECTION_KEYS]);
    expect(screen.getByText(PANEL.sectionHint)).toBeInTheDocument();
  });

  it("nagłówki NULL renderują pustkę, a nie napis „null”", async () => {
    // Puste pole ma w tym panelu znaczenie: „weź tekst domyślny ze słownika".
    plan.sectionsRead = ok([
      section({
        key: "values",
        title_pl: null,
        title_en: null,
        subtitle_pl: null,
        subtitle_en: null,
      }),
    ]);
    await mount();
    switchTo(PANEL.tabSections);
    const card = sectionCard("values");

    expect(field(PANEL.sectionTitlePl, card).value).toBe("");
    expect(field(PANEL.sectionTitleEn, card).value).toBe("");
    expect(field(PANEL.sectionSubtitlePl, card).value).toBe("");
    expect(field(PANEL.sectionSubtitleEn, card).value).toBe("");
    expect(card.textContent).not.toContain("null");
  });

  it("zapis sekcji idzie UPSERT po parze (tenant_id, key) z pełnym ładunkiem nagłówków", async () => {
    // UPSERT, nie UPDATE: seed sekcji dostał tylko najemca domyślny, więc
    // u każdego innego `update().eq("key")` nie trafiał w żaden wiersz i zapis
    // CICHO nic nie robił. Klucz główny to (tenant_id, key).
    plan.sectionsRead = ok([section({ key: "benefits", sort_order: 30 })]);
    await mount();
    switchTo(PANEL.tabSections);
    const card = sectionCard("benefits");

    type(PANEL.sectionTitlePl, "Nowy nagłówek PL", card);
    type(PANEL.sectionTitleEn, "New heading EN", card);
    type(PANEL.sectionSubtitlePl, "Nowy podtytuł PL", card);
    type(PANEL.sectionSubtitleEn, "New subtitle EN", card);
    fireEvent.click(within(card).getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.saved));
    expect(payload("career_page_sections", "upsert")).toEqual({
      tenant_id: TENANT,
      key: "benefits",
      is_visible: true,
      sort_order: 30,
      title_pl: "Nowy nagłówek PL",
      title_en: "New heading EN",
      subtitle_pl: "Nowy podtytuł PL",
      subtitle_en: "New subtitle EN",
    });
    expect(upsertOptions("career_page_sections")).toEqual({ onConflict: "tenant_id,key" });
    expect(read(TENANT_MIGRATION)).toMatch(/PRIMARY KEY \(tenant_id, key\)/);
  });

  it("przełącznik „Widoczna” jedzie do ładunku - to on zdejmuje sekcję ze strony", async () => {
    plan.sectionsRead = ok([section({ key: "process", is_visible: true })]);
    await mount();
    switchTo(PANEL.tabSections);
    const card = sectionCard("process");

    fireEvent.click(within(card).getByRole("switch"));
    expect(within(card).getByRole("switch")).toHaveAttribute("aria-checked", "false");
    fireEvent.click(within(card).getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.saved));
    expect(payload("career_page_sections", "upsert").is_visible).toBe(false);
    expect(within(card).getByText(PANEL.sectionVisible)).toBeInTheDocument();
  });

  it("ZNALEZISKO G: zapis jednej sekcji kasuje niezapisane zmiany w pozostałych", async () => {
    // Zachowanie ISTNIEJĄCE. `SectionsTab` kopiuje `rows` do stanu lokalnego
    // efektem na `[rows]`, a zapis unieważnia klucz sekcji. Refetch oddaje NOWĄ
    // tablicę, efekt biegnie ponownie i nadpisuje stan - więc redakcja, która
    // wpisała nagłówki w dwóch sekcjach i zapisała pierwszą, traci drugą.
    plan.sectionsRead = ok([section({ key: "hero" }), section({ key: "form", sort_order: 50 })]);
    await mount();
    switchTo(PANEL.tabSections);

    type(PANEL.sectionTitlePl, "Zmiana w hero", sectionCard("hero"));
    type(PANEL.sectionTitlePl, "Zmiana w form", sectionCard("form"));
    // Baza po zapisie oddaje ZMIENIONY wiersz `hero` - to jest warunek, przy
    // którym defekt wychodzi: react-query dzieli strukturę odpowiedzi, więc
    // tożsamość tablicy zmienia się dopiero wtedy, gdy TREŚĆ się zmieniła,
    // i wtedy efekt kopiujący `rows` do stanu nadpisuje CAŁY stan lokalny.
    plan.sectionsRead = ok([
      section({ key: "hero", title_pl: "Zmiana w hero" }),
      section({ key: "form", sort_order: 50 }),
    ]);
    fireEvent.click(within(sectionCard("hero")).getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.saved));
    // Zapisana sekcja poszła do bazy z nową treścią…
    expect(payload("career_page_sections", "upsert").title_pl).toBe("Zmiana w hero");
    // …a niezapisana wróciła do treści z bazy.
    await waitFor(() =>
      expect(field(PANEL.sectionTitlePl, sectionCard("form")).value).toBe("Nagłówek zmyślony"),
    );
  });

  it("sesja bez profilu najemcy nie zapisuje sekcji", async () => {
    h.user = null;
    plan.sectionsRead = ok([section({ key: "closing", sort_order: 60 })]);
    await mount();
    switchTo(PANEL.tabSections);
    fireEvent.click(within(sectionCard("closing")).getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("tenant_unresolved"));
    expect(
      db()
        .chainsFor("career_page_sections")
        .some((item) => item.has("upsert")),
    ).toBe(false);
  });

  it("odmowa zapisu sekcji pokazuje komunikat bazy", async () => {
    plan.sectionsRead = ok([section({ key: "roles", sort_order: 40 })]);
    plan.sectionsWrite = fail("permission denied for table career_page_sections", "42501");
    await mount();
    switchTo(PANEL.tabSections);
    fireEvent.click(within(sectionCard("roles")).getByRole("button", { name: PANEL.save }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("permission denied for table career_page_sections"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("ZNALEZISKO D: odmowa odczytu sekcji nie mówi NIC - zakładka wygląda na skonfigurowaną", async () => {
    // Zachowanie ISTNIEJĄCE: `sectionsQuery.data ?? []` sprowadza odmowę do
    // pustej listy, a lista sekcji nie ma nawet komunikatu pustki. Operator
    // widzi samą podpowiedź i może uznać, że sekcji po prostu nie ma.
    plan.sectionsRead = fail("odmowa RLS: career_sections_staff_read", "42501");
    const { container, queryClient } = await mount();
    switchTo(PANEL.tabSections);
    await waitFor(() =>
      expect(queryClient.getQueryState(["career-page-sections", "admin"])?.status).toBe("error"),
    );
    expect(container.querySelectorAll("section")).toHaveLength(0);
    expect(screen.getByText(PANEL.sectionHint)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ZAKŁADKA „RETENCJA CV" - DECYZJA RODO
// ---------------------------------------------------------------------------

describe("/admin/hiring - retencja CV", () => {
  it("brak wiersza ustawień pokazuje wartości domyślne, na których i tak działa job", async () => {
    // 365 dni / 24 h to DEFAULT-y kolumn (`career_settings`), więc job usuwa
    // dane także u najemcy, który nigdy nie wszedł na tę zakładkę. Panel musi
    // pokazać te same liczby, inaczej kłamie o obowiązującej polityce.
    plan.settingsRead = ok(null);
    await openRetention(await mount());

    expect(field(PANEL.retentionDays)).toHaveValue(365);
    expect(field(PANEL.graceHours)).toHaveValue(24);
    expect(read(RETENTION_MIGRATION)).toMatch(/cv_retention_days integer NOT NULL DEFAULT 365/);
    expect(read(RETENTION_MIGRATION)).toMatch(/orphan_grace_hours integer NOT NULL DEFAULT 24/);
  });

  it("istniejący wiersz nadpisuje domyślne liczby wartościami najemcy", async () => {
    plan.settingsRead = ok({
      tenant_id: TENANT,
      cv_retention_days: 90,
      orphan_grace_hours: 6,
    });
    await openRetention(await mount());

    expect(field(PANEL.retentionDays)).toHaveValue(90);
    expect(field(PANEL.graceHours)).toHaveValue(6);
    const chain = db().lastChain("career_settings");
    expect(chain?.argsOf("select")).toEqual(["tenant_id,cv_retention_days,orphan_grace_hours"]);
    expect(chain?.argsOf("limit")).toEqual([1]);
    expect(chain?.has("maybeSingle")).toBe(true);
    // Odczyt NIE filtruje po najemcy - zakres wyznacza `career_settings_staff_read`.
    expect(chain?.calls.filter((call) => call.method === "eq")).toEqual([]);
  });

  it("zapis retencji idzie UPSERT z JAWNYM najemcą i liczbami z formularza", async () => {
    plan.settingsRead = ok(null);
    await openRetention(await mount());

    type(PANEL.retentionDays, "180");
    type(PANEL.graceHours, "48");
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.saved));
    expect(payload("career_settings", "upsert")).toEqual({
      tenant_id: TENANT,
      cv_retention_days: 180,
      orphan_grace_hours: 48,
    });
    expect(upsertOptions("career_settings")).toEqual({ onConflict: "tenant_id" });
  });

  it("zapis retencji odświeża odczyt ustawień, więc ekran nie zostaje na starych liczbach", async () => {
    plan.settingsRead = ok(null);
    await openRetention(await mount());
    const readsBefore = db()
      .chainsFor("career_settings")
      .filter((item) => !item.has("upsert")).length;

    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("career_settings")
          .filter((item) => !item.has("upsert")).length,
      ).toBeGreaterThan(readsBefore),
    );
  });

  it("ZNALEZISKO E: wyczyszczone pole dni jedzie do bazy jako 0, poza dozwolonym zakresem", async () => {
    // Zachowanie ISTNIEJĄCE. `min`/`max` na polu są dekoracją: „Zapisz" nie
    // jest `type="submit"` i nie stoi w `<form>`, więc walidacja HTML nigdy nie
    // biegnie. `Number("")` to 0, a CHECK w bazie dopuszcza 1..3650 - panel
    // oddaje decyzję RODO bazie i pokaże operatorowi surowy błąd PostgREST.
    plan.settingsRead = ok(null);
    await openRetention(await mount());

    expect(field(PANEL.retentionDays)).toHaveAttribute("min", "1");
    expect(field(PANEL.retentionDays)).toHaveAttribute("max", "3650");
    expect(field(PANEL.retentionDays).closest("form")).toBeNull();

    type(PANEL.retentionDays, "");
    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(PANEL.saved));
    expect(payload("career_settings", "upsert").cv_retention_days).toBe(0);
    expect(read(RETENTION_MIGRATION)).toMatch(/CHECK \(cv_retention_days BETWEEN 1 AND 3650\)/);
  });

  it("sesja bez profilu najemcy nie zapisuje polityki retencji", async () => {
    h.user = null;
    plan.settingsRead = ok(null);
    await openRetention(await mount());

    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("tenant_unresolved"));
    expect(
      db()
        .chainsFor("career_settings")
        .some((item) => item.has("upsert")),
    ).toBe(false);
  });

  it("odmowa zapisu retencji pokazuje komunikat bazy - i to jest ślad ZNALEZISKA A", async () => {
    // Redaktor (`isStaff`, nie `admin`) dostanie dokładnie taki toast przy
    // KAŻDEJ próbie zapisu, bo polityka `career_settings_admin_write` go nie
    // przepuszcza. Panel nie ostrzega o tym wcześniej.
    plan.settingsRead = ok(null);
    plan.settingsWrite = fail("new row violates row-level security policy", "42501");
    await openRetention(await mount());

    fireEvent.click(screen.getByRole("button", { name: PANEL.save }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("new row violates row-level security policy"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("ZNALEZISKO D: odmowa odczytu ustawień pokazuje DOMYŚLNE 365/24 jak własną politykę", async () => {
    // Zachowanie ISTNIEJĄCE i najcięższy wariant tej klasy defektu na tym
    // ekranie: `settings.data?.cv_retention_days ?? 365` nie odróżnia „nie
    // udało się przeczytać" od „najemca nie ma wiersza". Operator widzi więc
    // liczby, które NIE MUSZĄ być obowiązującą polityką - a jeden klik
    // „Zapisz" nadpisze nimi realne, krótsze okno retencji. To decyzja RODO.
    plan.settingsRead = fail("permission denied for table career_settings", "42501");
    const view = await mount();
    switchTo(PANEL.tabRetention);
    await awaitField(PANEL.retentionDays);
    await waitFor(() =>
      expect(view.queryClient.getQueryState(["admin-career-settings"])?.status).toBe("error"),
    );

    expect(field(PANEL.retentionDays)).toHaveValue(365);
    expect(field(PANEL.graceHours)).toHaveValue(24);
    expect(screen.getByRole("button", { name: PANEL.save })).toBeEnabled();
  });

  it("odpowiedź licznika BEZ pola `count` czyta się jako zero, nie jako awaria", async () => {
    // Zapytanie `head: true` oddaje wyłącznie licznik i przy braku nagłówka
    // `Prefer: count` PostgREST nie podaje go wcale. `count ?? 0` domyka tę
    // gałąź - bez niej panel wypisywałby „null" zamiast liczby.
    plan.queue = ok(null);
    const view = await mount();
    switchTo(PANEL.tabRetention);
    await awaitField(PANEL.retentionDays);
    await waitFor(() =>
      expect(view.queryClient.getQueryState(["admin-career-cv-queue"])?.data).toBe(0),
    );
    expect(screen.getByText(PANEL.queueEmpty)).toBeInTheDocument();
  });

  it("kolejka usunięć podaje LICZBĘ zaległości, gdy job ma co robić", async () => {
    // Kolejka to jedyne okno na to, czy pliki CV faktycznie schodzą z magazynu.
    plan.queue = okCount(7);
    await mount();
    switchTo(PANEL.tabRetention);

    expect(await screen.findByText(`${PANEL.queuePending} 7`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: PANEL.queueTitle })).toBeInTheDocument();
    const chain = db().lastChain("career_cv_gc_queue");
    expect(chain?.argsOf("select")).toEqual(["id", { count: "exact", head: true }]);
  });

  it("pusta kolejka mówi wprost, że jest pusta", async () => {
    plan.queue = okCount(0);
    await mount();
    switchTo(PANEL.tabRetention);
    expect(await screen.findByText(PANEL.queueEmpty)).toBeInTheDocument();
  });

  it("ZNALEZISKO D: nieudany odczyt kolejki czyta się jako „Kolejka pusta.”", async () => {
    // Zachowanie ISTNIEJĄCE i najbardziej mylące z całej trójki: awaria
    // odczytu daje komunikat NAJBARDZIEJ USPOKAJAJĄCY z możliwych, choć
    // zaległość może rosnąć. `queue.data ? ... : L.queueEmpty` nie odróżnia
    // `undefined` (błąd) od zera.
    plan.queue = fail("permission denied for table career_cv_gc_queue", "42501");
    const { queryClient } = await mount();
    switchTo(PANEL.tabRetention);
    await waitFor(() =>
      expect(queryClient.getQueryState(["admin-career-cv-queue"])?.status).toBe("error"),
    );
    expect(screen.getByText(PANEL.queueEmpty)).toBeInTheDocument();
  });

  it("zakładka wyjaśnia RODO-wą treść obu okien, zamiast pokazywać dwie nagie liczby", async () => {
    // Podpowiedzi nie są ozdobą: bez nich operator nie wie, że otwarty proces
    // NIE traci CV i że plik ląduje w buckecie przed wysłaniem formularza.
    await mount();
    switchTo(PANEL.tabRetention);

    expect(await screen.findByText(/Job „career-cv-retention” usuwa je/)).toBeInTheDocument();
    expect(screen.getByText(/Otwarty proces nie traci CV/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Liczone od zmiany etapu na zatrudniony \/ odrzucony \/ wycofane\. 1-3650\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/to okno chroni kandydata/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NAWIGACJA MIĘDZY ZAKŁADKAMI
// ---------------------------------------------------------------------------

describe("/admin/hiring - zakładki", () => {
  it("zakładki przełączają POWIERZCHNIE i wracają, nie gubiąc wybranej oferty", async () => {
    // Trzy zakładki to trzy różne tabele. Wyjście na retencję i powrót nie
    // może kasować niezapisanego szkicu - dlatego stan wyboru trzyma trasa.
    plan.rolesRead = ok([offer()]);
    await mount();
    await pickOffer("Analityk zmyślonego rejestru");
    type(PANEL.titlePl, "Wersja robocza");

    switchTo(PANEL.tabRetention);
    expect(await awaitField(PANEL.retentionDays)).toBeInTheDocument();
    expect(screen.queryByLabelText(PANEL.slug, { exact: false })).toBeNull();

    switchTo(PANEL.tabRoles);
    expect(await awaitField(PANEL.titlePl)).toHaveValue("Wersja robocza");
  });
});

// ---------------------------------------------------------------------------
// DOSTĘPNOŚĆ
// ---------------------------------------------------------------------------

describe("/admin/hiring - dostępność", () => {
  it("zakładka ofert z otwartym formularzem nie ma naruszeń axe", async () => {
    // Formularz oferty ma 14 kontrolek, cztery droplisty i przełącznik - to
    // najgęstszy ekran tej trasy i najłatwiej tu zgubić etykietę.
    plan.rolesRead = ok([offer()]);
    const { container } = await mount();
    await pickOffer("Analityk zmyślonego rejestru");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("zakładka sekcji nie ma naruszeń axe", async () => {
    plan.sectionsRead = ok([...CAREER_SECTION_KEYS].map((key) => section({ key })));
    const { container } = await mount();
    switchTo(PANEL.tabSections);
    await screen.findByRole("heading", { name: "hero" });

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("zakładka retencji nie ma naruszeń axe", async () => {
    plan.queue = okCount(3);
    const view = await mount();
    await openRetention(view);

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
