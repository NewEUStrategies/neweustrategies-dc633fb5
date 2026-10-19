// KONTRAKT ZAKŁADEK, OBSZARÓW I POWIĄZAŃ HUBA „PRZYCHÓD I LEJEK" (SPEC §2.2,
// §2.5, §2.6, §5.7; PLAN S6 §3.6).
//
// PO CO OSOBNY MODUŁ, SKORO LISTA ZAKŁADEK JEST W `lib/revenue/search.ts`.
// Tamten liść jedzie w chunku WEJŚCIOWYM każdej strony (walidator adresu
// w powłoce trasy) i celowo nie zna niczego poza nazwami. Tu mieszka wiedza,
// której potrzebuje dopiero panel: kto widzi zakładkę, w jakiej grupie paska
// stoi, jakie okno ma domyślnie i dokąd prowadzi obszar diagnostyki. Plik leży
// w `src/lib/admin/**`, którego nie skanuje generator arkusza CSS czytelnika
// (`src/styles.css`), więc słowa w komentarzach i napisach nie dokładają reguł
// do publicznego CSS.
//
// UI = BRAMKA SQL (SPEC §2.5). Role liczone są DOKŁADNIE (`admin`, `editor`),
// a nie z `isAdmin` - sam `super_admin` nie jest wpuszczany przez polityki
// huba (`has_role(…, 'admin')`, `is_admin_or_editor()`), więc pasek nie może
// mu proponować zakładek, które baza zostawi puste. Ten sam wzorzec co bramka
// roli w `RevenueHubLayout`.
//
// DANE, NIE GAŁĘZIE. Role, grupy i okresy stoją w jednej tablicy `HUB_TABS`;
// pasek, wybór sekcji na telefonie, bramka roli i testy czytają ją, zamiast
// trzymać własne kopie warunków, które rozjechałyby się przy pierwszej nowej
// zakładce.
import type { RevenuePeriod, RevenueTabId } from "@/lib/revenue/search";

/** Grupy paska zakładek (SPEC §2.2) - kolejność = kolejność na pasku. */
export const REVENUE_TAB_GROUPS = ["monitor", "fix", "automate", "understand"] as const;
export type RevenueTabGroup = (typeof REVENUE_TAB_GROUPS)[number];

/** Role, które w ogóle widzą hub (wiersz `user_roles` w najemcy). */
export type HubRole = "admin" | "editor";

export interface HubTabSpec {
  id: RevenueTabId;
  group: RevenueTabGroup;
  /** Role, którym zakładka się POKAZUJE; spoza listy = `RoleGateNotice`. */
  roles: readonly HubRole[];
  /**
   * Tryb redaktora: `preview` = widzi zakładkę, ale przyciski zapisu są
   * wyłączone (Oferta - SPEC §2.5). Brak = pełny dostęp roli.
   */
  editorMode?: "full" | "preview";
  /** Domyślny okres `?w=`; `null` = zakładka nie ma okna czasu (stan bieżący). */
  defaultPeriod: RevenuePeriod | null;
  /** Podwidok innej zakładki (Dane wejściowe → Wskaźniki). */
  parent?: "metrics";
  /** Licznik na pasku (S7: diagnozy, S5: aktywne ścieżki) - slot, Z-S6-08. */
  counter?: "diagnostics" | "journeys";
  /** Treść wymaga sesji `aal2` (SPEC §2.5) - zakładka pokazuje `MfaRequiredNotice`. */
  requiresMfa?: true;
}

const ADMIN_ONLY: readonly HubRole[] = ["admin"];
const ADMIN_AND_EDITOR: readonly HubRole[] = ["admin", "editor"];

/**
 * Zakładki huba w kolejności paska - dokładnie `REVENUE_TABS` (test pilnuje
 * zgodności obu list). Role i okresy = tabela SPEC §2.2.
 */
export const HUB_TABS: readonly HubTabSpec[] = [
  { id: "overview", group: "monitor", roles: ADMIN_AND_EDITOR, defaultPeriod: "month" },
  // Przychód i Retencja to kwoty - redaktor ich nie widzi (bramka SQL
  // `assert_admin_tenant()`), a pusta zakładka wyglądałaby jak brak przychodu.
  { id: "mrr", group: "monitor", roles: ADMIN_ONLY, defaultPeriod: "prev-month" },
  { id: "funnel", group: "monitor", roles: ADMIN_AND_EDITOR, defaultPeriod: "month" },
  { id: "retention", group: "monitor", roles: ADMIN_ONLY, defaultPeriod: "prev-month" },
  { id: "community", group: "monitor", roles: ADMIN_AND_EDITOR, defaultPeriod: "quarter" },
  {
    id: "diagnostics",
    group: "fix",
    roles: ADMIN_AND_EDITOR,
    defaultPeriod: null,
    counter: "diagnostics",
  },
  {
    id: "offer",
    group: "fix",
    roles: ADMIN_AND_EDITOR,
    editorMode: "preview",
    defaultPeriod: null,
  },
  { id: "access", group: "fix", roles: ADMIN_AND_EDITOR, defaultPeriod: "month" },
  {
    id: "journeys",
    group: "automate",
    roles: ADMIN_AND_EDITOR,
    defaultPeriod: "month",
    counter: "journeys",
    requiresMfa: true,
  },
  { id: "metrics", group: "understand", roles: ADMIN_AND_EDITOR, defaultPeriod: "prev-month" },
  {
    id: "inputs",
    group: "understand",
    roles: ADMIN_ONLY,
    defaultPeriod: null,
    parent: "metrics",
  },
];

const BY_ID = new Map<RevenueTabId, HubTabSpec>(HUB_TABS.map((spec) => [spec.id, spec]));

/** Specyfikacja zakładki; `undefined` tylko dla id spoza listy (nie powinno się zdarzyć). */
export function hubTabSpec(tab: RevenueTabId): HubTabSpec | undefined {
  return BY_ID.get(tab);
}

/** Role huba obecne w zestawie ról sesji - dokładne dopasowanie, bez `super_admin`. */
function hubRolesOf(roles: readonly string[]): HubRole[] {
  const out: HubRole[] = [];
  if (roles.includes("admin")) out.push("admin");
  if (roles.includes("editor")) out.push("editor");
  return out;
}

/** Czy rola sesji widzi zakładkę (pasek, wybór sekcji, bramka w układzie). */
export function canSeeTab(tab: RevenueTabId, roles: readonly string[]): boolean {
  const spec = BY_ID.get(tab);
  if (!spec) return false;
  return hubRolesOf(roles).some((role) => spec.roles.includes(role));
}

/** Zakładki dostępne dla ról sesji, w kolejności paska. Autor dostaje pustą listę. */
export function hubTabsFor(roles: readonly string[]): readonly HubTabSpec[] {
  const mine = hubRolesOf(roles);
  if (mine.length === 0) return [];
  return HUB_TABS.filter((spec) => mine.some((role) => spec.roles.includes(role)));
}

/** Domyślne okno zakładki, gdy adres nie niesie `?w=` (SPEC §2.2). */
export function defaultPeriodOf(tab: RevenueTabId): RevenuePeriod | null {
  return BY_ID.get(tab)?.defaultPeriod ?? null;
}

// ---------------------------------------------------------------------------
// Obszary i wagi diagnostyki (kontrakt dla S7 - SPEC §5.7)
// ---------------------------------------------------------------------------

/**
 * Obszary reguł diagnostyki. S6 definiuje je tu, bo zestaw UI (`AreaChip`,
 * `AreaHealthList`) powstaje przed rejestrem reguł S7 - typ jest kontraktem
 * dla `RevenueCheck.area`.
 */
export const REVENUE_AREAS = [
  "catalog",
  "paywall",
  "metering",
  "checkout",
  "coupons",
  "retention",
  "dunning",
  "funnel",
  "crm",
  "newsletter",
  "workflows",
  "journeys",
  "events",
  "clubs",
  "sync",
  "data_quality",
] as const;
export type RevenueArea = (typeof REVENUE_AREAS)[number];

/** Wagi diagnoz - kolejność od najpoważniejszej. */
export const REVENUE_SEVERITIES = ["critical", "warning", "info"] as const;
export type RevenueSeverity = (typeof REVENUE_SEVERITIES)[number];

export interface HubLink {
  /** Pełna ścieżka trasy (bez parametrów - konkretny adres). */
  to: string;
  search?: Readonly<Record<string, string>>;
}

/**
 * Ekran-właściciel obszaru: dokąd prowadzi „Otwórz moduł" przy diagnozie
 * (SPEC §2.6). Tylko trasy, które dziś istnieją w `routeTree.gen.ts`, i tylko
 * parametry z kontraktu deep linków - test sprawdza oba warunki, żeby link nie
 * prowadził na 404 albo na ekran, który zignoruje parametr.
 *
 * Wybory, które nie wynikają wprost z tabeli SPEC:
 *  - `funnel` → popup zapisu newslettera: obie reguły lejka (atrybucja
 *    rejestracji, popup dla członków) naprawia się w ustawieniach popupu;
 *  - `sync` → mapa systemu w Diagnostyce: emiterów zdarzeń nie edytuje żaden
 *    moduł, a mapa pokazuje, kto pisze i kto słucha;
 *  - `data_quality` → księga dokumentów rozliczeniowych: tam widać środowisko
 *    i podstawę kwot, które reguły jakości danych oceniają (uzgadnianie
 *    z operatorem jest tylko dla super administratora).
 */
export const AREA_OWNER_LINK: Readonly<Record<RevenueArea, HubLink>> = {
  catalog: { to: "/admin/paywall", search: { tab: "plans" } },
  paywall: { to: "/admin/paywall" },
  metering: { to: "/admin/paywall", search: { tab: "metering" } },
  checkout: { to: "/admin/paywall", search: { tab: "checkout" } },
  coupons: { to: "/admin/coupons" },
  retention: { to: "/admin/pricing", search: { tab: "retention" } },
  dunning: { to: "/admin/billing", search: { tab: "subscriptions" } },
  funnel: { to: "/admin/newsletter/popup" },
  crm: { to: "/admin/crm" },
  newsletter: { to: "/admin/newsletter" },
  workflows: { to: "/admin/workflows", search: { tab: "definitions" } },
  journeys: { to: "/admin/revenue/journeys" },
  events: { to: "/admin/events" },
  clubs: { to: "/admin/community/clubs/applications" },
  sync: { to: "/admin/revenue/diagnostics", search: { view: "map" } },
  data_quality: { to: "/admin/monetization-ledger" },
};

/** Kary skali kondycji - te same proporcje co `brandAuditScore` (błąd 20, ostrzeżenie 7). */
export const AREA_HEALTH_PENALTY = { critical: 20, warning: 7 } as const;

/**
 * Kondycja obszaru 0-100 na skali `brandAuditScore` (`src/lib/seo/brandAudit.ts`):
 * diagnoza krytyczna kosztuje 20, ważna 7, informacyjne nic. Ta sama skala co
 * audyt marki, bo admin widzi oba wyniki w panelu i „72" ma znaczyć to samo.
 * Komplet ważnych bez krytycznych daje „do poprawy", nie „katastrofa" - sklep,
 * który sprzedaje z niedoskonałym cennikiem, jest w innej sytuacji niż sklep,
 * w którym nie da się kupić. Liczby ujemne i ułamkowe (błąd producenta
 * faktów) nie mogą podnieść wyniku: liczymy od zera w górę, całkowicie.
 */
export function areaHealthScore(counts: { critical: number; warning: number }): number {
  const critical = Math.max(0, Math.floor(counts.critical));
  const warning = Math.max(0, Math.floor(counts.warning));
  const score =
    100 - AREA_HEALTH_PENALTY.critical * critical - AREA_HEALTH_PENALTY.warning * warning;
  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Powiązane moduły (pasek pod nagłówkiem huba)
// ---------------------------------------------------------------------------

export interface RelatedModule extends HubLink {
  /** Klucz słownika powłoki (`adminRevenue.related.*`). */
  labelKey: string;
}

/**
 * Moduły źródłowe, które hub tylko czyta - skoki do miejsc edycji. Wygląd paska
 * jak w `AdminPricingWorkspace` (przyciski obrysowane, `h-7`), żeby admin
 * rozpoznawał ten sam wzorzec nawigacji między modułami monetyzacji.
 */
export const RELATED_MODULES: readonly RelatedModule[] = [
  { to: "/admin/paywall", labelKey: "adminRevenue.related.paywall" },
  { to: "/admin/pricing", labelKey: "adminRevenue.related.pricing" },
  { to: "/admin/membership", labelKey: "adminRevenue.related.membership" },
  { to: "/admin/coupons", labelKey: "adminRevenue.related.coupons" },
  { to: "/admin/billing", labelKey: "adminRevenue.related.billing" },
  { to: "/admin/crm", labelKey: "adminRevenue.related.crm" },
  { to: "/admin/newsletter", labelKey: "adminRevenue.related.newsletter" },
  { to: "/admin/workflows", labelKey: "adminRevenue.related.workflows" },
  { to: "/admin/analytics/bi", labelKey: "adminRevenue.related.analytics" },
];
