// CZTERY TRASY PANELU ZAMONTOWANE: `/admin/greetings`, `/admin/popups`,
// `/admin/audience`, `/admin/personalized`.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
// `src/routes/__tests__/adminRouteAuthority.gate.test.ts` argumentuje wprost,
// że render-testowanie tras panelu DLA POKRYCIA jest farmą: ryzyko w trasie
// panelu to DOSTĘP, a dostęp jest egzekwowany w trzech miejscach (wspólny
// layout `/admin` z `isStaff`, sama trasa, RLS/RPC w bazie). Ta bramka ma
// rację i te cztery trasy są w jej zasięgu (skan katalogu `src/routes`).
//
// Ten plik pokrywa dokładnie to, czego bramka statyczna NIE WIDZI, bo widzi
// tylko tekst pliku. Te cztery panele mają jedną wspólną cechę, która czyni je
// wyjątkowo wrażliwymi: KAŻDY z nich czyta stan z bazy i KAŻDY nadpisuje ten
// stan całym swoim widokiem. Jeżeli odczyt zwróci coś innego niż panel
// zakłada, administrator nie dostaje błędu - dostaje FORMULARZ WYPEŁNIONY
// WARTOŚCIAMI DOMYŚLNYMI, a przycisk „Zapisz” zamienia tę pomyłkę w fakt
// w bazie. Dlatego przedmiotem dowodu jest tu:
//
//   1. ODCZYT W PIĘCIU WARIANTACH: wartość obecna, brak wiersza, wartość
//      FAŁSZYWA ALE PRAWIDŁOWA (`0`, `""`, `false`), wartość nieprawidłowa
//      (obcy kształt, `null`, zły typ) i wartość POZA ENUMEM.
//      `value || default` zamiast `value ?? default` to najczęstszy realny
//      defekt tych paneli: administrator ustawia zero, zapisuje i po
//      odświeżeniu widzi starą wartość, bez żadnego komunikatu.
//   2. STAN PUSTY vs STAN BŁĘDU - ROZDZIELONE. To klasa defektu, która w tym
//      repo wystąpiła już trzy razy: awaria odczytu pokazana jako „brak
//      wyników” mówi administratorowi, że baza jest pusta, kiedy jest zepsuta.
//      Trzy z czterech tras mają tu realny defekt - zgłoszony `it.fails`.
//   3. ŁADUNEK KAŻDEJ MUTACJI: co dokładnie leci do bazy (klucz sekcji,
//      `onConflict`, kolumny, argumenty RPC), a nie tylko „że coś poleciało”.
//   4. BRAMKA POLA MARTWEGO: zmiana KAŻDEJ kontrolki panelu MUSI zmienić
//      ładunek zapisu. Ustawienie, które nie dojeżdża do bazy, nie daje
//      żadnego komunikatu - jest tylko opcją, która „nie działa”.
//   5. REGUŁY KIEROWANIA TREŚCI (`/admin/audience`, `/admin/personalized`) -
//      to logika decydująca, KTO co widzi, więc każdy jej warunek dostaje oba
//      ramiona: lejek, kohorty retencji, sekcje personalizacji, wygasanie
//      zapisów gościa.
//   6. ODMOWA Z BAZY (`not_authorized`, `42501`): co widzi administrator i czy
//      cache czytelnika NIE został unieważniony po nieudanym zapisie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - AUTORYTETU BAZY. Zapis do `site_settings` i `builder_popups` pilnuje RLS
//   (personel w obrębie najemcy), a RPC audytorium (`admin_member_funnel`,
//   `admin_member_activity_series`, `admin_member_retention`) są SECURITY
//   DEFINER z guardem admina w ciele funkcji (migracja 20260713190000).
//   Mają własne testy pgTAP (`rls_tenant_isolation_test.sql`,
//   `security_hardening_rls_test.sql`). Tutaj atrapa NIE odtwarza tych reguł -
//   dowodzimy, czy panel woła właściwą funkcję z właściwymi argumentami i co
//   robi z jej odmową.
// - SILNIKA POWITAŃ. `pickGreeting` (wołacz PL, pule per pora dnia, stabilny
//   wariant w okno 30 min) ma własny, wyczerpujący test - tutaj jest PRAWDZIWY
//   i dowodzimy wyłącznie tego, że panel podaje mu swój słownik i sensowne
//   dane podglądu.
// - PARSERA USTAWIEŃ POPUPU. `parsePopupSettings` / `safeParseBuilderDoc` mają
//   testy w `src/lib/builder/__tests__` - tutaj są prawdziwe i dowodzimy
//   wyłącznie tego, co panel z ich wyniku POKAZUJE i ODDAJE do bazy.
// - ORGANIZMÓW SKŁADOWYCH: `SignupPopupContentSection` (edytor wbudowanego
//   popupu rejestracji), `Chart` i `AdminShell` są atrapami zapisującymi
//   propsy - każdy ma własny test. Przedmiotem dowodu jest to, CO panel im
//   przekazuje i GDZIE je umieszcza.
// - NAGŁÓWKÓW SEO: panel jest `noindex` z definicji; sprawdzamy tylko, że
//   żadna z czterech tras nie dokłada sobie `head()`.
//
// UWAGA O ASERCJACH NA NAPISACH. Trzy panele używają `t()` i asercje idą na
// KLUCZACH (atrapa i18n zwraca klucz). `/admin/greetings` i18n NIE UŻYWA -
// nosi własne bliźniaki `isPL ? "..." : "..."` w kodzie, więc w tym jednym
// obszarze asercja musi dotknąć literału z produkcji. To samo w sobie jest
// obserwacją: te napisy są niewidoczne dla bramki parytetu PL/EN i dla
// tłumacza (dokładnie problem, który `/admin/audience` rozwiązał, przenosząc
// swoje 23 napisy do `lib/i18n-admin-audience`).
//
// DEFEKTY ZNALEZIONE I ZGŁOSZONE `it.fails` (produkcja BEZ ZMIAN - konwencja
// repo): osiem sztuk, każdy z opisem, lokalizacją i konsekwencją przy swoim
// teście w ostatniej sekcji pliku. Każdy ma KONTROLĘ DODATNIĄ - zwykły `it`
// przypinający stan FAKTYCZNY, żeby `it.fails` nie zaczął kiedyś „przechodzić”
// z innego powodu niż naprawa (np. dlatego, że panel przestał się renderować).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useState, type MouseEvent, type ReactNode } from "react";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";

/**
 * Ustalona data bazowa - żadnego `Date.now()` ani `Math.random()`. Panel
 * popupów formatuje `updated_at`, a podgląd powitań buduje siedem dat
 * testowych od „teraz”, więc zegar musi stać.
 */
const BASE_ISO = "2026-01-15T10:00:00.000Z";
const OLDER_ISO = "2025-12-01T08:30:00.000Z";

const h = vi.hoisted(() => ({
  /**
   * `i18n.language`. Typ dopuszcza `undefined`, bo realna instancja i18next
   * przed inicjalizacją też go nie ma - i właśnie dlatego trzy z czterech tras
   * piszą `i18n.language ?? "pl"`. Bez tego wariantu prawe ramię tego `??`
   * nigdy by się nie wykonało.
   */
  lang: "pl" as string | undefined,
  /** Atrapa łańcucha PostgREST, ustawiana w `beforeEach`. */
  db: null as SupabaseFromStub | null,
  /** Tabele, których odczyt NIGDY się nie rozwiązuje (stan „w toku”). */
  hangTables: new Set<string>(),
  /** Funkcje RPC, które nigdy nie odpowiadają (stan „w toku”). */
  hangRpc: new Set<string>(),
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpcResponses: new Map<string, () => SupabaseResult>(),
  /** Użytkownik sesji - `created_by` w nowym popupie. `null` = brak sesji. */
  sessionUser: null as { id: string } | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Wiersz `site_settings` widziany przez powitania i personalizację. */
  settingsRow: null as unknown,
  settingsReadFails: false,
  settingsSaveFail: null as { message: string; code: string } | null,
  /** Wiersze `builder_popups` widziane przez listę popupów. */
  popupRows: [] as Record<string, unknown>[],
  popupsReadFails: false,
  popupInsertFails: false,
  /** Liczniki `popup_events` per popup. `null` = brak licznika w odpowiedzi. */
  stats: {} as Record<string, { views: number | null; conversions: number | null }>,
  /** Najemca sesji; `null` = brak kontekstu (zapytanie listy wyłączone). */
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as string | null,
  /** `newsletter_settings` widziane przez wiersz wbudowanego popupu. */
  newsletter: undefined as Record<string, unknown> | undefined,
  newsletterSaves: [] as unknown[],
  /** Przejścia zlecone przez trasę popupów. */
  navigations: [] as { to: string; params?: Record<string, unknown> }[],
  /** Propsy zapisane przez atrapy organizmów. */
  props: {} as Record<string, Record<string, unknown>>,
  /** Rejestracje słownika audytorium - trasa robi to w swoim chunku. */
  ensureAudienceI18n: 0,
  /** Przewinięcia do edytora wbudowanego popupu. */
  scrollTargets: [] as string[],
  /**
   * Gdy `true`, atrapa zakładek montuje ZAWARTOŚĆ WSZYSTKICH kart naraz.
   * Radix bez `forceMount` tego nie robi, więc domyślnie jest `false` -
   * flaga istnieje dla jednego dowodu: że panel powitań ma własną, drugą
   * bramkę (`lang === l`) i nie zrenderuje pól nieaktywnego języka nawet
   * wtedy, gdy zakładka je zamontuje.
   */
  tabsForceMount: false,
}));

// ---------------------------------------------------------------------------
// ATRAPY. Komponenty atrap są DEKLARACJAMI funkcji w zasięgu modułu (a nie
// wyrażeniami w fabryce), bo fabryka `vi.mock` wykonuje się w trakcie importu
// trasy - czyli PRZED inicjalizacją stałych tego pliku. Deklaracja funkcji
// jest hoistowana wraz z ciałem, więc fabryka ma co zwrócić, a hooki w środku
// widzi `react-hooks` jako hooki komponentu.
// ---------------------------------------------------------------------------

/** Obietnica, która nigdy się nie rozwiązuje - stan „odczyt w toku”. */
function never(): Promise<never> {
  return new Promise<never>(() => undefined);
}

/** Łańcuch PostgREST, który nigdy nie odpowiada. */
function hangingBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    then: () => never(),
    maybeSingle: () => never(),
    single: () => never(),
  };
  for (const link of ["select", "insert", "update", "upsert", "delete", "eq", "order", "limit"]) {
    builder[link] = () => builder;
  }
  return builder;
}

/** Atrapa organizmu: marker w DOM + zapis propsów. */
function propsStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.props[name] = props;
    return <div data-testid={name} />;
  };
}

/**
 * Powłoka panelu. W odróżnieniu od `propsStub` ta atrapa MUSI renderować
 * dzieci: `/admin/personalized` wkłada w `<AdminShell>` CAŁY swój ekran -
 * także stan wczytywania (`admin.loading`) - więc atrapa pochłaniająca
 * `children` sprowadza każdą asercję na treści panelu do pomiaru pustej
 * strony. Propsy zapisujemy dalej, bo przedmiotem dowodu jest też
 * `hideSidebar` (ta trasa stoi poza layoutem `/admin` i nawigacji nie ma).
 */
function AdminShellMock(props: { children?: ReactNode; hideSidebar?: boolean }) {
  h.props.AdminShell = { ...props };
  return <div data-testid="AdminShell">{props.children}</div>;
}

interface TabsState {
  active: string;
  select: (next: string) => void;
}
const TabsCtx = createContext<TabsState>({ active: "", select: () => undefined });

/**
 * Zakładki: Radix pod happy-dom nie ma pełnego API wskaźnika, a przedmiotem
 * dowodu jest to, KTÓRA karta jest aktywna i co panel w niej renderuje.
 * Atrapa obsługuje OBA tryby, których używają trasy: sterowany
 * (`value` + `onValueChange` - powitania) i niesterowany (`defaultValue` -
 * personalizacja).
 */
function TabsMock({
  value,
  defaultValue,
  onValueChange,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (next: string) => void;
  children?: ReactNode;
}) {
  const [own, setOwn] = useState(defaultValue ?? "");
  const active = value ?? own;
  const select = (next: string) => {
    setOwn(next);
    onValueChange?.(next);
  };
  return (
    <TabsCtx.Provider value={{ active, select }}>
      <div data-testid="tabs" data-value={active}>
        {children}
      </div>
    </TabsCtx.Provider>
  );
}

function TabsListMock({ children }: { children?: ReactNode }) {
  return <div data-testid="tabs-list">{children}</div>;
}

function TabsTriggerMock({ value, children }: { value: string; children?: ReactNode }) {
  const { active, select } = useContext(TabsCtx);
  return (
    <button
      type="button"
      data-tab-trigger={value}
      data-state={active === value ? "active" : "inactive"}
      onClick={() => select(value)}
    >
      {children}
    </button>
  );
}

function TabsContentMock({ value, children }: { value: string; children?: ReactNode }) {
  const { active } = useContext(TabsCtx);
  if (!h.tabsForceMount && active !== value) return null;
  return <div data-tab-content={value}>{children}</div>;
}

function SwitchMock({
  checked,
  onCheckedChange,
  disabled,
  ...rest
}: {
  checked?: boolean;
  onCheckedChange?: (next: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      checked={Boolean(checked)}
      disabled={disabled}
      aria-label={rest["aria-label"]}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  );
}

/** Stan otwarcia okna - `DialogContent` renderuje się tylko dla otwartego. */
const dialogState = { open: false, alertOpen: false };

function DialogMock({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  dialogState.open = open;
  return (
    <div data-testid="dialog" data-open={String(open)}>
      {/* Zamknięcie „z zewnątrz” (Escape / klik w tło) - jedyna droga do
          gałęzi `onOpenChange`, której nie da się kliknąć w treści okna. */}
      <button
        type="button"
        data-testid="dialog-close-outside"
        onClick={() => onOpenChange?.(false)}
      >
        zamknij z zewnątrz
      </button>
      <button type="button" data-testid="dialog-open-outside" onClick={() => onOpenChange?.(true)}>
        otwórz z zewnątrz
      </button>
      {children}
    </div>
  );
}

function DialogContentMock({ children }: { children?: ReactNode }) {
  return dialogState.open ? <div data-testid="dialog-content">{children}</div> : null;
}

function AlertDialogMock({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  dialogState.alertOpen = open;
  return (
    <div data-testid="alert" data-open={String(open)}>
      <button type="button" data-testid="alert-close-outside" onClick={() => onOpenChange?.(false)}>
        zamknij z zewnątrz
      </button>
      <button type="button" data-testid="alert-open-outside" onClick={() => onOpenChange?.(true)}>
        otwórz z zewnątrz
      </button>
      {children}
    </div>
  );
}

function AlertDialogContentMock({ children }: { children?: ReactNode }) {
  return dialogState.alertOpen ? <div data-testid="alert-content">{children}</div> : null;
}

function PlainBox({ children }: { children?: ReactNode }) {
  return <div>{children}</div>;
}

function PlainTitle({ children }: { children?: ReactNode }) {
  return <h3>{children}</h3>;
}

function PlainText({ children }: { children?: ReactNode }) {
  return <p>{children}</p>;
}

function AlertCancelMock({ children, disabled }: { children?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" data-testid="alert-cancel" disabled={disabled}>
      {children}
    </button>
  );
}

function AlertActionMock({
  children,
  disabled,
  onClick,
}: {
  children?: ReactNode;
  disabled?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button type="button" data-testid="alert-confirm" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

vi.mock("react-i18next", async () => {
  const { translateKey } = await import("@/test/i18nStub");
  // Jeden STABILNY obiekt `i18n` z getterem na `language`, jak realna
  // instancja i18next - panele wpinają go w tablice zależności.
  const i18n = {
    get language() {
      return h.lang;
    },
    t: translateKey,
  };
  return {
    useTranslation: () => ({ t: translateKey, i18n }),
    initReactI18next: { type: "3rdParty", init: () => undefined },
    Trans: (props: { children?: unknown }) => props.children ?? null,
  };
});

vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { fail } = await import("@/test/supabaseChain");
  return {
    supabase: {
      from: (table: string) => {
        if (h.hangTables.has(table)) return hangingBuilder();
        if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
        return h.db.from(table);
      },
      rpc: (name: string, args?: Record<string, unknown>) => {
        h.rpcCalls.push({ name, args: args ?? {} });
        if (h.hangRpc.has(name)) return never();
        const responder = h.rpcResponses.get(name);
        // Brak zaplanowanej odpowiedzi to BŁĄD TESTU, nie ciche `[]`: milcząca
        // pustka udawałaby poprawny odczyt RPC, którego test nie zaplanował.
        return Promise.resolve(responder ? responder() : fail(`test: brak odpowiedzi RPC ${name}`));
      },
      auth: {
        getSession: async () => ({
          data: { session: h.sessionUser ? { user: h.sessionUser } : null },
        }),
      },
    },
  };
});

vi.mock("@/lib/tenant", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCurrentTenantId: () => h.tenantId,
}));

vi.mock("@/lib/i18n-admin-audience", () => ({
  ensureI18n: () => {
    h.ensureAudienceI18n += 1;
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    // Harness montuje JEDNĄ trasę, a lista popupów przenosi na trasę
    // potomną - więc przedmiotem dowodu są ARGUMENTY przejścia, nie
    // rozwiązanie adresu (to należy do generatora drzewa tras).
    useNavigate: () => (options: { to: string; params?: Record<string, unknown> }) => {
      h.navigations.push(options);
      return Promise.resolve();
    },
  };
});

vi.mock("@/hooks/useNewsletterSettings", () => ({
  useNewsletterSettings: () => ({ data: h.newsletter }),
  useSaveNewsletterSettings: () => ({
    mutateAsync: async (patch: unknown) => {
      h.newsletterSaves.push(patch);
      return patch;
    },
  }),
}));

vi.mock("@/components/admin/AdminShell", () => ({ AdminShell: AdminShellMock }));
vi.mock("@/components/charts/Chart", () => ({ Chart: propsStub("Chart") }));
vi.mock("@/components/admin/popups/SignupPopupContentSection", () => ({
  SignupPopupContentSection: propsStub("SignupPopupContentSection"),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: TabsMock,
  TabsList: TabsListMock,
  TabsTrigger: TabsTriggerMock,
  TabsContent: TabsContentMock,
}));
vi.mock("@/components/ui/switch", () => ({ Switch: SwitchMock }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: DialogMock,
  DialogContent: DialogContentMock,
  DialogHeader: PlainBox,
  DialogFooter: PlainBox,
  DialogTitle: PlainTitle,
  DialogDescription: PlainText,
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: AlertDialogMock,
  AlertDialogContent: AlertDialogContentMock,
  AlertDialogHeader: PlainBox,
  AlertDialogFooter: PlainBox,
  AlertDialogTitle: PlainTitle,
  AlertDialogDescription: PlainText,
  AlertDialogCancel: AlertCancelMock,
  AlertDialogAction: AlertActionMock,
}));

// Kolejność ma znaczenie: atrapa klienta Supabase sięga po `fail` z tego
// modułu w swojej fabryce, więc ten import MUSI stać przed importami tras.
import { fail, ok, okCount, supabaseFromStub } from "@/test/supabaseChain";
import { renderRoute, routeMeta } from "@/test/routeHarness";
// Wartości domyślne i klucze sekcji BIERZEMY Z PRODUKCJI, nie przepisujemy
// z ręki: literówka w kluczu dałaby test, który „przechodzi” obok panelu.
import {
  DEFAULT_GREETINGS,
  type GreetingsDictionary,
  type TimeBucket,
} from "@/lib/greetings/greetings";
import {
  DEFAULT_PERSONALIZED_SETTINGS,
  PERSONALIZED_SETTINGS_KEY,
} from "@/hooks/usePersonalizedSettings";
import { Route as GreetingsRoute } from "@/routes/admin.greetings";
import { Route as PopupsRoute } from "@/routes/admin.popups";
import { Route as AudienceRoute } from "@/routes/admin.audience";
import { Route as PersonalizedRoute } from "@/routes/admin.personalized";

// ---------------------------------------------------------------------------
// FIXTURE'Y. RODO: żadnych realnych danych osobowych - adresy wyłącznie
// w domenie `example.org`, adresy IP tylko z puli dokumentacyjnej RFC 5737.
// ---------------------------------------------------------------------------

const GREETINGS_KEY = "greetings";
const SESSION_USER = { id: "11111111-1111-4111-8111-111111111111" };

/** Kolejność sekcji w panelu powitań - taka sama jak stała `BUCKETS` trasy. */
const BUCKETS: readonly TimeBucket[] = [
  "night",
  "earlyMorning",
  "morning",
  "noon",
  "afternoon",
  "evening",
  "lateEvening",
];

/** Mapa pór dnia budowana JAWNIE - bez rzutowania pustego akumulatora. */
function bucketMap(make: (bucket: TimeBucket) => string[]): Record<TimeBucket, string[]> {
  return {
    night: make("night"),
    earlyMorning: make("earlyMorning"),
    morning: make("morning"),
    noon: make("noon"),
    afternoon: make("afternoon"),
    evening: make("evening"),
    lateEvening: make("lateEvening"),
  };
}

/**
 * Słownik z DOKŁADNIE JEDNYM powitaniem na porę dnia. Jedno-elementowa pula
 * czyni podgląd deterministycznym: `pickGreeting` wybiera wariant hashem
 * ziarna modulo długość puli, więc przy długości 1 wynik nie zależy od zegara.
 */
function singletonDict(plPrefix: string, enPrefix: string): GreetingsDictionary {
  return {
    pl: bucketMap((bucket) => [`${plPrefix} ${bucket}, {name}`]),
    en: bucketMap((bucket) => [`${enPrefix} ${bucket}, {name}`]),
  };
}

interface FunnelShape {
  members_total: number;
  members_new: number;
  discoverable_total: number;
  discoverable_new: number;
  active_members: number;
  readers: number;
  commenters: number;
  chat_senders: number;
  newsletter_subscribed: number;
  paying_members: number;
}

function funnelRow(overrides: Partial<FunnelShape> = {}): FunnelShape {
  return {
    members_total: 120,
    members_new: 8,
    discoverable_total: 40,
    discoverable_new: 3,
    active_members: 55,
    readers: 30,
    commenters: 12,
    chat_senders: 5,
    newsletter_subscribed: 77,
    paying_members: 9,
    ...overrides,
  };
}

interface SeriesShape {
  day: string;
  active_members: number;
  new_members: number;
}

interface RetentionShape {
  cohort_start: string;
  cohort_size: number;
  week_offset: number;
  active_members: number;
}

function popupRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "popup-1",
    name: "Newsletter jesień",
    status: "active",
    builder_data: { version: 1, sections: [] },
    settings: { trigger: "delay", delaySeconds: 12 },
    created_at: OLDER_ISO,
    updated_at: BASE_ISO,
    ...overrides,
  };
}

/** `newsletter_settings` w kształcie, jaki czyta wiersz wbudowanego popupu. */
function newsletterRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    popup_enabled: true,
    popup_trigger: "delay",
    popup_delay_seconds: 15,
    popup_scroll_percent: 50,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// POMOCNIKI DOM. Wszystkie zwracają węzły albo rzucają - test, który „mierzy”
// `undefined`, nie dowodzi niczego.
// ---------------------------------------------------------------------------

function buttons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
}

function buttonWithText(...texts: readonly string[]): HTMLButtonElement | undefined {
  return buttons().find((button) => texts.includes(button.textContent?.trim() ?? ""));
}

function requireButton(...texts: readonly string[]): HTMLButtonElement {
  const found = buttonWithText(...texts);
  if (!found) throw new Error(`test: brak przycisku ${texts.join("/")}`);
  return found;
}

function buttonWithTitle(title: string): HTMLButtonElement {
  const found = buttons().find((button) => button.getAttribute("title") === title);
  if (!found) throw new Error(`test: brak przycisku o tytule ${title}`);
  return found;
}

function switches(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[role="switch"]'));
}

/**
 * Pola tekstowe panelu. Selektor `input[type="text"]` ICH NIE WIDZI: `<Input>`
 * przekazuje `type` dalej bez wartości domyślnej, więc pole bez jawnego typu
 * (tytuł ekranu dla niezalogowanych, ścieżka listy, nagłówek sekcji) nie ma
 * w DOM atrybutu `type`. Filtrujemy więc po WŁAŚCIWOŚCI `type`, która dla
 * takiego elementu zwraca "text" - to samo, co widzi przeglądarka.
 */
function textInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>("input")).filter(
    (input) => input.type === "text",
  );
}

function textOf(): string {
  return document.body.textContent ?? "";
}

function queryElement(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector);
}

function requireElement(selector: string): HTMLElement {
  const found = queryElement(selector);
  if (!found) throw new Error(`test: brak elementu ${selector}`);
  return found;
}

function elements(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector));
}

/**
 * OSTATNI łańcuch tabeli, w którym wystąpiło dane ogniwo.
 *
 * DLACZEGO NIE `lastChain`. Mutacje listy popupów kończą się `invalidate()`,
 * więc zaraz po `update`/`delete` react-query ODPYTUJE listę ponownie -
 * i to zapytanie zostaje OSTATNIM łańcuchem tabeli. Asercja na `lastChain`
 * mierzy wtedy refetch (`argsOf("update")` = `undefined`), a nie mutację,
 * której dowodzi test. Filtr po ogniwie jest odporny na tę kolejność.
 */
function chainWith(table: string, method: string): RecordedChain {
  const found = (h.db?.chainsFor(table) ?? []).filter((chain) => chain.has(method)).at(-1);
  if (!found) throw new Error(`test: brak łańcucha ${table} z ogniwem ${method}`);
  return found;
}

/** Czy jakikolwiek łańcuch tabeli niesie dane ogniwo - warunek dla `waitFor`. */
function hasChainWith(table: string, method: string): boolean {
  return (h.db?.chainsFor(table) ?? []).some((chain) => chain.has(method));
}

/** Ostatni ładunek `upsert` do `site_settings` - to, co realnie leci do bazy. */
function lastUpsert(): { key: unknown; value: unknown } {
  const args = h.db?.lastChain("site_settings")?.argsOf("upsert");
  const payload = args?.[0];
  if (payload === null || typeof payload !== "object" || !("key" in payload)) {
    throw new Error("test: brak ładunku `upsert` w site_settings");
  }
  const record: Record<string, unknown> = { ...payload };
  return { key: record.key, value: record.value };
}

/** Opcje drugiego argumentu `upsert` - umowa o kluczu konfliktu. */
function lastUpsertOptions(): Record<string, unknown> {
  const args = h.db?.lastChain("site_settings")?.argsOf("upsert");
  const options = args?.[1];
  if (options === null || typeof options !== "object") {
    throw new Error("test: `upsert` bez opcji `onConflict`");
  }
  return { ...options };
}

/** Zapisana wartość jako obiekt - do asercji na pojedynczych polach. */
/**
 * STRAŻNIK, nie rzutowanie: `typeof x === "object"` zawęża do `object`, a z
 * `object` nie da się czytać pól - stąd predykat runtime, który zawęża do
 * odczytywalnego rekordu. Tablica jest odrzucana świadomie: ładunek z tablicą
 * tam, gdzie ma być obiekt, to defekt, nie wariant zapisu.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function savedRecord(): Record<string, unknown> {
  const { value } = lastUpsert();
  if (value === null || typeof value !== "object") {
    throw new Error("test: zapisana wartość nie jest obiektem");
  }
  return { ...value };
}

// ---------------------------------------------------------------------------
// MONTAŻ.
// ---------------------------------------------------------------------------

type Mounted = Awaited<ReturnType<typeof renderRoute>>;

function freshQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function mountGreetings(): Promise<Mounted> {
  return renderRoute({
    route: GreetingsRoute,
    path: "/admin/greetings",
    initialEntry: "/admin/greetings",
  });
}

async function mountPersonalized(): Promise<Mounted> {
  return renderRoute({
    route: PersonalizedRoute,
    path: "/admin/personalized",
    initialEntry: "/admin/personalized",
  });
}

async function mountPopups(queryClient?: QueryClient): Promise<Mounted> {
  return renderRoute({
    route: PopupsRoute,
    path: "/admin/popups",
    initialEntry: "/admin/popups",
    queryClient,
  });
}

async function mountAudience(queryClient?: QueryClient): Promise<Mounted> {
  return renderRoute({
    route: AudienceRoute,
    path: "/admin/audience",
    initialEntry: "/admin/audience",
    queryClient,
  });
}

/** Panel powitań gotowy do pracy - `loaded` już po odczycie. */
async function greetingsReady(): Promise<Mounted> {
  const view = await mountGreetings();
  await waitFor(() => expect(buttonWithText("Zapisz", "Save")).toBeTruthy());
  return view;
}

/** Panel personalizacji gotowy do pracy. */
async function personalizedReady(): Promise<Mounted> {
  const view = await mountPersonalized();
  await waitFor(() => expect(buttonWithText("admin.save")).toBeTruthy());
  return view;
}

/**
 * Klika „Zapisz” i CZEKA, aż zapis się domknie (przycisk wróci z etykiety
 * zapisywania). Potrzebne w pętlach bramki pola martwego: `save()` ustawia
 * `busy` synchronicznie, więc zaraz po kliknięciu przycisku o etykiecie
 * `label` W DOM NIE MA - kolejna iteracja wywalałaby się na jego braku,
 * zamiast mierzyć ładunek. `act` domyka mikrozadania zapisu, `waitFor` jest
 * siatką bezpieczeństwa - żadnego czekania na zegar.
 */
async function saveAndSettle(label: string): Promise<void> {
  fireEvent.click(requireButton(label));
  await act(async () => {});
  await waitFor(() => expect(buttonWithText(label)).toBeTruthy());
}

/** Lista popupów z co najmniej jednym wierszem danych. */
async function popupsReady(queryClient?: QueryClient): Promise<Mounted> {
  const view = await mountPopups(queryClient);
  await waitFor(() => expect(elements("tbody tr").length).toBeGreaterThan(1));
  return view;
}

function setRpc(name: string, result: SupabaseResult): void {
  h.rpcResponses.set(name, () => result);
}

beforeEach(() => {
  cleanup();
  // Datę zamrażamy BEZ podmiany timerów (`waitFor` musi dalej tykać realnie):
  // podgląd powitań buduje siedem dat od „teraz”, a lista popupów formatuje
  // `updated_at`.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(BASE_ISO));

  h.lang = "pl";
  h.hangTables = new Set();
  h.hangRpc = new Set();
  h.rpcCalls = [];
  h.rpcResponses = new Map();
  h.sessionUser = SESSION_USER;
  h.settingsRow = null;
  h.settingsReadFails = false;
  h.settingsSaveFail = null;
  h.popupRows = [];
  h.popupsReadFails = false;
  h.popupInsertFails = false;
  h.stats = {};
  h.tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  h.newsletter = newsletterRow();
  h.newsletterSaves = [];
  h.navigations = [];
  h.props = {};
  h.ensureAudienceI18n = 0;
  h.scrollTargets = [];
  h.tabsForceMount = false;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  dialogState.open = false;
  dialogState.alertOpen = false;

  const db = supabaseFromStub();
  h.db = db;

  db.setResponse("site_settings", (chain) => {
    if (chain.has("upsert")) {
      const failure = h.settingsSaveFail;
      return failure ? fail(failure.message, failure.code) : ok(null);
    }
    if (h.settingsReadFails) return fail("permission denied", "42501");
    return ok(h.settingsRow);
  });

  db.setResponse("builder_popups", (chain) => {
    if (chain.has("insert")) {
      return h.popupInsertFails ? fail("not_authorized", "42501") : ok({ id: "popup-nowy" });
    }
    if (chain.has("update") || chain.has("delete")) return ok(null);
    if (h.popupsReadFails) return fail("permission denied", "42501");
    return ok(h.popupRows);
  });

  db.setResponse("popup_events", (chain) => {
    const eqs = chain.calls.filter((call) => call.method === "eq");
    const popupId = String(eqs[0]?.args[1] ?? "");
    const kind = String(eqs[1]?.args[1] ?? "");
    const entry = h.stats[popupId];
    if (!entry) return okCount(0);
    const count = kind === "view" ? entry.views : entry.conversions;
    // `okCount(null)` nie istnieje - brak licznika oddajemy jawnie, bo trasa
    // czyta `count ?? 0` i to prawe ramię jest przedmiotem dowodu.
    return count === null ? { data: null, error: null, count: null } : okCount(count);
  });

  setRpc("admin_member_funnel", ok([funnelRow()]));
  setRpc("admin_member_activity_series", ok([]));
  setRpc("admin_member_retention", ok([]));

  // happy-dom nie implementuje `scrollIntoView` na elementach - wiersz
  // wbudowanego popupu go woła, więc podstawiamy rejestrator.
  Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) {
    h.scrollTargets.push(this.id);
  };
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ---------------------------------------------------------------------------
// 1. REGUŁA WSPÓLNA CZTERECH TRAS.
// ---------------------------------------------------------------------------

const ALL_ROUTES = [
  { name: "greetings", route: GreetingsRoute },
  { name: "popups", route: PopupsRoute },
  { name: "audience", route: AudienceRoute },
  { name: "personalized", route: PersonalizedRoute },
] as const;

describe("cztery trasy panelu - reguła wspólna", () => {
  it.each(ALL_ROUTES)(
    "$name: NIE deklaruje nagłówka SEO - panel nie jest stroną publiczną",
    async ({ route }) => {
      // Panel jest `noindex` z definicji (layout `/admin`). Trasa, która
      // dokłada sobie `head()` z tytułem, wchodzi do wyników wyszukiwania
      // jako treść serwisu - i wygląda tam jak strona dla czytelnika.
      expect(await routeMeta(route)).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// 2. `/admin/greetings` - słownik powitań, walidacja i podgląd.
// ---------------------------------------------------------------------------

describe("admin.greetings - odczyt słownika z bazy", () => {
  it("odczyt W TOKU pokazuje wczytywanie, a nie pusty formularz", async () => {
    // Pusty formularz przy trwającym odczycie to zaproszenie do zapisania
    // pustki na realnym słowniku powitań całego serwisu.
    h.hangTables.add("site_settings");
    await mountGreetings();
    expect(textOf()).toContain("admin.loading");
    expect(buttonWithText("Zapisz", "Save")).toBeUndefined();
  });

  it("BRAK wiersza w bazie otwiera panel na wartościach domyślnych", async () => {
    // Panel powitań jest jedynym ekranem, z którego naprawia się ten słownik.
    // Panel, który nie otwiera się bez wiersza, robi z pustej sekcji stan
    // nieodwracalny.
    //
    // Karta języka renderuje pola WSZYSTKICH siedmiu pór dnia naraz, więc
    // miarą „otwarcia na domyślnych” jest SUMA pul, a nie długość jednej puli
    // (`night` ma 7 wpisów, cały słownik PL - 50). Sumę liczymy z produkcji:
    // wpisana z ręki starzałaby się przy każdym dołożonym powitaniu.
    await greetingsReady();
    const expected = BUCKETS.reduce(
      (count, bucket) => count + DEFAULT_GREETINGS.pl[bucket].length,
      0,
    );
    const inputs = elements('input[placeholder^="np."]');
    expect(inputs.length).toBe(expected);
    expect(inputs[0]).toHaveValue(DEFAULT_GREETINGS.pl.night[0]);
    expect(requireButton("Zapisz").disabled).toBe(false);
  });

  it("odczytany łańcuch `select`/`eq`/`maybeSingle` pyta o WŁAŚCIWY klucz", async () => {
    await greetingsReady();
    const chain = h.db?.chainsFor("site_settings")[0];
    expect(chain?.argsOf("select")).toEqual(["value"]);
    expect(chain?.argsOf("eq")).toEqual(["key", GREETINGS_KEY]);
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  it.each([
    {
      label: "wartość obecna - słownik z bazy zastępuje domyślny",
      row: { value: singletonDict("Hej", "Hey") },
      expectFirstInput: "Hej night, {name}",
    },
    {
      label: "wiersz bez wartości (`value: null`) - wartości domyślne",
      row: { value: null },
      expectFirstInput: DEFAULT_GREETINGS.pl.night[0],
    },
    {
      label: "wartość obcego kształtu (nie obiekt) - wartości domyślne",
      row: { value: "to nie słownik" },
      expectFirstInput: DEFAULT_GREETINGS.pl.night[0],
    },
    {
      label: "tylko jeden język w bazie - drugi zostaje domyślny",
      row: { value: { pl: bucketMap(() => ["Tylko PL, {name}"]) } },
      expectFirstInput: "Tylko PL, {name}",
    },
    {
      label: "pora dnia NIE tablicą - ta jedna zostaje domyślna",
      row: { value: { pl: { night: "nie tablica" } } },
      expectFirstInput: DEFAULT_GREETINGS.pl.night[0],
    },
    {
      label: "elementy nie-łańcuchowe są ODSIEWANE",
      row: { value: { pl: { night: [42, "Ostatnie, {name}", null] } } },
      expectFirstInput: "Ostatnie, {name}",
    },
  ])("$label", async ({ row, expectFirstInput }) => {
    h.settingsRow = row;
    await greetingsReady();
    // STRAŻNIK, nie rzutowanie: `elements` oddaje `HTMLElement`, a wartość
    // pola czyta się dopiero z `HTMLInputElement`. Warunek sprawdza to
    // w RUNTIME i on zawęża typ - `as` przepuściłby też węzeł, który polem
    // nie jest, i test „przechodziłby” obok formularza.
    const first = elements('input[placeholder^="np."]')[0];
    if (!(first instanceof HTMLInputElement))
      throw new Error("test: pierwsze pole nie jest inputem");
    expect(first.value).toBe(expectFirstInput);
  });

  it("KLUCZE POZA ENUMEM w bazie są odrzucane i NIE wracają do zapisu", async () => {
    // Ręczna edycja jsonb albo starsza wersja aplikacji może dołożyć obcy
    // język i obcą porę dnia. Panel czyta wyłącznie znane klucze, więc zapis
    // NIE MOŻE odesłać nieznanych wartości z powrotem do bazy - inaczej
    // panel utrwala śmieci, których żaden czytelnik nie rozumie.
    h.settingsRow = {
      value: {
        pl: { ...bucketMap(() => ["Znane, {name}"]), teleport: ["Obce, {name}"] },
        de: bucketMap(() => ["Obcy język, {name}"]),
      },
    };
    await greetingsReady();
    fireEvent.click(requireButton("Zapisz"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const saved = savedRecord();
    expect(Object.keys(saved).sort()).toEqual(["en", "pl"]);
    const pl = saved.pl;
    if (pl === null || typeof pl !== "object") throw new Error("test: brak sekcji pl w zapisie");
    expect(Object.keys(pl).sort()).toEqual([...BUCKETS].sort());
  });
});

describe("admin.greetings - walidacja i blokada zapisu", () => {
  it("PUSTA pora dnia BLOKUJE zapis i oznacza język w zakładce", async () => {
    // Brak powitania w jakiejkolwiek porze dnia oznacza, że silnik nie ma
    // z czego wybierać w tym oknie czasowym. Dlatego zapis jest zablokowany
    // na poziomie panelu, a nie dopiero w bazie.
    //
    // Sekcja jest PUSTA, czyli bez ani jednego wpisu (`[]`). Wariant „jeden
    // wpis, ale sam z białych znaków” wygląda dla walidacji tak samo (bo ona
    // przycina i odsiewa), ale w formularzu jest oznaczony INACZEJ - to
    // osobny defekt, zgłoszony w ostatniej sekcji pliku.
    h.settingsRow = {
      value: {
        pl: { ...bucketMap(() => ["Jest, {name}"]), night: [] },
        en: bucketMap(() => ["Fine, {name}"]),
      },
    };
    await mountGreetings();
    await waitFor(() => expect(buttonWithText("Zapisz")).toBeTruthy());
    expect(requireButton("Zapisz").disabled).toBe(true);
    // Odznaka liczby braków stoi TYLKO przy języku, który ich ma.
    const plTrigger = requireElement('[data-tab-trigger="pl"]');
    const enTrigger = requireElement('[data-tab-trigger="en"]');
    expect(plTrigger.textContent).toContain("1");
    expect(enTrigger.textContent).not.toContain("1");
    // Sekcja bez wpisów jest oznaczona w formularzu, a nie tylko licznikiem.
    expect(textOf()).toContain("wymagane");
  });

  it("BRAK powitań po stronie EN znaczy ANGIELSKĄ zakładkę i sekcję", async () => {
    // Odznaka braków i znacznik sekcji mają OSOBNE napisy per język
    // (`emptyPerLang.en`, `l === "pl" ? "wymagane" : "required"`). Bez tego
    // testu żadna asercja nie dotyka angielskiego bliźniaka - a bramka
    // parytetu PL/EN go nie widzi, bo to literał w kodzie, nie klucz.
    h.settingsRow = {
      value: {
        pl: bucketMap(() => ["Jest, {name}"]),
        en: { ...bucketMap(() => ["Fine, {name}"]), night: [] },
      },
    };
    await mountGreetings();
    await waitFor(() => expect(buttonWithText("Zapisz")).toBeTruthy());
    // Brak jest po stronie EN, więc odznaka stoi TYLKO przy tej zakładce...
    expect(requireElement('[data-tab-trigger="en"]').textContent).toContain("1");
    expect(requireElement('[data-tab-trigger="pl"]').textContent).not.toContain("1");
    // ...a karta polska (aktywna) nie ma czego oznaczać.
    expect(textOf()).not.toContain("wymagane");
    expect(requireButton("Zapisz").disabled).toBe(true);
    fireEvent.click(requireElement('[data-tab-trigger="en"]'));
    await waitFor(() => expect(queryElement('[data-tab-content="en"]')).toBeTruthy());
    expect(textOf()).toContain("required");
  });

  it("brak `{name}` NIE blokuje zapisu, ale znaczy pole ostrzeżeniem", async () => {
    // Powitanie bez imienia jest legalne (silnik usuwa wołacz), więc to
    // OSTRZEŻENIE, nie błąd. Rozdzielenie ma znaczenie: zablokowany zapis
    // z powodu ostrzeżenia uwięziłby administratora na tym ekranie.
    h.settingsRow = {
      value: {
        pl: { ...bucketMap(() => ["Jest, {name}"]), night: ["Dzień dobry"] },
        en: bucketMap(() => ["Fine, {name}"]),
      },
    };
    await greetingsReady();
    expect(requireButton("Zapisz").disabled).toBe(false);
    const warned = elements('input[placeholder^="np."]').filter((input) =>
      input.className.includes("border-amber-500/60"),
    );
    expect(warned).toHaveLength(1);
  });

  it("OSTRZEŻENIE nie zatrzymuje ładunku: powitanie bez `{name}` jedzie do bazy", async () => {
    // Bramka zapisu liczy TYLKO braki (`reason === "empty"`), a ostrzeżenie
    // o brakującym `{name}` przez nią przechodzi. Bez tego testu predykat
    // filtra w `save()` nigdy się nie wykonuje (dla poprawnego słownika lista
    // uwag jest pusta, więc filtr nie woła go ani razu) - czyli reguła
    // „ostrzeżenie to nie błąd” nie jest sprawdzona tam, gdzie o niej
    // decyduje: przy budowaniu ładunku.
    h.settingsRow = {
      value: {
        pl: { ...bucketMap(() => ["Jest, {name}"]), night: ["Dzień dobry"] },
        en: bucketMap(() => ["Fine, {name}"]),
      },
    };
    await greetingsReady();
    await saveAndSettle("Zapisz");
    expect(h.toastSuccess).toHaveBeenCalledWith("admin.saved");
    expect(h.toastError).not.toHaveBeenCalled();
    const pl = savedRecord().pl;
    if (!isRecord(pl)) throw new Error("test: brak sekcji pl");
    expect(pl.night).toEqual(["Dzień dobry"]);
  });

  it("usunięcie OSTATNIEGO wpisu w sekcji domyka blokadę zapisu", async () => {
    // Obrona przed wyjściem z zakresu listy: panel pozwala usunąć każdy wpis,
    // także ostatni - i wtedy MUSI zablokować zapis, zamiast wysłać do bazy
    // porę dnia bez ani jednego powitania.
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    await greetingsReady();
    expect(requireButton("Zapisz").disabled).toBe(false);
    const remove = buttons().filter((button) => button.getAttribute("aria-label") === "Usuń");
    expect(remove).toHaveLength(BUCKETS.length);
    fireEvent.click(remove[0]);
    await waitFor(() => expect(requireButton("Zapisz").disabled).toBe(true));
    expect(elements('input[placeholder^="np."]')).toHaveLength(BUCKETS.length - 1);
  });
});

describe("admin.greetings - ładunek zapisu i operacje na liście", () => {
  it("zapis wysyła CAŁY słownik pod kluczem `greetings` z `onConflict`", async () => {
    // Klucz sekcji i klucz konfliktu są częścią umowy z bazą: zapis pod
    // cudzym kluczem nadpisałby konfigurację innego obszaru, a brak
    // `tenant_id` w `onConflict` scaliłby najemców.
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    await greetingsReady();
    fireEvent.click(requireButton("Zapisz"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("admin.saved"));
    expect(lastUpsert().key).toBe(GREETINGS_KEY);
    expect(lastUpsertOptions()).toEqual({ onConflict: "tenant_id,key" });
    expect(savedRecord().pl).toEqual(singletonDict("Hej", "Hey").pl);
  });

  it("pasek zapisu BLOKUJE się na czas zapisu", async () => {
    // Drugie kliknięcie „Zapisz” wysłałoby drugi `upsert` na tym samym
    // wierszu, oparty o stan sprzed pierwszego.
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    await greetingsReady();
    fireEvent.click(requireButton("Zapisz"));
    // Asercja SYNCHRONICZNA: `save()` ustawia `busy` przed pierwszym `await`,
    // a `fireEvent` przepłukuje aktualizacje stanu - to jest ten stan.
    const busy = requireButton("Zapisywanie…");
    expect(busy.disabled).toBe(true);
    await waitFor(() => expect(buttonWithText("Zapisz")).toBeTruthy());
  });

  it("odmowa bazy pokazuje komunikat błędu i NIE ogłasza sukcesu", async () => {
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    h.settingsSaveFail = { message: "not_authorized", code: "42501" };
    await greetingsReady();
    fireEvent.click(requireButton("Zapisz"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("not_authorized"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("„Dodaj powitanie” dokłada wzorzec Z placeholderem imienia", async () => {
    // DOKŁADA, czyli nie podmienia: przedmiotem dowodu jest to, że nowy wpis
    // staje OBOK istniejącego i niesie `{name}` (wzorzec bez placeholdera
    // zaraz po dodaniu zapalałby ostrzeżenie i wyglądał jak błąd panelu).
    // Drugi przycisk karty to „Usuń” pierwszego wpisu - kliknięcie go tutaj
    // (tak było w pierwszej wersji tego testu) mierzyłoby PODMIANĘ wpisu,
    // czyli coś innego, niż nazwa testu obiecuje.
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    await greetingsReady();
    const add = buttons().find((button) => button.textContent?.includes("Dodaj powitanie"));
    if (!add) throw new Error("test: brak przycisku dodawania");
    fireEvent.click(add);
    fireEvent.click(requireButton("Zapisz"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const pl = savedRecord().pl;
    if (pl === null || typeof pl !== "object") throw new Error("test: brak sekcji pl");
    expect(Object.values(pl)).toContainEqual(["Hej night, {name}", "Witaj, {name}"]);
  });

  it("„Domyślne” w sekcji przywraca TYLKO tę porę dnia", async () => {
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    await greetingsReady();
    const resetFirst = buttons().filter((button) => button.textContent?.includes("Domyślne"))[0];
    fireEvent.click(resetFirst);
    fireEvent.click(requireButton("Zapisz"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const pl = savedRecord().pl;
    if (pl === null || typeof pl !== "object") throw new Error("test: brak sekcji pl");
    const record: Record<string, unknown> = { ...pl };
    expect(record.night).toEqual(DEFAULT_GREETINGS.pl.night);
    expect(record.morning).toEqual(["Hej morning, {name}"]);
  });

  it("„Przywróć domyślne” czyści CAŁY słownik, oba języki", async () => {
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    await greetingsReady();
    fireEvent.click(requireButton("Przywróć domyślne"));
    fireEvent.click(requireButton("Zapisz"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(savedRecord()).toEqual(DEFAULT_GREETINGS);
  });

  it("BRAMKA POLA MARTWEGO: zmiana każdego pola zmienia ładunek zapisu", async () => {
    // Pole, którego zmiana nie dojeżdża do bazy, nie daje żadnego
    // komunikatu - administrator wpisuje powitanie, wychodzi i po powrocie
    // widzi stare. Jedno-elementowy słownik daje siedem pól: jedno na porę.
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    await greetingsReady();
    const dead: string[] = [];
    const total = elements('input[placeholder^="np."]').length;
    expect(total).toBe(BUCKETS.length);
    // Ładunek odniesienia: stan słownika PRZED jakąkolwiek edycją.
    await saveAndSettle("Zapisz");
    let before = JSON.stringify(lastUpsert().value);
    for (let index = 0; index < total; index += 1) {
      const input = elements('input[placeholder^="np."]')[index];
      fireEvent.change(input, { target: { value: `Zmiana ${index}, {name}` } });
      // Każdy zapis DOMYKAMY (patrz `saveAndSettle`): bez tego kolejna
      // iteracja trafia w przycisk w stanie „Zapisywanie…”.
      await saveAndSettle("Zapisz");
      const after = JSON.stringify(lastUpsert().value);
      if (after === before) dead.push(`pole #${index}`);
      before = after;
    }
    expect(dead, `pola bez wpływu na ładunek: ${dead.join(", ")}`).toEqual([]);
  });
});

describe("admin.greetings - język interfejsu i podgląd", () => {
  it("KONTROLA DODATNIA: podgląd PL wstawia imię w MIANOWNIKU", async () => {
    // Podgląd jest jedynym miejscem, w którym administrator widzi skutek
    // swojego wzorca. Jedno-elementowa pula czyni go deterministycznym.
    //
    // Ten test PRZYPINA STAN FAKTYCZNY: panel woła `pickGreeting` z
    // `entry: null`, więc heurystyka wołacza wchodzi w gałąź „płeć nieznana”
    // i oddaje imię bez odmiany - „Anna”, nie „Anno”. Że jest to sprzeczne
    // z instrukcją stojącą dwa akapity wyżej na tym samym ekranie, dowodzi
    // `it.fails` w ostatniej sekcji pliku (produkcja BEZ ZMIAN).
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    await greetingsReady();
    expect(textOf()).toContain("Hej night, Anna");
    expect(textOf()).toContain("Powitania");
    // Obietnica panelu, z którą powyższe się rozjeżdża.
    expect(textOf()).toContain("imię zawsze pojawia się w wołaczu (np. Anna → Anno");
  });

  it("interfejs EN: tytuł, przycisk i imię podglądu po angielsku", async () => {
    // `(i18n.language ?? "pl").startsWith("en")` - to prawe ramię decyduje
    // o CAŁYM panelu, bo trasa nie ma kluczy tłumaczeń.
    h.lang = "en-GB";
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    await mountGreetings();
    await waitFor(() => expect(buttonWithText("Save")).toBeTruthy());
    expect(textOf()).toContain("Greetings");
    expect(textOf()).toContain("Hey night, Alex");
    expect(requireButton("Reset to defaults")).toBeTruthy();
  });

  it("interfejs EN: pasek zapisu i banner blokady po ANGIELSKU", async () => {
    // Asercja na RÓŻNICY napisów PL/EN, bo ta trasa nie ma kluczy tłumaczeń:
    // „Saving…” i „Save blocked” to jedyne miejsca, w których widać angielskie
    // ramię paska zapisu i bannera blokady. Napis polski w tym samym stanie
    // ekranu jest jednocześnie sprawdzany jako NIEOBECNY - inaczej test
    // przechodziłby też dla panelu, który po angielsku pokazuje polski tekst.
    h.lang = "en";
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    await mountGreetings();
    await waitFor(() => expect(buttonWithText("Save")).toBeTruthy());
    fireEvent.click(requireButton("Save"));
    expect(requireButton("Saving…").disabled).toBe(true);
    await waitFor(() => expect(buttonWithText("Save")).toBeTruthy());
    // Blokada: usunięcie JEDYNEGO wpisu pory dnia zapala banner - po angielsku.
    const remove = buttons().filter((button) => button.getAttribute("aria-label") === "Remove");
    expect(remove).toHaveLength(BUCKETS.length);
    fireEvent.click(remove[0]);
    await waitFor(() => expect(requireButton("Save").disabled).toBe(true));
    expect(textOf()).toContain("Save blocked: fill in the missing greetings.");
    expect(textOf()).not.toContain("Zapis zablokowany");
    expect(textOf()).toContain("required");
  });

  it("BRAK języka w i18n (`undefined`) domyśla się polskiego", async () => {
    // Realna instancja i18next nie ma `language` przed inicjalizacją; to
    // prawe ramię `?? "pl"` decyduje, czy panel otworzy się po polsku, czy
    // wywali się na `undefined.startsWith`.
    h.lang = undefined;
    await greetingsReady();
    expect(textOf()).toContain("Powitania");
  });

  it("zakładka języka przełącza EDYTOWANE pola, nie tylko podgląd", async () => {
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    await greetingsReady();
    fireEvent.click(requireElement('[data-tab-trigger="en"]'));
    await waitFor(() => expect(queryElement('[data-tab-content="en"]')).toBeTruthy());
    const first = elements('input[placeholder^="e.g."]')[0];
    expect(first.getAttribute("value") ?? first.className).toContain("Hey night");
    // Dodanie wpisu w zakładce EN musi trafić do sekcji `en`, nie `pl`.
    const add = buttons().find((button) => button.textContent?.includes("Add greeting"));
    if (!add) throw new Error("test: brak przycisku dodawania w EN");
    fireEvent.click(add);
    fireEvent.click(requireButton("Zapisz"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const en = savedRecord().en;
    if (en === null || typeof en !== "object") throw new Error("test: brak sekcji en");
    expect(Object.values(en)).toContainEqual(["Hey night, {name}", "Welcome, {name}"]);
  });

  it("zamontowanie OBU kart nie renderuje pól nieaktywnego języka", async () => {
    // Panel ma DRUGĄ bramkę poza samą zakładką (`lang === l`). Radix bez
    // `forceMount` montuje tylko aktywną kartę, więc ta bramka jest
    // widoczna dopiero wtedy, gdy zamontujemy obie: nagłówki siedmiu sekcji
    // pojawiają się dwa razy, ale POLA - tylko dla języka wybranego.
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    h.tabsForceMount = true;
    await greetingsReady();
    expect(elements('[data-tab-content="en"]')).toHaveLength(1);
    expect(elements('input[placeholder^="e.g."]')).toHaveLength(0);
    expect(elements('input[placeholder^="np."]')).toHaveLength(BUCKETS.length);
    // Nagłówki angielskiej karty są, więc karta REALNIE się zamontowała.
    expect(textOf()).toContain("Late evening");
  });
});

// ---------------------------------------------------------------------------
// 3. `/admin/popups` - lista popupów, statystyki i mutacje.
// ---------------------------------------------------------------------------

describe("admin.popups - powłoka i stany listy", () => {
  it("adres POTOMNY oddaje ekran edytorowi (`Outlet`), nie renderuje listy", async () => {
    // Cała treść `PopupsLayout` to jedna decyzja: lista tylko dla dokładnego
    // `/admin/popups`. Bez niej edytor popupu renderowałby się POD listą.
    h.popupRows = [popupRow()];
    await renderRoute({
      route: PopupsRoute,
      path: "/admin/popups/$id",
      initialEntry: "/admin/popups/popup-1",
    });
    expect(elements("table")).toHaveLength(0);
    expect(textOf()).not.toContain("admin.popups.title");
  });

  it("odczyt W TOKU pokazuje wczytywanie, a nie pustą tabelę", async () => {
    h.hangTables.add("builder_popups");
    await mountPopups();
    await waitFor(() => expect(textOf()).toContain("admin.popups.loading"));
    expect(elements("table")).toHaveLength(0);
  });

  it("BRAK popupów pokazuje tabelę z samym popupem WBUDOWANYM", async () => {
    // Pusta lista to nie pusty ekran: wbudowany popup rejestracji istnieje
    // zawsze i musi być wybieralny z tej samej tabeli.
    await mountPopups();
    await waitFor(() => expect(elements("table")).toHaveLength(1));
    expect(elements("tbody tr")).toHaveLength(1);
    expect(textOf()).toContain("admin.popups.builtInName");
    expect(textOf()).toContain("admin.popups.builtInTag");
  });

  it("BRAK najemcy sesji nie wywala listy - zapytanie zostaje wyłączone", async () => {
    // `enabled: Boolean(tenantId)` w `usePopupsAdmin`: bez najemcy nie ma
    // czego pytać, ale panel musi się otworzyć (to ekran, z którego widać
    // konfigurację).
    h.tenantId = null;
    h.popupRows = [popupRow()];
    await mountPopups();
    await waitFor(() => expect(elements("table")).toHaveLength(1));
    expect(elements("tbody tr")).toHaveLength(1);
    expect(h.db?.chainsFor("builder_popups")).toHaveLength(0);
  });

  it("wiersz popupu pokazuje nazwę, datę zmiany i odnośnik do edytora", async () => {
    h.popupRows = [popupRow()];
    await popupsReady();
    const link = elements('a[href="/admin/popups/popup-1"]')[0];
    expect(link.textContent).toBe("Newsletter jesień");
    expect(textOf()).toContain(new Date(BASE_ISO).toLocaleDateString("pl-PL"));
  });

  it("data zmiany respektuje JĘZYK interfejsu", async () => {
    // `uiLocale(i18n.language ?? "pl")` - ta sama data w dwóch formatach.
    h.lang = "en";
    h.popupRows = [popupRow()];
    await popupsReady();
    expect(textOf()).toContain(new Date(BASE_ISO).toLocaleDateString("en-GB"));
  });

  it("BRAK języka w i18n (`undefined`) formatuje datę po polsku", async () => {
    // `uiLocale(i18n.language ?? "pl")` - prawe ramię `??`. Realna instancja
    // i18next nie ma `language` przed inicjalizacją, a `uiLocale(undefined)`
    // bez tego domysłu oddałoby datę w formacie hosta, nie interfejsu.
    h.lang = undefined;
    h.popupRows = [popupRow()];
    await popupsReady();
    expect(textOf()).toContain(new Date(BASE_ISO).toLocaleDateString("pl-PL"));
  });

  it("popup ZARCHIWIZOWANY nosi znacznik statusu i wyłączony przełącznik", async () => {
    h.popupRows = [popupRow({ status: "archived" })];
    await popupsReady();
    expect(textOf()).toContain("admin.popups.statusArchived");
    const rowSwitch = switches().at(-1);
    expect(rowSwitch?.checked).toBe(false);
  });

  it("STATUS POZA ENUMEM w bazie schodzi do szkicu i nie wraca do zapisu", async () => {
    // `toPopup` mapuje nieznany status na `draft`. Panel nie może pokazać
    // przełącznika w stanie nieokreślonym ani odesłać nieznanej wartości -
    // przestawienie wysyła `active`, nigdy `teleport`.
    h.popupRows = [popupRow({ status: "teleport" })];
    await popupsReady();
    expect(textOf()).not.toContain("admin.popups.statusArchived");
    const rowSwitch = switches().at(-1);
    if (!rowSwitch) throw new Error("test: brak przełącznika wiersza");
    expect(rowSwitch.checked).toBe(false);
    fireEvent.click(rowSwitch);
    await waitFor(() => expect(hasChainWith("builder_popups", "update")).toBe(true));
    expect(chainWith("builder_popups", "update").argsOf("update")).toEqual([{ status: "active" }]);
  });
});

describe("admin.popups - opis wyzwalacza", () => {
  it.each([
    {
      label: "natychmiast",
      settings: { trigger: "immediate" },
      expected: "admin.popups.list.triggerImmediate",
    },
    {
      label: "po opóźnieniu",
      settings: { trigger: "delay", delaySeconds: 12 },
      expected: "admin.popups.list.triggerDelay(count=12)",
    },
    {
      label: "po przewinięciu",
      settings: { trigger: "scroll", scrollPercent: 80 },
      expected: "admin.popups.list.triggerScroll(percent=80)",
    },
    {
      label: "na wyjściu",
      settings: { trigger: "exit-intent" },
      expected: "admin.popups.list.triggerExit",
    },
    {
      label: "WYZWALACZ POZA ENUMEM schodzi do opóźnienia (bez pustej komórki)",
      settings: { trigger: "teleport" },
      expected: "admin.popups.list.triggerDelay(count=5)",
    },
    {
      label: "opóźnienie ZERO sekund jest wartością prawidłową",
      settings: { trigger: "delay", delaySeconds: 0 },
      expected: "admin.popups.list.triggerDelay(count=0)",
    },
  ])("wyzwalacz: $label", async ({ settings, expected }) => {
    // `switch` bez gałęzi domyślnej zwróciłby `undefined` dla nieznanego
    // wyzwalacza - pusta komórka w kolumnie, po której administrator wybiera,
    // co i kiedy zobaczy czytelnik.
    h.popupRows = [popupRow({ settings })];
    await popupsReady();
    expect(textOf()).toContain(expected);
  });
});

describe("admin.popups - liczniki wyświetleń i konwersji", () => {
  it("liczniki z `popup_events` pytają o WŁAŚCIWY popup i rodzaj zdarzenia", async () => {
    h.popupRows = [popupRow()];
    h.stats["popup-1"] = { views: 200, conversions: 50 };
    await popupsReady();
    await waitFor(() => expect(textOf()).toContain("(25%)"));
    const chains = h.db?.chainsFor("popup_events") ?? [];
    expect(chains).toHaveLength(2);
    expect(chains[0].argsOf("select")).toEqual(["*", { count: "exact", head: true }]);
    expect(chains.map((chain) => chain.calls.filter((c) => c.method === "eq")[1]?.args)).toEqual([
      ["kind", "view"],
      ["kind", "conversion"],
    ]);
    expect(textOf()).toContain("200");
  });

  it("BRAK licznika w odpowiedzi czyta się jako zero, nie jako pustka", async () => {
    // `count ?? 0` - `null` z zapytania liczącego nie może wyświetlić się
    // jako puste miejsce w kolumnie, po której ocenia się skuteczność.
    h.popupRows = [popupRow()];
    h.stats["popup-1"] = { views: null, conversions: null };
    await popupsReady();
    const cells = elements("tbody tr:last-child td");
    expect(cells[3].textContent).toBe("0");
    expect(cells[4].textContent).toBe("0");
  });

  it("ZERO wyświetleń nie liczy procentu konwersji (bez dzielenia przez zero)", async () => {
    h.popupRows = [popupRow()];
    h.stats["popup-1"] = { views: 0, conversions: 3 };
    await popupsReady();
    await waitFor(() => expect(elements("tbody tr:last-child td")[4].textContent).toBe("3"));
    expect(textOf()).not.toContain("%)");
  });

  it("puste liczniki dwóch popupów nie mieszają się między wierszami", async () => {
    h.popupRows = [popupRow(), popupRow({ id: "popup-2", name: "Drugi" })];
    h.stats["popup-1"] = { views: 10, conversions: 1 };
    h.stats["popup-2"] = { views: 4, conversions: 2 };
    await popupsReady();
    await waitFor(() => expect(textOf()).toContain("(50%)"));
    expect(textOf()).toContain("(10%)");
    expect(h.db?.chainsFor("popup_events")).toHaveLength(4);
  });
});

describe("admin.popups - wbudowany popup rejestracji", () => {
  it.each([
    {
      label: "opóźnienie z bazy",
      row: { popup_trigger: "delay", popup_delay_seconds: 30 },
      expected: "admin.popups.list.triggerDelay(count=30)",
    },
    {
      label: "opóźnienie ZERO sekund (wartość fałszywa, ale prawidłowa)",
      row: { popup_trigger: "delay", popup_delay_seconds: 0 },
      expected: "admin.popups.list.triggerDelay(count=0)",
    },
    {
      label: "przewinięcie",
      row: { popup_trigger: "scroll", popup_scroll_percent: 75 },
      expected: "admin.popups.list.triggerScroll(percent=75)",
    },
    {
      label: "przewinięcie o ZERO procent",
      row: { popup_trigger: "scroll", popup_scroll_percent: 0 },
      expected: "admin.popups.list.triggerScroll(percent=0)",
    },
    {
      label: "przewinięcie BEZ procentu w bazie - domyślne 50%",
      row: { popup_trigger: "scroll", popup_scroll_percent: undefined },
      expected: "admin.popups.list.triggerScroll(percent=50)",
    },
    {
      label: "wyjście ze strony",
      row: { popup_trigger: "exit-intent" },
      expected: "admin.popups.list.triggerExit",
    },
    {
      label: "brak wyzwalacza w bazie - domyślne opóźnienie 15 s",
      row: { popup_trigger: undefined, popup_delay_seconds: undefined },
      expected: "admin.popups.list.triggerDelay(count=15)",
    },
  ])("wbudowany popup: $label", async ({ row, expected }) => {
    // `??` w każdym z tych odczytów ma OBA ramiona: `0` i `0%` to wartości
    // prawidłowe, których `||` zamieniłoby na 15 i 50 - i administrator nie
    // mógłby ustawić popupu natychmiastowego ani od samej góry strony.
    h.newsletter = newsletterRow(row);
    await mountPopups();
    await waitFor(() => expect(textOf()).toContain(expected));
  });

  it("BRAK wiersza newslettera wyłącza przełącznik zamiast zgadywać stan", async () => {
    // `disabled={!data}`: przełącznik bez danych pokazałby „wyłączony” i
    // pierwsze kliknięcie zapisałoby ten domysł do bazy.
    h.newsletter = undefined;
    await mountPopups();
    await waitFor(() => expect(switches().length).toBeGreaterThan(0));
    const builtIn = switches()[0];
    expect(builtIn.disabled).toBe(true);
    expect(builtIn.checked).toBe(false);
    // NIEOSIĄGALNA GAŁĄŹ (świadomie nie naciągana): `onCheckedChange` ma
    // wewnątrz `if (!data) return;`. Przy wyłączonym polu przeglądarka nie
    // wystawia zdarzenia zmiany, więc ten strażnik jest obroną „na pasy”,
    // nie ścieżką interfejsu.
  });

  it("przełącznik wbudowanego popupu wysyła CAŁY wiersz z podmienioną flagą", async () => {
    // `save.mutateAsync({ ...data, popup_enabled: on })` - ładunek musi
    // nieść resztę ustawień, inaczej zapis wyzerowałby treść popupu.
    h.newsletter = newsletterRow({ popup_enabled: false, popup_title_pl: "Zapisz się" });
    await mountPopups();
    await waitFor(() => expect(switches().length).toBeGreaterThan(0));
    fireEvent.click(switches()[0]);
    await waitFor(() => expect(h.newsletterSaves).toHaveLength(1));
    expect(h.newsletterSaves[0]).toEqual(
      newsletterRow({ popup_enabled: true, popup_title_pl: "Zapisz się" }),
    );
  });

  it("nazwa i ikona wbudowanego popupu PRZEWIJAJĄ do jego edytora", async () => {
    // Wbudowany popup nie ma własnej trasy - jego edytor stoi na tej samej
    // stronie, więc „edytuj” musi być przewinięciem do zakotwiczonej sekcji.
    await mountPopups();
    await waitFor(() => expect(textOf()).toContain("admin.popups.builtInName"));
    const name = buttonWithText("admin.popups.builtInName");
    if (!name) throw new Error("test: brak nazwy wbudowanego popupu");
    fireEvent.click(name);
    fireEvent.click(buttonWithTitle("admin.popups.list.edit"));
    expect(h.scrollTargets).toEqual(["signup-popup-editor", "signup-popup-editor"]);
    expect(h.props.SignupPopupContentSection).toBeTruthy();
  });
});

describe("admin.popups - mutacje i ich ładunki", () => {
  it("nowy popup: `insert` niesie nazwę, pusty dokument i autora", async () => {
    const queryClient = freshQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await popupsReadyWithRow(queryClient);
    fireEvent.click(requireButton("admin.popups.new"));
    const input = requireElement("#popup-new-name");
    fireEvent.change(input, { target: { value: "  Popup wiosenny  " } });
    fireEvent.click(requireButton("admin.popups.newDialog.submit"));
    await waitFor(() => expect(h.navigations).toHaveLength(1));

    const insert = h.db
      ?.chainsFor("builder_popups")
      .find((chain) => chain.has("insert"))
      ?.argsOf("insert")?.[0];
    if (insert === null || typeof insert !== "object") throw new Error("test: brak ładunku insert");
    const payload: Record<string, unknown> = { ...insert };
    // Spacje z pola obcinamy w panelu - nazwa z białymi znakami psuje
    // sortowanie listy i wygląda na duplikat.
    expect(payload.name).toBe("Popup wiosenny");
    expect(payload.created_by).toBe(SESSION_USER.id);
    expect(payload.builder_data).toEqual({ version: 1, sections: [] });
    // Przejście na edytor nowego popupu - bez niego administrator zostaje
    // na liście i nie wie, że coś powstało.
    expect(h.navigations[0]).toEqual({ to: "/admin/popups/$id", params: { id: "popup-nowy" } });
    expect(invalidate).toHaveBeenCalled();
  });

  it("nowy popup BEZ sesji zapisuje autora jako `null`, nie pusty łańcuch", async () => {
    h.sessionUser = null;
    await popupsReadyWithRow();
    fireEvent.click(requireButton("admin.popups.new"));
    fireEvent.change(requireElement("#popup-new-name"), { target: { value: "Bez sesji" } });
    fireEvent.click(requireButton("admin.popups.newDialog.submit"));
    await waitFor(() => expect(h.navigations).toHaveLength(1));
    const insert = h.db
      ?.chainsFor("builder_popups")
      .find((chain) => chain.has("insert"))
      ?.argsOf("insert")?.[0];
    if (!isRecord(insert)) throw new Error("test: brak ładunku insert");
    expect(insert.created_by).toBeNull();
  });

  it("ODMOWA bazy przy tworzeniu: komunikat, otwarte okno, cache NIETKNIĘTY", async () => {
    // Zamknięte okno po nieudanym zapisie kazałoby wpisywać nazwę od nowa,
    // a unieważnienie cache po odmowie wywołałoby ponowny odczyt listy,
    // który tylko potwierdziłby brak zmiany.
    h.popupInsertFails = true;
    const queryClient = freshQueryClient();
    await popupsReadyWithRow(queryClient);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(requireButton("admin.popups.new"));
    fireEvent.change(requireElement("#popup-new-name"), { target: { value: "Odmowa" } });
    fireEvent.click(requireButton("admin.popups.newDialog.submit"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("admin.popups.createError"));
    expect(h.navigations).toHaveLength(0);
    expect(requireElement('[data-testid="dialog"]').getAttribute("data-open")).toBe("true");
    expect(requireElement("#popup-new-name")).toHaveValue("Odmowa");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("okno tworzenia BLOKUJE pola i przycisk na czas zapisu", async () => {
    await popupsReadyWithRow();
    fireEvent.click(requireButton("admin.popups.new"));
    fireEvent.change(requireElement("#popup-new-name"), { target: { value: "W toku" } });
    fireEvent.click(requireButton("admin.popups.newDialog.submit"));
    // Asercja SYNCHRONICZNA - `creating` jest ustawione przed pierwszym
    // `await`, a drugie kliknięcie utworzyłoby drugi popup.
    expect(requireButton("common.creating").disabled).toBe(true);
    expect(requireElement("#popup-new-name")).toBeDisabled();
    // W trakcie zapisu okno nie daje się zamknąć „z zewnątrz”.
    fireEvent.click(requireElement('[data-testid="dialog-close-outside"]'));
    expect(requireElement('[data-testid="dialog"]').getAttribute("data-open")).toBe("true");
    await waitFor(() => expect(h.navigations).toHaveLength(1));
  });

  it("PUSTA nazwa nie tworzy niczego, choćby formularz wysłano klawiszem", async () => {
    // Przycisk jest wyłączony, ale Enter w polu WYSYŁA formularz - i to
    // wtedy działa `if (!name) return`.
    await popupsReadyWithRow();
    fireEvent.click(requireButton("admin.popups.new"));
    fireEvent.change(requireElement("#popup-new-name"), { target: { value: "   " } });
    expect(requireButton("admin.popups.newDialog.submit").disabled).toBe(true);
    const form = requireElement("form");
    fireEvent.submit(form);
    await waitFor(() => expect(document.body).toBeTruthy());
    expect(h.db?.chainsFor("builder_popups").some((chain) => chain.has("insert"))).toBe(false);
    expect(h.navigations).toHaveLength(0);
  });

  it("okno tworzenia da się zamknąć i przyciskiem, i „z zewnątrz”", async () => {
    await popupsReadyWithRow();
    fireEvent.click(requireButton("admin.popups.new"));
    expect(requireElement('[data-testid="dialog"]').getAttribute("data-open")).toBe("true");
    fireEvent.click(requireButton("common.cancel"));
    expect(requireElement('[data-testid="dialog"]').getAttribute("data-open")).toBe("false");
    fireEvent.click(requireElement('[data-testid="dialog-open-outside"]'));
    expect(requireElement('[data-testid="dialog"]').getAttribute("data-open")).toBe("true");
    fireEvent.click(requireElement('[data-testid="dialog-close-outside"]'));
    expect(requireElement('[data-testid="dialog"]').getAttribute("data-open")).toBe("false");
  });

  it("przełącznik statusu wysyła `active`/`draft` DO WŁAŚCIWEGO wiersza", async () => {
    h.popupRows = [popupRow({ status: "active" })];
    await popupsReady();
    const rowSwitch = switches().at(-1);
    if (!rowSwitch) throw new Error("test: brak przełącznika wiersza");
    expect(rowSwitch.checked).toBe(true);
    fireEvent.click(rowSwitch);
    await waitFor(() => expect(hasChainWith("builder_popups", "update")).toBe(true));
    const chain = chainWith("builder_popups", "update");
    expect(chain.argsOf("update")).toEqual([{ status: "draft" }]);
    expect(chain.argsOf("eq")).toEqual(["id", "popup-1"]);
  });

  it("duplikat kopiuje dokument i ustawienia pod nazwą z sufiksem", async () => {
    h.popupRows = [popupRow({ settings: { trigger: "scroll", scrollPercent: 80 } })];
    await popupsReady();
    fireEvent.click(buttonWithTitle("admin.popups.list.duplicate"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("admin.popups.duplicated"));
    const insert = h.db
      ?.chainsFor("builder_popups")
      .find((chain) => chain.has("insert"))
      ?.argsOf("insert")?.[0];
    if (insert === null || typeof insert !== "object") throw new Error("test: brak ładunku insert");
    const payload: Record<string, unknown> = { ...insert };
    expect(payload.name).toBe("Newsletter jesień (kopia)");
    // Ustawienia jadą PO PARSOWANIU - kopia nie może odziedziczyć śmieci.
    expect(payload.settings).toMatchObject({ trigger: "scroll", scrollPercent: 80 });
  });

  it("ODMOWA bazy przy duplikowaniu milczy zamiast ogłaszać sukces", async () => {
    h.popupRows = [popupRow()];
    h.popupInsertFails = true;
    await popupsReady();
    fireEvent.click(buttonWithTitle("admin.popups.list.duplicate"));
    await waitFor(() =>
      expect(h.db?.chainsFor("builder_popups").some((chain) => chain.has("insert"))).toBe(true),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("usunięcie WYMAGA potwierdzenia i dopiero ono kasuje wiersz", async () => {
    h.popupRows = [popupRow()];
    await popupsReady();
    fireEvent.click(buttonWithTitle("admin.popups.list.delete"));
    expect(requireElement('[data-testid="alert"]').getAttribute("data-open")).toBe("true");
    // Nazwa w treści potwierdzenia - bez niej administrator nie wie, co kasuje.
    expect(textOf()).toContain("admin.popups.deleteDialog.desc(name=Newsletter jesień)");
    expect(h.db?.chainsFor("builder_popups").some((chain) => chain.has("delete"))).toBe(false);

    fireEvent.click(requireElement('[data-testid="alert-confirm"]'));
    // Asercja SYNCHRONICZNA: `deleting` blokuje oba przyciski okna.
    expect(requireElement('[data-testid="alert-confirm"]')).toBeDisabled();
    expect(requireElement('[data-testid="alert-cancel"]')).toBeDisabled();
    // ...i nie da się go w tym czasie zamknąć „z zewnątrz”.
    fireEvent.click(requireElement('[data-testid="alert-close-outside"]'));
    expect(requireElement('[data-testid="alert"]').getAttribute("data-open")).toBe("true");

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("admin.popups.deleted"));
    const chain = h.db
      ?.chainsFor("builder_popups")
      .filter((entry) => entry.has("delete"))
      .at(-1);
    expect(chain?.argsOf("eq")).toEqual(["id", "popup-1"]);
    expect(requireElement('[data-testid="alert"]').getAttribute("data-open")).toBe("false");
  });

  it("potwierdzenie usunięcia da się ODWOŁAĆ, i tylko zamknięciem", async () => {
    // `onOpenChange` reaguje wyłącznie na zamknięcie (`!o`): zdarzenie
    // „otwórz” z zewnątrz nie może wyczyścić wskazanego popupu.
    h.popupRows = [popupRow()];
    await popupsReady();
    fireEvent.click(buttonWithTitle("admin.popups.list.delete"));
    fireEvent.click(requireElement('[data-testid="alert-open-outside"]'));
    expect(requireElement('[data-testid="alert"]').getAttribute("data-open")).toBe("true");
    fireEvent.click(requireElement('[data-testid="alert-close-outside"]'));
    expect(requireElement('[data-testid="alert"]').getAttribute("data-open")).toBe("false");
    expect(h.db?.chainsFor("builder_popups").some((chain) => chain.has("delete"))).toBe(false);
  });
});

/** Lista popupów z jednym wierszem - najczęstszy montaż testów mutacji. */
async function popupsReadyWithRow(queryClient?: QueryClient): Promise<Mounted> {
  h.popupRows = [popupRow()];
  return popupsReady(queryClient);
}

// ---------------------------------------------------------------------------
// 4. `/admin/audience` - lejek, aktywność i retencja kohortowa.
// ---------------------------------------------------------------------------

describe("admin.audience - lejek członka", () => {
  it("rejestruje własny słownik i pyta RPC o okno 30 dni", async () => {
    // Słownik audytorium jest rejestrowany w chunku KOMPONENTU trasy - bez
    // tego wywołania cały pulpit renderuje surowe klucze.
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.funnel.membersTotal"));
    expect(h.ensureAudienceI18n).toBeGreaterThan(0);
    expect(h.rpcCalls).toEqual(
      expect.arrayContaining([
        { name: "admin_member_funnel", args: { p_days: 30 } },
        { name: "admin_member_activity_series", args: { p_days: 30 } },
        { name: "admin_member_retention", args: { p_weeks: 8 } },
      ]),
    );
  });

  it("lejek pokazuje CZTERY kroki z wartościami i przyrostem w oknie", async () => {
    setRpc("admin_member_funnel", ok([funnelRow()]));
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.funnel.membersTotal"));
    const text = textOf();
    expect(text).toContain("120");
    expect(text).toContain("adminAudience.funnel.newInWindow(count=8)");
    expect(text).toContain("adminAudience.funnel.discoverable");
    expect(text).toContain("adminAudience.funnel.paying");
    expect(text).toContain("adminAudience.activity.readers");
    expect(text).toContain("adminAudience.funnel.newsletter");
    // Szerokość paska to udział w największym kroku - najdłuższy ma 100%.
    const bars = elements("[style*='width']");
    expect(bars.map((bar) => bar.style.width)).toContain("100%");
  });

  it("krok o wartości ZERO ma pasek minimalny, a nie zerowy", async () => {
    // `Math.max(2, ...)`: pasek o zerowej szerokości byłby nieodróżnialny od
    // braku wiersza, a zero członków płacących jest normalnym stanem.
    setRpc("admin_member_funnel", ok([funnelRow({ paying_members: 0, members_total: 200 })]));
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.funnel.paying"));
    expect(elements("[style*='width']").map((bar) => bar.style.width)).toContain("2%");
  });

  it.each([
    { label: "puste wiersze RPC", result: ok([]) },
    { label: "`null` zamiast wierszy", result: ok(null) },
  ])("lejek BEZ danych ($label) renderuje pulpit bez kroków", async ({ result }) => {
    // `((data ?? [])[0] ?? null)` - oba ramiona. Pulpit musi się otworzyć:
    // to z niego widać, że najemca nie ma jeszcze ani jednego członka.
    setRpc("admin_member_funnel", result);
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.funnel.title"));
    expect(textOf()).not.toContain("adminAudience.funnel.membersTotal");
    expect(textOf()).not.toContain("adminAudience.funnel.error");
  });

  it("odczyt lejka W TOKU pokazuje OSIEM szkieletów, nie zer", async () => {
    // Zera w lejku to twierdzenie o audytorium. Szkielet mówi „jeszcze nie
    // wiem” - i to jest różnica między raportem a domysłem.
    h.hangRpc.add("admin_member_funnel");
    await mountAudience();
    await waitFor(() => expect(elements(".animate-pulse").length).toBeGreaterThan(0));
    expect(elements(".animate-pulse")).toHaveLength(8);
    expect(textOf()).not.toContain("adminAudience.funnel.membersTotal");
  });

  it("AWARIA odczytu lejka to WŁASNY komunikat, nie pulpit z zerami", async () => {
    // Rozdzielenie stanu pustego od błędu: „brak członków” i „nie wiemy, bo
    // odczyt padł” prowadzą do dwóch różnych decyzji operatora.
    setRpc("admin_member_funnel", fail("not_authorized", "42501"));
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.funnel.error"));
    expect(textOf()).not.toContain("adminAudience.funnel.title");
    expect(textOf()).not.toContain("adminAudience.activity.inWindow");
  });

  it.each([7, 30, 90] as const)("okno %s dni przestawia OBA zapytania okna", async (days) => {
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.funnel.membersTotal"));
    const button = requireButton(`${days} adminAudience.days`);
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        h.rpcCalls.filter((call) => call.name === "admin_member_funnel").at(-1)?.args.p_days,
      ).toBe(days),
    );
    // Retencja NIE zależy od okna - jej zapytanie nie może się powtarzać
    // przy każdym przestawieniu (osiem tygodni to osiem tygodni).
    expect(h.rpcCalls.filter((call) => call.name === "admin_member_retention")).toHaveLength(1);
    expect(
      h.rpcCalls.filter((call) => call.name === "admin_member_activity_series").at(-1)?.args.p_days,
    ).toBe(days);
    // Zaznaczone jest DOKŁADNIE jedno okno.
    const active = buttons().filter(
      (candidate) =>
        candidate.textContent?.includes("adminAudience.days") &&
        candidate.className.includes("bg-primary"),
    );
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain(String(days));
  });
});

describe("admin.audience - wykres aktywności", () => {
  it("seria z bazy trafia do wykresu jako kategorie i DWIE serie", async () => {
    const series: SeriesShape[] = [
      { day: "2026-01-13", active_members: 10, new_members: 2 },
      { day: "2026-01-14", active_members: 0, new_members: 0 },
    ];
    setRpc("admin_member_activity_series", ok(series));
    await mountAudience();
    await waitFor(() => expect(h.props.Chart).toBeTruthy());
    const config = h.props.Chart.config;
    if (config === null || typeof config !== "object") throw new Error("test: brak konfiguracji");
    const record: Record<string, unknown> = { ...config };
    expect(record.kind).toBe("line");
    expect(record.categories).toHaveLength(2);
    // Zero aktywnych to prawidłowy punkt serii - nie wolno go pominąć.
    expect(JSON.stringify(record.series)).toContain("[10,0]");
    expect(JSON.stringify(record.series)).toContain("[2,0]");
    expect(h.props.Chart.lang).toBe("pl");
  });

  it("kategorie wykresu i kohorty respektują JĘZYK interfejsu", async () => {
    h.lang = "en";
    setRpc(
      "admin_member_activity_series",
      ok([{ day: "2026-01-13", active_members: 1, new_members: 1 }]),
    );
    await mountAudience();
    await waitFor(() => expect(h.props.Chart).toBeTruthy());
    expect(h.props.Chart.lang).toBe("en");
    expect(JSON.stringify(h.props.Chart.config)).toContain(
      new Date("2026-01-13").toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    );
  });

  it("PUSTA seria pokazuje komunikat pustki, a nie wykres bez punktów", async () => {
    setRpc("admin_member_activity_series", ok([]));
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.activity.empty"));
    expect(h.props.Chart).toBeUndefined();
  });

  it("RPC bez błędu i bez wierszy (`null`) to PUSTKA, nie awaria", async () => {
    // `(data as ... ) ?? []` w obu zapytaniach okna (seria i retencja).
    // Funkcja SETOF w Postgresie potrafi oddać `null` zamiast pustej tablicy,
    // a wtedy `.map` po `null` wywaliłby cały pulpit - z lejkiem, który
    // policzył się poprawnie.
    setRpc("admin_member_activity_series", ok(null));
    setRpc("admin_member_retention", ok(null));
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.activity.empty"));
    await waitFor(() => expect(textOf()).toContain("adminAudience.retention.empty"));
    expect(textOf()).toContain("adminAudience.funnel.title");
    expect(elements("table")).toHaveLength(0);
  });

  it("odczyt serii W TOKU pokazuje szkielet wykresu", async () => {
    h.hangRpc.add("admin_member_activity_series");
    await mountAudience();
    await waitFor(() => expect(elements(".animate-pulse").length).toBeGreaterThan(0));
    expect(textOf()).not.toContain("adminAudience.activity.empty");
    expect(h.props.Chart).toBeUndefined();
  });
});

describe("admin.audience - retencja kohortowa", () => {
  const cohorts: RetentionShape[] = [
    { cohort_start: "2026-01-05", cohort_size: 10, week_offset: 0, active_members: 10 },
    { cohort_start: "2026-01-05", cohort_size: 10, week_offset: 1, active_members: 7 },
    { cohort_start: "2026-01-05", cohort_size: 10, week_offset: 2, active_members: 4 },
    { cohort_start: "2025-12-29", cohort_size: 4, week_offset: 0, active_members: 0 },
  ];

  it("kohorty scalają się w wiersze i idą od NAJNOWSZEJ", async () => {
    // Wiersz = tydzień rejestracji, kolumny = tygodnie po niej. Kolejność
    // malejąca jest tu regułą czytania: najnowszą kohortę widać bez
    // przewijania, a to o niej podejmuje się decyzje.
    setRpc("admin_member_retention", ok(cohorts));
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.retention.cohort"));
    const rows = elements("tbody tr");
    expect(rows).toHaveLength(2);
    const locale = "pl-PL";
    const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
    expect(rows[0].textContent).toContain(
      new Date("2026-01-05").toLocaleDateString(locale, options),
    );
    expect(rows[1].textContent).toContain(
      new Date("2025-12-29").toLocaleDateString(locale, options),
    );
    // Nagłówki kolumn wynikają z NAJWIĘKSZEGO przesunięcia w danych.
    expect(elements("thead th").map((th) => th.textContent)).toEqual([
      "adminAudience.retention.cohort",
      "adminAudience.retention.size",
      "T0",
      "T1",
      "T2",
    ]);
    expect(rows[0].textContent).toContain("10");
  });

  it("kolejność wierszy NIE zależy od kolejności z RPC", async () => {
    // Komparator kohort (`a < b ? 1 : -1`) musi działać w OBIE strony: gdy
    // RPC oddaje kohorty od NAJSTARSZEJ, panel nadal stawia najnowszą na
    // górze. Bez tego testu ramię „przestaw” nigdy się nie wykonuje, a
    // odwrócona kolejność w odpowiedzi bazy przewróciłaby czytanie tabeli.
    setRpc("admin_member_retention", ok([...cohorts].reverse()));
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.retention.cohort"));
    const rows = elements("tbody tr");
    expect(rows).toHaveLength(2);
    const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
    expect(rows[0].textContent).toContain(
      new Date("2026-01-05").toLocaleDateString("pl-PL", options),
    );
    expect(rows[1].textContent).toContain(
      new Date("2025-12-29").toLocaleDateString("pl-PL", options),
    );
  });

  it.each([
    {
      label: "retencja wysoka (>= 60%)",
      active: 8,
      size: 10,
      cls: "bg-emerald-500/30",
      pct: "80%",
    },
    {
      label: "retencja średnia (>= 30%)",
      active: 4,
      size: 10,
      cls: "bg-emerald-500/15",
      pct: "40%",
    },
    { label: "retencja niska (> 0%)", active: 1, size: 10, cls: "bg-muted", pct: "10%" },
    { label: "retencja ZEROWA", active: 0, size: 10, cls: "bg-transparent", pct: "0%" },
  ])("intensywność tła: $label", async ({ active, size, cls, pct }) => {
    // Cztery progi to CAŁA skala odczytu tej tabeli. Zero procent musi być
    // widoczne jako zero, a nie jako brak danych - to dwie różne informacje.
    setRpc(
      "admin_member_retention",
      ok([
        { cohort_start: "2026-01-05", cohort_size: size, week_offset: 0, active_members: active },
      ]),
    );
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain(pct));
    const cell = elements("tbody td span")[0];
    expect(cell.className).toContain(cls);
    expect(cell.getAttribute("title")).toBe(`${active}/${size}`);
  });

  it("BRAK tygodnia w kohorcie to kropka, nie zero procent", async () => {
    // Kohorta zarejestrowana tydzień temu nie ma jeszcze tygodnia drugiego.
    // „0%” powiedziałoby, że wszyscy odpadli.
    setRpc("admin_member_retention", ok(cohorts));
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.retention.cohort"));
    const lastRow = elements("tbody tr")[1];
    expect(lastRow.textContent).toContain("·");
  });

  it("kohorta o LICZEBNOŚCI ZERO nie dzieli przez zero", async () => {
    // Wiersz z zerową kohortą jest możliwy (usunięte konta), a `active/0`
    // dałoby `Infinity%` na ekranie raportu.
    setRpc(
      "admin_member_retention",
      ok([{ cohort_start: "2026-01-05", cohort_size: 0, week_offset: 0, active_members: 0 }]),
    );
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.retention.cohort"));
    expect(textOf()).toContain("·");
    expect(textOf()).not.toContain("Infinity");
    expect(textOf()).not.toContain("NaN");
  });

  it("PUSTA retencja pokazuje komunikat pustki", async () => {
    setRpc("admin_member_retention", ok([]));
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.retention.empty"));
    expect(elements("table")).toHaveLength(0);
  });

  it("odczyt retencji W TOKU pokazuje szkielet tabeli", async () => {
    h.hangRpc.add("admin_member_retention");
    await mountAudience();
    await waitFor(() => expect(elements(".animate-pulse").length).toBeGreaterThan(0));
    expect(textOf()).not.toContain("adminAudience.retention.empty");
  });
});

// ---------------------------------------------------------------------------
// 5. `/admin/personalized` - reguły kierowania treści personalizowanej.
// ---------------------------------------------------------------------------

describe("admin.personalized - odczyt ustawień", () => {
  it("odczyt W TOKU pokazuje wczytywanie w powłoce panelu", async () => {
    h.hangTables.add("site_settings");
    await mountPersonalized();
    expect(textOf()).toContain("admin.loading");
    expect(buttonWithText("admin.save")).toBeUndefined();
    // Powłoka panelu jest bez nawigacji - ta trasa stoi poza layoutem `/admin`.
    expect(h.props.AdminShell.hideSidebar).toBe(true);
  });

  it("BRAK wiersza otwiera panel na wartościach domyślnych z produkcji", async () => {
    await personalizedReady();
    const chain = h.db?.chainsFor("site_settings")[0];
    expect(chain?.argsOf("eq")).toEqual(["key", PERSONALIZED_SETTINGS_KEY]);
    const numberInputs = elements('input[type="number"]');
    expect(numberInputs[0]).toHaveValue(DEFAULT_PERSONALIZED_SETTINGS.guestExpirationDays);
    expect(switches()[0].checked).toBe(DEFAULT_PERSONALIZED_SETTINGS.enabled);
  });

  it.each([
    {
      label: "wartości z bazy zastępują domyślne",
      value: { enabled: false, allowGuests: true, restrictedTitle: "Zapisz się" },
      check: () => {
        expect(switches()[0].checked).toBe(false);
        expect(switches()[1].checked).toBe(true);
        expect(textInputs()[0]).toHaveValue("Zapisz się");
      },
    },
    {
      label: "ZERO dni wygasania zapisów gościa (wartość fałszywa, prawidłowa)",
      value: { guestExpirationDays: 0 },
      check: () => {
        // `0` oznacza „bez wygasania” - `||` zamieniłoby je na 14 i zapisy
        // gościa cicho przepadałyby po dwóch tygodniach.
        expect(elements('input[type="number"]')[0]).toHaveValue(0);
      },
    },
    {
      label: "PUSTY tytuł ekranu dla niezalogowanych zostaje pusty",
      value: { restrictedTitle: "" },
      check: () => {
        expect(textInputs()[0]).toHaveValue("");
      },
    },
    {
      label: "wartość `null` w kolumnie - wartości domyślne",
      value: null,
      check: () => {
        expect(elements('input[type="number"]')[0]).toHaveValue(
          DEFAULT_PERSONALIZED_SETTINGS.guestExpirationDays,
        );
      },
    },
  ])("$label", async ({ value, check }) => {
    h.settingsRow = { value };
    await personalizedReady();
    check();
  });

  it("panel z bazy zachowuje ustawienia obserwowania w nagłówkach", async () => {
    // Trzy przełączniki decydują, GDZIE czytelnik może zacząć obserwować -
    // to reguła kierowania treści, nie kosmetyka.
    h.settingsRow = {
      value: {
        followInCategoryHeader: false,
        followInTagHeader: true,
        followInAuthorHeader: false,
      },
    };
    await personalizedReady();
    const follow = switches().slice(3, 6);
    expect(follow.map((input) => input.checked)).toEqual([false, true, false]);
  });
});

describe("admin.personalized - zapis", () => {
  it("zapis wysyła CAŁE ustawienia pod właściwym kluczem i `onConflict`", async () => {
    await personalizedReady();
    fireEvent.click(requireButton("admin.save"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("admin.saved"));
    expect(lastUpsert().key).toBe(PERSONALIZED_SETTINGS_KEY);
    expect(lastUpsertOptions()).toEqual({ onConflict: "tenant_id,key" });
    expect(lastUpsert().value).toEqual(DEFAULT_PERSONALIZED_SETTINGS);
  });

  it("pasek zapisu BLOKUJE się na czas zapisu", async () => {
    await personalizedReady();
    fireEvent.click(requireButton("admin.save"));
    const busy = requireButton("admin.saving");
    expect(busy.disabled).toBe(true);
    await waitFor(() => expect(buttonWithText("admin.save")).toBeTruthy());
  });

  it("odmowa bazy pokazuje komunikat błędu i NIE ogłasza sukcesu", async () => {
    h.settingsSaveFail = { message: "new row violates row-level security policy", code: "42501" };
    await personalizedReady();
    fireEvent.click(requireButton("admin.save"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("admin.personalized - sekcje personalizacji", () => {
  it.each([
    { key: "saved", extra: false },
    { key: "followed", extra: false },
    { key: "recommended", extra: true },
  ] as const)(
    "sekcja $key: nagłówek, opis i kolumny jadą do WŁASNEJ sekcji",
    async ({ key, extra }) => {
      await personalizedReady();
      fireEvent.click(requireElement(`[data-tab-trigger="${key}"]`));
      await waitFor(() => expect(queryElement(`[data-tab-content="${key}"]`)).toBeTruthy());

      fireEvent.change(textInputs()[0], { target: { value: `Nagłówek ${key}` } });
      fireEvent.change(requireElement("textarea"), { target: { value: `Opis ${key}` } });
      fireEvent.change(elements('input[type="number"]')[0], { target: { value: "4" } });
      fireEvent.click(switches()[0]);
      fireEvent.click(requireButton("admin.save"));
      await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());

      const sections = savedRecord().sections;
      if (sections === null || typeof sections !== "object") throw new Error("test: brak sekcji");
      const bag: Record<string, unknown> = { ...sections };
      expect(bag[key]).toMatchObject({
        heading: `Nagłówek ${key}`,
        description: `Opis ${key}`,
        columns: 4,
        enabled: false,
      });
      // Pozostałe sekcje nietknięte - to jedna z trzech niezależnych reguł.
      const untouched = (["saved", "followed", "recommended"] as const).filter((k) => k !== key);
      for (const other of untouched) {
        expect(bag[other]).toEqual(DEFAULT_PERSONALIZED_SETTINGS.sections[other]);
      }
      // Liczba pozycji na stronę istnieje TYLKO w sekcji rekomendacji: pozostałe
      // dwie renderują listę czytelnika w całości.
      expect(elements('input[type="number"]')).toHaveLength(extra ? 2 : 1);
    },
  );

  it("liczba rekomendacji: BRAK wartości domyśla się dziewięciu", async () => {
    // `postsPerPage ?? 9` - sekcja zapisana starszą wersją panelu nie ma tego
    // pola, a puste pole liczbowe zapisałoby zero rekomendacji.
    h.settingsRow = {
      value: {
        sections: {
          ...DEFAULT_PERSONALIZED_SETTINGS.sections,
          recommended: { enabled: true, heading: "R", description: "D", columns: 3 },
        },
      },
    };
    await personalizedReady();
    fireEvent.click(requireElement('[data-tab-trigger="recommended"]'));
    await waitFor(() => expect(elements('input[type="number"]')).toHaveLength(2));
    expect(elements('input[type="number"]')[1]).toHaveValue(9);
  });

  it("liczba rekomendacji ZERO jest wartością prawidłową, nie brakiem", async () => {
    h.settingsRow = {
      value: {
        sections: {
          ...DEFAULT_PERSONALIZED_SETTINGS.sections,
          recommended: {
            ...DEFAULT_PERSONALIZED_SETTINGS.sections.recommended,
            postsPerPage: 0,
          },
        },
      },
    };
    await personalizedReady();
    fireEvent.click(requireElement('[data-tab-trigger="recommended"]'));
    await waitFor(() => expect(elements('input[type="number"]')).toHaveLength(2));
    expect(elements('input[type="number"]')[1]).toHaveValue(0);
  });

  it("zmiana liczby rekomendacji jedzie do zapisu jako LICZBA", async () => {
    await personalizedReady();
    fireEvent.click(requireElement('[data-tab-trigger="recommended"]'));
    await waitFor(() => expect(elements('input[type="number"]')).toHaveLength(2));
    fireEvent.change(elements('input[type="number"]')[1], { target: { value: "12" } });
    fireEvent.click(requireButton("admin.save"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const sections = savedRecord().sections;
    if (!isRecord(sections)) throw new Error("test: brak sekcji");
    expect(sections.recommended).toMatchObject({ postsPerPage: 12 });
  });
});

describe("admin.personalized - podpowiedzi i język interfejsu", () => {
  it.each([
    { lang: "pl", fragment: "0 = bez wygasania" },
    { lang: "en", fragment: "0 = never expire" },
    { lang: undefined, fragment: "0 = bez wygasania" },
  ])("język $lang: podpowiedź wygasania po właściwej stronie", async ({ lang, fragment }) => {
    // Podpowiedzi tej trasy są bliźniakami w kodzie (nie w słowniku), więc
    // asercja musi dotknąć literału - patrz uwaga w nagłówku pliku.
    h.lang = lang;
    await personalizedReady();
    expect(textOf()).toContain(fragment);
  });

  it("wiersz BEZ podpowiedzi nie renderuje pustego akapitu", async () => {
    // `hint && <p>` - oba ramiona. Przełączniki obserwowania podpowiedzi nie
    // mają, a pusty akapit rozjeżdżałby siatkę wiersza.
    await personalizedReady();
    const hints = elements("p.text-xs");
    expect(hints.length).toBeGreaterThan(0);
    for (const hint of hints) expect(hint.textContent?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("admin.personalized - żadne pole panelu nie jest martwe", () => {
  it("zmiana KAŻDEJ kontrolki karty ogólnej zmienia ładunek zapisu", async () => {
    // Ustawienie, które nie dojeżdża do bazy, nie daje żadnego komunikatu -
    // jest tylko opcją, która „nie działa”. Karta ogólna decyduje o tym, czy
    // personalizacja w ogóle działa i dla kogo, więc martwe pole tutaj to
    // reguła kierowania treści, której nie da się ustawić.
    await personalizedReady();
    const controls = () =>
      elements('[data-tab-content="global"] input, [data-tab-content="global"] textarea');
    const total = controls().length;
    expect(total).toBeGreaterThan(0);

    const dead: string[] = [];
    // Ładunek odniesienia: ustawienia PRZED jakąkolwiek edycją.
    await saveAndSettle("admin.save");
    let before = JSON.stringify(lastUpsert().value);
    for (let index = 0; index < total; index += 1) {
      const control = controls()[index];
      changeControl(control, index);
      // Zapis DOMKNIĘTY (patrz `saveAndSettle`) - inaczej kolejna iteracja
      // trafia w przycisk z etykietą `admin.saving`, a nie w „Zapisz”.
      await saveAndSettle("admin.save");
      const after = JSON.stringify(lastUpsert().value);
      if (after === before) dead.push(describeControl(control, index));
      before = after;
    }
    expect(dead, `pola bez wpływu na ładunek: ${dead.join(" | ")}`).toEqual([]);
  });
});

/** Zmienia kontrolkę na wartość RÓŻNĄ od bieżącej. */
function changeControl(element: HTMLElement, index: number): void {
  if (element instanceof HTMLTextAreaElement) {
    fireEvent.change(element, { target: { value: `${element.value}-zmiana${index}` } });
    return;
  }
  if (!(element instanceof HTMLInputElement)) return;
  if (element.type === "checkbox") {
    fireEvent.click(element);
    return;
  }
  if (element.type === "number") {
    fireEvent.change(element, { target: { value: String(Number(element.value) + 1) } });
    return;
  }
  fireEvent.change(element, { target: { value: `${element.value}-zmiana${index}` } });
}

/** Czytelny opis kontrolki do komunikatu błędu. */
function describeControl(element: HTMLElement, index: number): string {
  const type = element.getAttribute("type") ?? element.tagName.toLowerCase();
  const label = element.closest("div")?.querySelector("label")?.textContent ?? "";
  return `#${index} ${type}${label ? ` (${label})` : ""}`;
}

// ---------------------------------------------------------------------------
// 6. DEFEKTY - produkcja BEZ ZMIAN, zgłoszone `it.fails` (konwencja repo).
// ---------------------------------------------------------------------------

describe("cztery trasy panelu - defekty zgłoszone, nie naprawione", () => {
  it.fails("DEFEKT: awaria odczytu powitań wygląda jak słownik domyślny", async () => {
    // `admin.greetings.tsx` (linie 73-95) czyta z odpowiedzi WYŁĄCZNIE `data`
    // (`.then(({ data }) => ...)`). Pole `error` nie ma żadnego wyjścia na
    // ekran: przy odmowie RLS albo awarii sieci `data` jest `null`, więc
    // panel ustawia `loaded = true` i renderuje CAŁY słownik domyślny -
    // wizualnie identycznie jak dla najemcy, który nigdy powitań nie zmieniał.
    //
    // KONSEKWENCJA: to nie jest tylko mylący ekran. Administrator widzi
    // „swoje” powitania, poprawia jedno zdanie i klika „Zapisz” - a wtedy
    // `upsert` NADPISUJE realny słownik najemcy zestawem domyślnym. Awaria
    // odczytu zamienia się w trwałą utratę konfiguracji, bez ani jednego
    // komunikatu. To ta sama klasa defektu, która w tym repo wystąpiła już
    // trzy razy (patrz nagłówek `adminUsersRoutes.test.tsx`), tylko tutaj
    // jest ODWRACALNA W ZŁĄ STRONĘ: panel nie tylko kłamie, ale i utrwala.
    h.settingsReadFails = true;
    await mountGreetings();
    await waitFor(() => expect(buttonWithText("Zapisz")).toBeTruthy());
    expect(textOf()).toContain("Nie udało się");
  });

  it("KONTROLA DODATNIA: po awarii odczytu powitań zapis wysyła słownik DOMYŚLNY", async () => {
    // Stan FAKTYCZNY, przypięty razem ze skutkiem: panel otwiera się bez
    // jednego słowa o błędzie, a pierwszy „Zapisz” utrwala domyślne powitania
    // w miejsce słownika najemcy.
    h.settingsReadFails = true;
    await mountGreetings();
    await waitFor(() => expect(buttonWithText("Zapisz")).toBeTruthy());
    expect(h.toastError).not.toHaveBeenCalled();
    expect(requireButton("Zapisz").disabled).toBe(false);
    await saveAndSettle("Zapisz");
    expect(savedRecord()).toEqual(DEFAULT_GREETINGS);
  });

  it.fails("DEFEKT: podgląd powitań NIE odmienia imienia, choć panel to obiecuje", async () => {
    // `admin.greetings.tsx` (linie 151-177) buduje podgląd wołaniem
    // `pickGreeting({ ..., firstName: "Anna", entry: null })`. W silniku
    // (`src/lib/greetings/greetings.ts`, linie 259-261) `entry: null` oznacza
    // brak wpisu w słowniku imion, więc wołacz liczy `fallbackVocativePL`
    // z płcią `null` - a ta gałąź (linia 203) oddaje imię BEZ ODMIANY.
    // Podgląd pokazuje więc „Hej night, Anna”.
    //
    // Dwa akapity wyżej NA TYM SAMYM EKRANIE panel pisze wprost: „W języku
    // polskim imię zawsze pojawia się w wołaczu (np. Anna → Anno...)”
    // (linia 229). Podgląd jest jedynym miejscem, w którym administrator
    // sprawdza skutek swojego wzorca - i to on tej obietnicy przeczy.
    //
    // KONSEKWENCJA: administrator widzi „Anna” tam, gdzie instrukcja obiecuje
    // „Anno”, więc wnioskuje, że odmiana nie działa, i „naprawia” to wpisując
    // wołacz WPROST do wzorca („Hej, Anno” zamiast „Hej, {name}”). Wzorzec
    // trafia do bazy i od tej pory KAŻDY czytelnik jest witany imieniem Anna.
    // Defekt jest w danych podglądu, nie w silniku (silnik dla realnego
    // czytelnika ma `entry` ze słownika imion), więc naprawa to osobna praca:
    // podgląd musi podać `entry` z płcią (albo panel - przestać obiecywać
    // odmianę dla imienia, którego w słowniku nie ma).
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    await greetingsReady();
    expect(textOf()).toContain("Hej night, Anno");
  });

  it.fails("DEFEKT: pora dnia z samych białych znaków blokuje zapis BEZ wskazania", async () => {
    // `admin.greetings.tsx` ma DWIE różne miary pustej sekcji.
    // `validateDict` (linie 47-62) przycina wpisy i odsiewa puste, więc
    // sekcja z jednym wpisem „   ” jest dla niej PUSTA: zapis zablokowany
    // (linia 99), banner zapalony (linia 246), odznaka języka pokazuje 1
    // (linia 261). Znacznik „wymagane” w formularzu ma jednak własną,
    // surową miarę - `items.length === 0` (linie 281, 293) - i dla takiej
    // sekcji się NIE POJAWIA.
    //
    // KONSEKWENCJA: panel mówi „Zapis zablokowany: uzupełnij brakujące
    // powitania” i nie pokazuje, GDZIE. Siedem sekcji po siedem pól, jedno
    // z nich wyglądające na wypełnione (spacje są niewidoczne) - jedyne
    // wyjście to „Przywróć domyślne”, czyli utrata całego słownika najemcy.
    // Naprawa to osobna praca, bo wymaga UJEDNOLICENIA miary pustki w obu
    // miejscach (jedna funkcja liczenia wpisów użytecznych), a nie dopisania
    // warunku w renderze.
    h.settingsRow = {
      value: {
        pl: { ...bucketMap(() => ["Jest, {name}"]), night: ["   "] },
        en: bucketMap(() => ["Fine, {name}"]),
      },
    };
    await mountGreetings();
    await waitFor(() => expect(buttonWithText("Zapisz")).toBeTruthy());
    expect(textOf()).toContain("wymagane");
  });

  it("KONTROLA DODATNIA: białe znaki blokują zapis i liczą się w odznace", async () => {
    // Stan FAKTYCZNY dla tego samego wiersza: blokada i licznik działają,
    // brakuje wyłącznie wskazania sekcji w formularzu.
    h.settingsRow = {
      value: {
        pl: { ...bucketMap(() => ["Jest, {name}"]), night: ["   "] },
        en: bucketMap(() => ["Fine, {name}"]),
      },
    };
    await mountGreetings();
    await waitFor(() => expect(buttonWithText("Zapisz")).toBeTruthy());
    expect(requireButton("Zapisz").disabled).toBe(true);
    expect(requireElement('[data-tab-trigger="pl"]').textContent).toContain("1");
    expect(textOf()).toContain("Zapis zablokowany");
    // Pole JEST w formularzu (spacja to nie brak pola), ale bez znacznika.
    expect(elements('input[placeholder^="np."]')).toHaveLength(BUCKETS.length);
    expect(textOf()).not.toContain("wymagane");
  });

  it.fails("DEFEKT: awaria odczytu personalizacji też wygląda jak stan domyślny", async () => {
    // `admin.personalized.tsx` (linie 29-43) ma dokładnie ten sam kształt
    // odczytu: `.then(({ data }) => { if (data?.value) setS(...); setLoaded(true); })`.
    // `error` jest ignorowane.
    //
    // KONSEKWENCJA: ten panel decyduje, KTO widzi personalizację (goście,
    // zalogowani), po ilu dniach wygasają zapisy gościa i jakie sekcje są
    // włączone. Zapis po nieudanym odczycie przywraca cały ten zestaw do
    // wartości domyślnych - w tym `allowGuests: false`, czyli wyłącza
    // personalizację gościom w całym serwisie.
    h.settingsReadFails = true;
    await mountPersonalized();
    await waitFor(() => expect(buttonWithText("admin.save")).toBeTruthy());
    expect(textOf()).toContain("admin.error");
  });

  it("KONTROLA DODATNIA: po awarii odczytu personalizacji zapis wysyła DOMYŚLNE", async () => {
    // Stan FAKTYCZNY ze skutkiem: ekran wygląda jak konfiguracja najemcy,
    // a `upsert` wysyła komplet wartości domyślnych - w tym
    // `allowGuests: false`, czyli wyłączenie personalizacji gościom.
    h.settingsReadFails = true;
    await personalizedReady();
    expect(h.toastError).not.toHaveBeenCalled();
    expect(textOf()).toContain("admin.personalized.title");
    await saveAndSettle("admin.save");
    expect(lastUpsert().value).toEqual(DEFAULT_PERSONALIZED_SETTINGS);
  });

  it.fails("DEFEKT: CZĘŚCIOWY obiekt `sections` w bazie WYWALA panel", async () => {
    // `admin.personalized.tsx` (linie 36-40) scala wartość z bazy PŁASKO:
    // `{ ...DEFAULT_PERSONALIZED_SETTINGS, ...(data.value as Partial<...>) }`.
    // Wiersz, który niesie tylko część `sections` (starsza wersja panelu,
    // ręczna edycja jsonb, migracja), zastępuje CAŁY podobiekt `sections`,
    // więc `s.sections.followed` jest `undefined`, a render
    // `s.sections[key].enabled` (linia 185) rzuca.
    //
    // Co czyni to defektem, a nie kwestią gustu: CZYTELNIK tego samego klucza
    // (`useSiteSetting` -> `deepMerge`, `src/lib/useSiteSetting.ts`) jest na to
    // uodporniony - komentarz w tym pliku wprost mówi, że głębokie scalanie
    // jest obroną przed „częściową wartością z bazy (źródło niedawnej awarii
    // nagłówka)”. Publiczna strona więc PRZEŻYWA taki wiersz, a panel, który
    // jest jedynym miejscem do jego naprawienia, umiera.
    //
    // KONSEKWENCJA: konfiguracja personalizacji staje się nieodwracalna
    // z interfejsu - naprawa wymaga wejścia do bazy.
    h.settingsRow = {
      value: {
        sections: { saved: { enabled: true, heading: "Zapisane", description: "", columns: 3 } },
      },
    };
    await mountPersonalized();
    await waitFor(() => expect(buttonWithText("admin.save")).toBeTruthy());
    expect(textOf()).toContain("admin.personalized.title");
  });

  it("KONTROLA DODATNIA: częściowy `sections` kończy się BRAKIEM ekranu", async () => {
    // Stan FAKTYCZNY: odczyt WYSZEDŁ i wrócił, panel zdążył wejść w render -
    // i wtedy padł, więc na ekranie nie ma ani tytułu, ani przycisku zapisu.
    // Domknięcie po ŁAŃCUCHU odczytu, nie po treści: szkielet powłoki jest
    // w drzewie natychmiast, więc asercja postawiona na nim mierzyłaby stan
    // „w locie”, nie wynik.
    h.settingsRow = {
      value: {
        sections: { saved: { enabled: true, heading: "Zapisane", description: "", columns: 3 } },
      },
    };
    await mountPersonalized();
    await waitFor(() => expect(h.db?.lastChain("site_settings")).toBeTruthy());
    await act(async () => {});
    expect(buttonWithText("admin.save")).toBeUndefined();
    expect(textOf()).not.toContain("admin.personalized.title");
  });

  it.fails("DEFEKT: awaria listy popupów wygląda jak brak popupów", async () => {
    // `usePopupsAdmin` (`src/lib/builder/popups.ts`, linie 220-238) zwraca
    // z zapytania TYLKO `items` i `loading` - `q.isError` nie wychodzi na
    // zewnątrz, a `admin.popups.tsx` (linie 226-228) rozgałęzia się wyłącznie
    // na `popups.loading`. Przy odmowie RLS tabela renderuje się z samym
    // wierszem wbudowanego popupu, czyli identycznie jak dla najemcy, który
    // realnie nie ma ani jednego popupu.
    //
    // KONSEKWENCJA: administrator widzi „nie ma popupów”, więc tworzy nowy -
    // a jego popupy istnieją i nadal wyświetlają się czytelnikom. Ekran, na
    // którym się wyłącza kampanię, milczy właśnie wtedy, gdy jest potrzebny.
    h.popupsReadFails = true;
    await mountPopups();
    await waitFor(() => expect(elements("table")).toHaveLength(1));
    expect(textOf()).toContain("admin.popups.loadError");
  });

  it("KONTROLA DODATNIA: odmowa listy popupów daje tabelę z JEDNYM wierszem", async () => {
    // Stan FAKTYCZNY: zapytanie WYSZŁO i zostało odrzucone, a ekran jest
    // nierozróżnialny od najemcy bez ani jednego popupu.
    h.popupsReadFails = true;
    await mountPopups();
    await waitFor(() => expect(elements("table")).toHaveLength(1));
    expect(hasChainWith("builder_popups", "select")).toBe(true);
    expect(elements("tbody tr")).toHaveLength(1);
    expect(textOf()).toContain("admin.popups.builtInName");
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it.fails("DEFEKT: awaria serii aktywności i retencji wygląda jak brak danych", async () => {
    // `admin.audience.tsx` rozgałęzia stan błędu WYŁĄCZNIE dla lejka
    // (`funnelQ.isError`, linia 206). Dwa pozostałe zapytania czyta przez
    // `seriesQ.data ?? []` (linia 102) i `retentionQ.data ?? []` (linia 286),
    // więc ich `isError` nie ma żadnego wyjścia na ekran: odmowa RPC
    // renderuje `activity.empty` i `retention.empty`.
    //
    // KONSEKWENCJA: pulpit audytorium jest raportem - „brak danych
    // aktywności w tym oknie” to twierdzenie o serwisie, na którym opiera się
    // decyzja redakcyjna. Tutaj to twierdzenie jest fałszywe i nierozróżnialne
    // od prawdziwego. Lejek nad nim pokazuje przy tym poprawne liczby, co
    // dodatkowo uwiarygadnia pustkę.
    setRpc("admin_member_activity_series", fail("not_authorized", "42501"));
    setRpc("admin_member_retention", fail("not_authorized", "42501"));
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.activity.empty"));
    expect(textOf()).toContain("adminAudience.activity.error");
  });

  it("KONTROLA DODATNIA: odmowa serii i retencji renderuje PUSTKĘ, nie błąd", async () => {
    // Stan FAKTYCZNY: oba RPC zostały ZAWOŁANE i odrzucone, a pulpit twierdzi,
    // że danych nie ma - przy poprawnie policzonym lejku obok.
    setRpc("admin_member_activity_series", fail("not_authorized", "42501"));
    setRpc("admin_member_retention", fail("not_authorized", "42501"));
    await mountAudience();
    await waitFor(() => expect(textOf()).toContain("adminAudience.activity.empty"));
    await waitFor(() => expect(textOf()).toContain("adminAudience.retention.empty"));
    expect(h.rpcCalls.map((call) => call.name)).toContain("admin_member_activity_series");
    expect(h.rpcCalls.map((call) => call.name)).toContain("admin_member_retention");
    expect(textOf()).not.toContain("adminAudience.funnel.error");
  });

  it.fails("DEFEKT: zapis powitań nie unieważnia cache czytelnika ustawień", async () => {
    // `admin.greetings.tsx` (linie 111-116) i `admin.personalized.tsx`
    // (linie 47-56) piszą do `site_settings` WPROST przez klienta Supabase,
    // omijając `useSettings` / `writeSiteSettingKey`. Nie unieważniają więc
    // klucza `["site_settings_public", "all"]`, z którego czyta
    // `useSiteSetting` - a ten trzyma wynik `staleTime: 5 minut`.
    //
    // KONSEKWENCJA: te dwa panele są jedynymi w rodzinie ustawień, po których
    // zapis nie widnieje od razu w tej samej sesji przeglądarki. Administrator
    // zapisuje powitania, przechodzi na stronę i widzi STARE - przez pięć
    // minut, bez żadnego komunikatu. Rodzina `admin.settings.*` robi to
    // poprawnie (dwa unieważnienia + zdarzenie podglądu na żywo - patrz
    // `src/lib/admin/__tests__/useSettings.test.tsx`), więc to nie jest
    // decyzja projektowa, a pominięcie.
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    const queryClient = freshQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await renderRoute({
      route: GreetingsRoute,
      path: "/admin/greetings",
      initialEntry: "/admin/greetings",
      queryClient,
    });
    await waitFor(() => expect(buttonWithText("Zapisz")).toBeTruthy());
    fireEvent.click(requireButton("Zapisz"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalled();
  });

  it("KONTROLA DODATNIA: udany zapis powitań NIE rusza cache zapytań", async () => {
    // Stan FAKTYCZNY: `upsert` poszedł, sukces ogłoszony, a klient zapytań
    // nie dostał ani jednego unieważnienia - czytelnik ustawień widzi więc
    // wartość sprzed zapisu do końca okna świeżości.
    h.settingsRow = { value: singletonDict("Hej", "Hey") };
    const queryClient = freshQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await renderRoute({
      route: GreetingsRoute,
      path: "/admin/greetings",
      initialEntry: "/admin/greetings",
      queryClient,
    });
    await waitFor(() => expect(buttonWithText("Zapisz")).toBeTruthy());
    await saveAndSettle("Zapisz");
    expect(h.toastSuccess).toHaveBeenCalledWith("admin.saved");
    expect(lastUpsert().key).toBe(GREETINGS_KEY);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
