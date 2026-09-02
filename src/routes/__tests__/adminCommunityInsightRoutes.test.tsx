// TRZY WGLĄDOWE TRASY PANELU SPOŁECZNOŚCI ZAMONTOWANE: `/admin/community/badges`,
// `/admin/community/contributors`, `/admin/community/engagement`. Przed tym
// plikiem żadna z nich nie miała ani jednej wykonanej linii (0/39, 0/26, 0/21
// linii; 0/18, 0/13, 0/9 funkcji).
//
// DLACZEGO JEDEN PLIK NA TRZY TRASY. Nie dlatego, że „są w tym samym
// katalogu". Te trzy trasy dzielą DOKŁADNIE TE SAME trzy rozstrzygnięcia
// i tylko zestawione obok siebie dają się o nie uczciwie odpytać:
//   1. bramka roli sztabowej stoi w JEDNYM miejscu dla wszystkich trzech
//      (layout `/admin`), a nie w trasie - dowód jest wspólny i nie ma sensu
//      przepisywać go trzy razy;
//   2. izolacja tenanta w KAŻDEJ z nich jest egzekwowana w bazie, ale każda
//      robi z tenantem coś INNEGO po stronie przeglądarki (badges: klucz
//      cache + bramka `enabled`; contributors: nic; engagement: nic) - to
//      różnica, którą widać dopiero w zestawieniu;
//   3. wszystkie trzy mają TEN SAM defekt klasy „awaria odczytu wygląda jak
//      pustka" i porównanie jest tu treścią raportu, nie oszczędnością miejsca.
// Podział na trzy pliki rozsypałby te trzy dowody na trzy nagłówki, z których
// każdy musiałby powtarzać cudze ustalenia.
//
// ---------------------------------------------------------------------------
// PYTANIE 1: GDZIE STOI BRAMKA ROLI SZTABOWEJ (USTALENIE, NIE ZAŁOŻENIE)
// ---------------------------------------------------------------------------
// Sprawdzone w źródłach, nie założone:
//   * `src/routes/admin.tsx` (layout `/admin`) - JEDYNA bramka renderu:
//     `useAuth()` daje `isStaff`, efekt robi `navigate({ to: "/login" })`,
//     a komponent zwraca `null` dla nie-sztabu;
//   * `src/routes/admin.community.tsx` - podnawigacja i `<Outlet/>`, zero roli;
//   * `badges` woła `useAuth()`, ale WYŁĄCZNIE po `tenantId`; `contributors`
//     i `engagement` nie wołają go wcale. Żadna z trzech nie ma `beforeLoad`,
//     `redirect()` ani `<Navigate/>`;
//   * autorytet ostateczny siedzi w bazie: `admin_list_profile_badges`,
//     `admin_grant_profile_badge`, `admin_revoke_profile_badge`
//     i `get_engagement_overview` to funkcje SECURITY DEFINER, które SAME
//     sprawdzają rolę (`has_role admin|editor`, przy odbieraniu wyłącznie
//     `admin`/`super_admin`), a `contributor_submissions` ma polityki RLS
//     `submissions staff read|update`.
// Dlatego NIE MA tu testu „bez roli nie widzi panelu" na poziomie trasy: taki
// test mierzyłby atrapę `useAuth`, której dwie z tych tras nawet nie wołają.
// Zamiast tego są asercje mierzące TO, CO JEST (render bez sesji + odczyt
// źródeł), tak samo jak w `adminCommunityNotificationsRoute.test.tsx`
// i w bramce `adminRouteAuthority.gate.test.ts`.
//
// SKUTEK UBOCZNY TEGO PODZIAŁU, KTÓRY TEN PLIK NAZYWA: `isStaff` obejmuje też
// `author`, a odbieranie odznaki wymaga `admin`. Trasa renderuje kosz każdemu,
// kto wszedł do panelu, i dopiero RPC odmawia. To nie jest dziura
// bezpieczeństwa (baza trzyma), tylko oferowanie przycisku, który nie zadziała
// - mierzymy to renderem i opisujemy, nie pinujemy jako defekt.
//
// ---------------------------------------------------------------------------
// PYTANIE 2: IZOLACJA TENANTA I GRANICA TEGO DOWODU
// ---------------------------------------------------------------------------
// Żadna z tych tras NIE WYSYŁA identyfikatora tenanta do bazy - i to jest
// dobra wiadomość, bo znaczy, że przeglądarka nie ma jak wskazać cudzego.
// Tenant bierze się z sesji: `current_tenant_id()` w RPC i w politykach RLS.
// W tej warstwie zostaje więc tylko to, co widać stąd:
//   * `badges` trzyma tenant w KLUCZU zapytania (`["admin-badges", tenantId]`)
//     i nie strzela przed jego rozwiązaniem (`enabled: !!tenantId`) - to
//     partycjonowanie cache, nie zabezpieczenie, ale bez niego przełączenie
//     tożsamości pokazałoby cudzą listę z pamięci; dowodzimy obu zachowań;
//   * `contributors` i `engagement` mają klucze BEZ tenanta. Nie jest to
//     dziś eksploatowalne (tenant wynika z profilu użytkownika, a `signOut()`
//     woła `queryClient.clear()` i twardą nawigację - `src/hooks/useAuth.tsx`),
//     więc nie pinuję tego jako defektu; mierzę i nazywam.
// GRANICA: prawdziwa izolacja jest w SQL i jej dowód mieszka w pgTAP. Tutaj
// dowodzę wyłącznie, że warstwa kliencka nie ma czym jej obejść (nie podaje
// tenanta jako argumentu) i że przekazuje rozwiązany tenant w dół (karta
// domen weryfikacyjnych).
//
// ---------------------------------------------------------------------------
// PYTANIE 3: POTWIERDZENIE OPERACJI NIENAPRAWIALNYCH
// ---------------------------------------------------------------------------
//   * ODEBRANIE odznaki: MA potwierdzenie (`confirmDialog`, `destructive`),
//     i to potwierdzenie realnie blokuje mutację przy anulowaniu - dowodzę
//     obu połówek. ALE treść dialogu nie mówi, KOMU odbieramy odznakę, a lista
//     ma wiele wierszy z tą samą odznaką: pomyłka o jeden wiersz jest
//     nieodróżnialna i nieodwracalna (RPC robi twardy DELETE). To defekt -
//     `it.fails` z kontrolą dodatnią.
//   * NADANIE odznaki: potwierdzenia NIE MA. Świadomie tego NIE pinuję.
//     Nadanie jest addytywne, idempotentne (`ON CONFLICT DO NOTHING`),
//     zablokowane w UI przy duplikacie i odwracalne dokładnie tym przyciskiem
//     obok. Dług potwierdzeń leży po stronie nieodwracalnej i tam go pinuję.
//     Sam FAKT braku potwierdzenia jest zmierzony zwykłym, zielonym testem.
//   * ODRZUCENIE zgłoszenia współtwórcy: potwierdzenia NIE MA, a z tego panelu
//     jest to operacja BEZ DROGI POWROTNEJ - przyciski akcji renderują się
//     wyłącznie dla wierszy `pending`, więc po odrzuceniu nie ma czym cofnąć.
//     To defekt - `it.fails` z kontrolą dodatnią (klik faktycznie dojeżdża do
//     warstwy danych, więc `it.fails` gaśnie na braku pytania, nie na
//     martwym przycisku).
//
// ---------------------------------------------------------------------------
// CZEGO W TYCH TRASACH NIE MA, A BYŁO W ZLECENIU (uczciwe sprostowanie)
// ---------------------------------------------------------------------------
//   * „tablica kontrybutorów z opt-inem do katalogu": `/admin/community/
//     contributors` NIE JEST katalogiem osób. To kolejka moderacyjna ZGŁOSZEŃ
//     (`contributor_submissions`: tytuł, pitch, język, status, notatka
//     redakcji). Tabela nie ma ani jednej kolumny zgody, a o widoczności
//     wiersza decydują dwa filtry UI (status, język) plus RLS. Dowodzę tego,
//     co jest: filtry sterują ZAPYTANIEM (nie filtrowaniem po stronie
//     przeglądarki), a trasa nie zna żadnego warunku zgody.
//   * „zmiana zakresu dni" w zaangażowaniu: trasa NIE MA takiego sterowania.
//     Okna 7/30 dni są zaszyte w SQL RPC `get_engagement_overview()`, które
//     nie przyjmuje ARGUMENTÓW. Dowodzę więc, gdzie to okno naprawdę leży,
//     i że z UI nie da się go ruszyć.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { AdminBadgeRow } from "@/lib/admin/badges";
import type { ContributorSubmissionView, EngagementOverview } from "@/lib/admin/community";
import type { ProfileBadgeKind } from "@/lib/profile/badgeCatalog";

const TENANT = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  auth: { tenantId: "11111111-1111-4111-8111-111111111111" as string | null },
  pickedMember: "22222222-2222-4222-8222-222222222222",
  fetchBadges: vi.fn<() => Promise<AdminBadgeRow[]>>(),
  grantBadge: vi.fn<(userId: string, badge: string, note?: string) => Promise<string>>(),
  revokeBadge: vi.fn<(id: string) => Promise<void>>(),
  fetchSubmissions:
    vi.fn<(status?: string, language?: string) => Promise<ContributorSubmissionView[]>>(),
  reviewSubmission: vi.fn<(id: string, status: string, note?: string) => Promise<void>>(),
  fetchEngagement: vi.fn<() => Promise<EngagementOverview>>(),
  confirmAnswer: true,
  confirmCalls: [] as Record<string, unknown>[],
  toasts: [] as { kind: "success" | "error"; text: string }[],
  verificationCard: null as { language: string; tenantId: string | null | undefined } | null,
}));

// Kontekst tożsamości. Atrapa jest tu KONIECZNA i zarazem wąska: harness
// montuje pojedynczą trasę bez `AuthProvider`, więc prawdziwy `useAuth()`
// oddałby `tenantId: null` i trasa badges nigdy nie strzeliłaby zapytania.
// Atrapa oddaje wyłącznie to pole, które trasa czyta.
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));

vi.mock("sonner", () => ({
  toast: {
    success: (text: string) => h.toasts.push({ kind: "success", text }),
    error: (text: string) => h.toasts.push({ kind: "error", text }),
  },
}));

// Dialog potwierdzenia mieszka w globalnym store (`AppDialogHost` w `__root`),
// którego harness pojedynczej trasy nie montuje. Atrapa REJESTRUJE żądanie
// i oddaje sterowaną odpowiedź - dzięki temu przedmiotem dowodu jest TREŚĆ
// pytania i to, czy odmowa naprawdę blokuje mutację.
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: async (opts: Record<string, unknown>) => {
    h.confirmCalls.push(opts);
    return h.confirmAnswer;
  },
}));

// Warstwy danych. Atrapy są na miejscu: obie idą do Supabase (RPC albo
// PostgREST), a przedmiotem dowodu tych tras jest to, CO ROBIĄ z wynikiem
// i z jakimi argumentami wołają - nie jak wygląda round-trip. Kontrakt samych
// funkcji jest dowodzony w `src/lib/admin/__tests__`.
vi.mock("@/lib/admin/badges", () => ({
  fetchBadges: () => h.fetchBadges(),
  grantBadge: (userId: string, badge: string, note?: string) => h.grantBadge(userId, badge, note),
  revokeBadge: (id: string) => h.revokeBadge(id),
}));

vi.mock("@/lib/admin/community", () => ({
  fetchContributorSubmissions: (status?: string, language?: string) =>
    h.fetchSubmissions(status, language),
  reviewContributorSubmission: (id: string, status: string, note?: string) =>
    h.reviewSubmission(id, status, note),
  fetchEngagementOverview: () => h.fetchEngagement(),
}));

// Wyszukiwarka członków ma własną warstwę (`@/lib/admin/memberSearch`
// + `src/lib/admin/__tests__/memberSearch.test.ts`) i odpytuje `profiles`
// żywym klientem. Tutaj interesuje nas WYŁĄCZNIE kontrakt trasy wobec niej:
// jakie etykiety dostaje ze słownika i co trasa robi z wybranym id.
vi.mock("@/components/admin/community/MemberPicker", () => ({
  MemberPicker: ({
    value,
    onChange,
    labels,
  }: {
    value: string;
    onChange: (next: string) => void;
    labels: { placeholder: string };
  }) => (
    <button
      type="button"
      data-testid="member-picker"
      data-value={value}
      onClick={() => onChange(h.pickedMember)}
    >
      {labels.placeholder}
    </button>
  ),
}));

// Karta domen weryfikacyjnych ma własną warstwę danych
// (`@/lib/admin/verificationDomains`, `@/lib/billing/tiers`), która pod
// prawdziwym tenantem poszłaby do sieci. Atrapa zapisuje PROPSY, bo kontrakt
// trasy wobec tej karty jest dokładnie taki: przekaż rozwiązany tenant i język.
// GRANICA: zachowanie samej karty nie jest tu dowodzone (nie ma dziś własnego
// testu - to luka poza zakresem tego pakietu).
vi.mock("@/components/admin/community/VerificationDomainsCard", () => ({
  VerificationDomainsCard: (props: { language: string; tenantId: string | null | undefined }) => {
    h.verificationCard = props;
    return <div data-testid="verification-domains" />;
  },
}));

// `<Link>` buduje adres z drzewa tras aplikacji, a harness montuje jedną trasę
// pod zastępczym korzeniem - `/events/$slug` w tym drzewie nie istnieje.
// Wspólny stub oddaje prawdziwą kotwicę z rozwiniętym parametrem, więc test
// czyta CEL nawigacji, a nie szablon.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// `react-i18next` NIE JEST atrapowany - napisy mają pochodzić ze słownika
// `@/lib/i18n-admin-community` (rejestruje się przy imporcie modułów tras).
import { realT } from "@/test/i18nReal";
import { renderRoute, routeHead } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { badgeLabel } from "@/lib/profile/badgeCatalog";
import { Route as BadgesRoute } from "@/routes/admin.community.badges";
import { Route as ContributorsRoute } from "@/routes/admin.community.contributors";
import { Route as EngagementRoute } from "@/routes/admin.community.engagement";

const t = realT("pl");

function testClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function mount(route: typeof BadgesRoute, path: string, queryClient?: QueryClient) {
  return renderRoute({
    route,
    path,
    initialEntry: path,
    queryClient: queryClient ?? testClient(),
  });
}

const mountBadges = (qc?: QueryClient) => mount(BadgesRoute, "/admin/community/badges", qc);
const mountContributors = (qc?: QueryClient) =>
  mount(ContributorsRoute, "/admin/community/contributors", qc);
const mountEngagement = (qc?: QueryClient) =>
  mount(EngagementRoute, "/admin/community/engagement", qc);

// ---------------------------------------------------------------------------
// FIXTURES. RODO: nazwiska i tytuły są zmyślone, adresy w domenie example.com.
// ---------------------------------------------------------------------------

function badgeRow(over: Partial<AdminBadgeRow> = {}): AdminBadgeRow {
  return {
    id: "badge-1",
    tenant_id: TENANT,
    user_id: MEMBER,
    badge: "verified",
    grant_source: "manual",
    granted_by: null,
    note: null,
    created_at: "2026-08-01T09:00:00.000Z",
    member_display_name: "Zofia Wilk",
    member_email: "zofia.wilk@example.com",
    member_avatar_url: null,
    ...over,
  };
}

function submission(over: Partial<ContributorSubmissionView> = {}): ContributorSubmissionView {
  return {
    id: "sub-1",
    tenant_id: TENANT,
    user_id: MEMBER,
    title: "Reforma rynku energii - trzy scenariusze",
    pitch: "Propozycja analizy skutków pakietu dla przemysłu energochłonnego.",
    language: "pl",
    status: "pending",
    db_status: "submitted",
    editor_note: null,
    reviewed_at: null,
    reviewed_by: null,
    created_at: "2026-08-10T08:30:00.000Z",
    updated_at: "2026-08-10T08:30:00.000Z",
    ...over,
  };
}

function overview(over: Partial<EngagementOverview> = {}): EngagementOverview {
  return {
    members_total: 200,
    members_new_30d: 18,
    active_7d: 50,
    active_30d: 120,
    subscriptions_active: 44,
    tier_distribution: { standard: 30, vip: 14 },
    push_optin: 61,
    digest_optin: 88,
    events_upcoming: 5,
    rsvps_upcoming: 73,
    qa_open_questions: 9,
    poll_votes_30d: 240,
    submissions_pending: 3,
    tracker_follows: 156,
    top_upcoming_events: [
      {
        slug: "brukselski-briefing-jesienny",
        title_pl: "Brukselski briefing jesienny",
        title_en: "Autumn Brussels briefing",
        starts_at: "2026-09-20T16:00:00.000Z",
        going: 42,
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  h.auth = { tenantId: TENANT };
  h.pickedMember = MEMBER;
  h.fetchBadges.mockReset();
  h.fetchBadges.mockResolvedValue([]);
  h.grantBadge.mockReset();
  h.grantBadge.mockResolvedValue("badge-new");
  h.revokeBadge.mockReset();
  h.revokeBadge.mockResolvedValue(undefined);
  h.fetchSubmissions.mockReset();
  h.fetchSubmissions.mockResolvedValue([]);
  h.reviewSubmission.mockReset();
  h.reviewSubmission.mockResolvedValue(undefined);
  h.fetchEngagement.mockReset();
  h.fetchEngagement.mockResolvedValue(overview());
  h.confirmAnswer = true;
  h.confirmCalls = [];
  h.toasts = [];
  h.verificationCard = null;
});

/**
 * Wartość kafelka po jego ETYKIECIE (kafelek to wiersz „ikona + etykieta"
 * i wiersz z liczbą). Odczyt po etykiecie, a nie po pozycji w siatce:
 * przestawienie kafelków nie może zamienić testu w fałszywy dowód, że
 * „aktywni 7 dni" pokazują liczbę wszystkich członków.
 */
function statValue(label: string): string {
  const labelRow = screen.getByText(label);
  const valueRow = labelRow.nextElementSibling;
  if (!valueRow) throw new Error(`test: kafelek „${label}" nie ma wiersza z wartością`);
  return valueRow.textContent ?? "";
}

/** Przycisk katalogu odznak (kafelek z `aria-pressed`), po etykiecie odznaki. */
function catalogButton(kind: ProfileBadgeKind): HTMLElement {
  const label = badgeLabel(kind, "pl");
  const found = screen
    .getAllByRole("button")
    .find(
      (element) =>
        element.getAttribute("aria-pressed") !== null &&
        (element.textContent ?? "").startsWith(label),
    );
  if (!found) throw new Error(`test: brak kafelka katalogu dla odznaki „${label}"`);
  return found;
}

/**
 * Wybór wartości w PRAWDZIWYM Radix Select.
 *
 * Dwie rzeczy, które ten helper musi obchodzić, i obie są treścią, nie techniką:
 *   * happy-dom nie ma pointer API, więc listę otwiera się klawiaturą (Enter na
 *     triggerze) - dokładnie tą drogą, którą i tak musi umieć operator
 *     korzystający z klawiatury;
 *   * triggera NIE DA SIĘ znaleźć po nazwie dostępnej, bo jej NIE MA:
 *     `role="combobox"` nie bierze nazwy z treści (nameFrom: author), a te
 *     droplisty nie mają `aria-label`. To ten sam defekt, który pinuje niżej
 *     `it.fails` z sekcji dostępności - tutaj tylko wyciągamy z niego wniosek
 *     i szukamy triggera po WIDOCZNEJ wartości.
 */
async function pickInSelect(currentValue: string, optionName: string): Promise<void> {
  const trigger = screen
    .getAllByRole("combobox")
    .find((element) => (element.textContent ?? "").trim() === currentValue);
  if (!trigger) throw new Error(`test: brak droplisty pokazującej „${currentValue}"`);
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

// ===========================================================================
// /admin/community/badges
// ===========================================================================

describe("/admin/community/badges - katalog i lista nadań", () => {
  it("head() ustawia tytuł karty", async () => {
    expect(routeHead(BadgesRoute).meta).toContainEqual({ title: "Badges · Community · Admin" });
    const { meta } = await mountBadges();
    expect(meta()).toContainEqual({ title: "Badges · Community · Admin" });
  });

  it("katalog pokazuje wszystkie cztery odznaki, wybrana jest „zweryfikowany”", async () => {
    await mountBadges();
    // Katalog jest kontraktem z bazą (CHECK `profile_badges_badge_check`),
    // więc brak kafelka znaczy „odznaki nie da się nadać z panelu".
    expect(catalogButton("verified")).toHaveAttribute("aria-pressed", "true");
    for (const kind of ["expert", "staff", "contributor"] as const) {
      expect(catalogButton(kind)).toHaveAttribute("aria-pressed", "false");
    }
    // Tryb hybrydowy (odznaka nadawana też automatycznie) musi być oznaczony,
    // inaczej operator nie wie, że system nada ją sam po przyjęciu materiału.
    expect(
      within(catalogButton("contributor")).getByText(t("adminCommunity.badges.manualAutomatic")),
    ).toBeInTheDocument();
    expect(
      within(catalogButton("verified")).queryByText(t("adminCommunity.badges.manualAutomatic")),
    ).toBeNull();
  });

  it("klik w kafelek przestawia wybór odznaki", async () => {
    await mountBadges();
    fireEvent.click(catalogButton("expert"));
    expect(catalogButton("expert")).toHaveAttribute("aria-pressed", "true");
    expect(catalogButton("verified")).toHaveAttribute("aria-pressed", "false");
  });

  it("droplista i kafelki katalogu prowadzą JEDEN wybór, nie dwa", async () => {
    await mountBadges();
    // Ten sam stan obsługują dwa sterowania (kafelki dla myszy, droplista dla
    // klawiatury i wąskich ekranów). Rozjazd między nimi znaczyłby, że operator
    // widzi zaznaczoną jedną odznakę, a nada inną.
    await pickInSelect(badgeLabel("verified", "pl"), badgeLabel("contributor", "pl"));

    await waitFor(() =>
      expect(catalogButton("contributor")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(catalogButton("verified")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByTestId("member-picker"));
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.badges.grant") }));
    await waitFor(() =>
      expect(h.grantBadge).toHaveBeenCalledWith(MEMBER, "contributor", undefined),
    );
  });

  it("lista nadań pokazuje osobę, źródło, notatkę i datę", async () => {
    h.fetchBadges.mockResolvedValue([
      badgeRow({ note: "Potwierdzone legitymacją prasową.", grant_source: "manual" }),
      badgeRow({
        id: "badge-2",
        badge: "contributor",
        grant_source: "contributor_submission",
        member_display_name: "Marek Dąb",
        member_email: "marek.dab@example.com",
      }),
    ]);
    await mountBadges();

    const zofia = await screen.findByText("Zofia Wilk");
    const wiersz = zofia.closest("li");
    expect(wiersz).not.toBeNull();
    // Źródło nadania decyduje o tym, czy odebranie ręką ma sens: odznakę
    // z „przyjętego materiału" automat nada ponownie.
    expect(within(wiersz!).getByText(t("adminCommunity.badges.sourceManual"))).toBeInTheDocument();
    expect(within(wiersz!).getByText("Potwierdzone legitymacją prasową.")).toBeInTheDocument();
    expect(within(wiersz!).getByText("zofia.wilk@example.com")).toBeInTheDocument();

    const marek = screen.getByText("Marek Dąb").closest("li");
    expect(
      within(marek!).getByText(t("adminCommunity.badges.sourceContributorSubmission")),
    ).toBeInTheDocument();
  });

  it("bez nazwy wyświetlanej wiersz pokazuje e-mail, a bez e-maila samo id", async () => {
    h.fetchBadges.mockResolvedValue([
      badgeRow({ id: "badge-3", member_display_name: null }),
      badgeRow({ id: "badge-4", member_display_name: null, member_email: null }),
    ]);
    await mountBadges();

    // Wiersz bez żadnej etykiety osoby byłby anonimowym przyciskiem „odbierz".
    await screen.findByText("zofia.wilk@example.com");
    expect(screen.getByText(MEMBER)).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: pusty katalog nadań mówi „brak odznak”", async () => {
    h.fetchBadges.mockResolvedValue([]);
    await mountBadges();
    expect(await screen.findByText(t("adminCommunity.badges.noBadges"))).toBeInTheDocument();
  });

  it.fails("DEFEKT: odmowa odczytu listy nadań wygląda jak pusty katalog", async () => {
    // KONSEKWENCJA: `useQuery` bez obsługi `q.error` zostawia `q.data`
    // niezdefiniowane, a widok renderuje wtedy dokładnie ten sam komunikat,
    // co przy realnie pustej liście. Operator, któremu RLS albo awaria ucięła
    // odczyt, czyta „Brak odznak" i wyciąga wniosek, że nikt w tenancie nie ma
    // odznaki - po czym nadaje drugą kopię istniejącej albo raportuje, że
    // program odznak nie działa. Trasa `/admin/community/notifications`
    // rozwiązuje ten sam problem poprawnie (kafelki pokazują „-", nie „0"),
    // więc wzorzec w tym module ISTNIEJE i nie jest to kwestia gustu.
    h.fetchBadges.mockRejectedValue(new Error("odmowa bazy"));
    await mountBadges();
    await screen.findByText(t("adminCommunity.badges.recentlyGranted"));

    expect(
      screen.queryByText(t("adminCommunity.badges.noBadges")),
      "awaria odczytu nie może udawać pustej listy",
    ).toBeNull();
  });
});

describe("/admin/community/badges - nadawanie odznaki", () => {
  const grantButton = () => screen.getByRole("button", { name: t("adminCommunity.badges.grant") });

  it("nadanie odznaki weryfikowanej idzie z wybranym członkiem, rodzajem i notatką", async () => {
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mountBadges(queryClient);

    fireEvent.click(screen.getByTestId("member-picker"));
    fireEvent.change(screen.getByLabelText(t("adminCommunity.badges.badgeNote")), {
      target: { value: "Weryfikacja na podstawie domeny instytucji." },
    });
    fireEvent.click(grantButton());

    await waitFor(() =>
      expect(h.grantBadge).toHaveBeenCalledWith(
        MEMBER,
        "verified",
        "Weryfikacja na podstawie domeny instytucji.",
      ),
    );
    // Bez OBU unieważnień panel pokazuje starą listę (`staleTime: 30_000`),
    // a odznaka nie pojawia się na profilu, który czyta `["profile-badges"]`.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-badges"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["profile-badges"] });
    expect(h.toasts).toContainEqual({
      kind: "success",
      text: t("adminCommunity.badges.granted"),
    });
  });

  it("po udanym nadaniu formularz się czyści (drugi klik nie powtarza nadania)", async () => {
    await mountBadges();
    fireEvent.click(screen.getByTestId("member-picker"));
    fireEvent.change(screen.getByLabelText(t("adminCommunity.badges.badgeNote")), {
      target: { value: "Notatka jednorazowa" },
    });
    fireEvent.click(grantButton());

    await waitFor(() => expect(h.grantBadge).toHaveBeenCalledTimes(1));
    // Niewyczyszczony formularz to zaproszenie do nadania tej samej odznaki
    // drugi raz, tym razem z cudzą notatką.
    await waitFor(() =>
      expect(screen.getByTestId("member-picker")).toHaveAttribute("data-value", ""),
    );
    expect(screen.getByLabelText(t("adminCommunity.badges.badgeNote"))).toHaveValue("");
    expect(grantButton()).toBeDisabled();
  });

  it("bez wybranego członka przycisk nadania jest nieaktywny", async () => {
    await mountBadges();
    expect(grantButton()).toBeDisabled();
    fireEvent.click(grantButton());
    expect(h.grantBadge).not.toHaveBeenCalled();
  });

  it("duplikat: gdy wybrany członek MA już tę odznakę, nadanie jest zablokowane", async () => {
    h.fetchBadges.mockResolvedValue([badgeRow({ user_id: MEMBER, badge: "verified" })]);
    await mountBadges();
    await screen.findByText("Zofia Wilk");

    fireEvent.click(screen.getByTestId("member-picker"));

    // Ostrzeżenie jest `role="status"`, więc czytnik ekranu ogłosi je bez
    // przenoszenia fokusu - operator nie klika w przycisk, który i tak nic nie zrobi.
    const ostrzezenie = await screen.findByRole("status");
    expect(ostrzezenie).toHaveTextContent(t("adminCommunity.badges.selectedMemberAlreadyHas"));
    expect(grantButton()).toBeDisabled();
    expect(h.grantBadge).not.toHaveBeenCalled();
  });

  it("duplikat liczy się PER ODZNAKA - inna odznaka dla tej samej osoby przechodzi", async () => {
    h.fetchBadges.mockResolvedValue([badgeRow({ user_id: MEMBER, badge: "verified" })]);
    await mountBadges();
    await screen.findByText("Zofia Wilk");

    fireEvent.click(screen.getByTestId("member-picker"));
    fireEvent.click(catalogButton("expert"));

    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(grantButton());
    await waitFor(() => expect(h.grantBadge).toHaveBeenCalledWith(MEMBER, "expert", undefined));
  });

  it("nadanie NIE PYTA o potwierdzenie (zmierzony fakt, nie defekt)", async () => {
    // Operacja addytywna, idempotentna w bazie (`ON CONFLICT DO NOTHING`),
    // zablokowana przy duplikacie i odwracalna przyciskiem obok. Test jest tu
    // po to, żeby dodanie potwierdzenia było ŚWIADOMĄ zmianą kontraktu,
    // a nie cichym efektem ubocznym refaktoru.
    await mountBadges();
    fireEvent.click(screen.getByTestId("member-picker"));
    fireEvent.click(grantButton());

    await waitFor(() => expect(h.grantBadge).toHaveBeenCalledTimes(1));
    expect(h.confirmCalls).toEqual([]);
  });

  it("odmowa nadania pokazuje KOMUNIKAT BAZY, a nie samą ogólną porażkę", async () => {
    h.grantBadge.mockRejectedValue(new Error("profile_badges: admin role required"));
    await mountBadges();
    fireEvent.click(screen.getByTestId("member-picker"));
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.badges.grant") }));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: "profile_badges: admin role required",
      }),
    );
  });

  it("błąd bez treści spada na komunikat ze słownika, nie na pusty toast", async () => {
    h.grantBadge.mockRejectedValue(new Error(""));
    await mountBadges();
    fireEvent.click(screen.getByTestId("member-picker"));
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.badges.grant") }));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({ kind: "error", text: t("adminCommunity.badges.failed") }),
    );
  });
});

describe("/admin/community/badges - odbieranie odznaki (operacja nieodwracalna)", () => {
  const revokeButton = async () =>
    (await screen.findAllByRole("button", { name: t("adminCommunity.badges.revokeBadge") }))[0];

  it("odebranie PYTA, a po potwierdzeniu woła RPC i unieważnia oba klucze", async () => {
    h.fetchBadges.mockResolvedValue([badgeRow({ id: "badge-9" })]);
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mountBadges(queryClient);

    fireEvent.click(await revokeButton());

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    await waitFor(() => expect(h.revokeBadge).toHaveBeenCalledWith("badge-9"));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-badges"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["profile-badges"] });
    expect(h.toasts).toContainEqual({
      kind: "success",
      text: t("adminCommunity.badges.revoked"),
    });
  });

  it("KONTROLA DODATNIA: pytanie niesie nazwę odznaki i jest oznaczone jako niszczące", async () => {
    h.fetchBadges.mockResolvedValue([badgeRow({ badge: "expert" })]);
    await mountBadges();
    fireEvent.click(await revokeButton());

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.confirmCalls[0]).toMatchObject({
      title: t("adminCommunity.badges.revokeConfirmTitle"),
      description: t("adminCommunity.badges.revokeConfirmBody", {
        badge: badgeLabel("expert", "pl"),
      }),
      confirmLabel: t("adminCommunity.badges.revoke"),
      destructive: true,
    });
  });

  it("anulowanie w dialogu NIE odbiera odznaki", async () => {
    h.confirmAnswer = false;
    h.fetchBadges.mockResolvedValue([badgeRow()]);
    await mountBadges();

    fireEvent.click(await revokeButton());

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    // Dialog, który pyta, ale i tak wykonuje, jest gorszy niż brak dialogu:
    // uczy operatora, że „Anuluj" nic nie znaczy.
    expect(h.revokeBadge).not.toHaveBeenCalled();
    expect(h.toasts).toEqual([]);
  });

  it("odmowa RPC przy odbieraniu kończy się toastem błędu, nie ciszą", async () => {
    h.fetchBadges.mockResolvedValue([badgeRow()]);
    h.revokeBadge.mockRejectedValue(new Error("odmowa bazy"));
    await mountBadges();

    fireEvent.click(await revokeButton());

    await waitFor(() =>
      expect(h.toasts).toContainEqual({ kind: "error", text: t("adminCommunity.badges.failed") }),
    );
  });

  it.fails("DEFEKT: potwierdzenie odebrania nie mówi, KOMU odbieramy odznakę", async () => {
    // KONSEKWENCJA: lista „ostatnio przyznane" to wiele wierszy, w których ta
    // sama odznaka powtarza się dla różnych osób, a każdy wiersz ma identyczny
    // kosz bez podpisu. Dialog mówi wyłącznie „Zweryfikowany - tej operacji nie
    // można cofnąć", czyli DOKŁADNIE TO SAMO dla wiersza sąsiada. Pomyłka
    // o jeden wiersz jest w tym pytaniu niewykrywalna, a skutek nieodwracalny:
    // `admin_revoke_profile_badge` robi twardy DELETE, więc znika też notatka,
    // autor nadania i data. Potwierdzenie operacji niszczącej musi identyfikować
    // OBIEKT, którego dotyczy - nie tylko jej rodzaj.
    h.fetchBadges.mockResolvedValue([
      badgeRow({ id: "badge-a", member_display_name: "Zofia Wilk" }),
      badgeRow({
        id: "badge-b",
        user_id: "33333333-3333-4333-8333-333333333333",
        member_display_name: "Halina Sokół",
        member_email: "halina.sokol@example.com",
      }),
    ]);
    await mountBadges();
    const koszyki = await screen.findAllByRole("button", {
      name: t("adminCommunity.badges.revokeBadge"),
    });
    fireEvent.click(koszyki[1]);

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    const pytanie = JSON.stringify(h.confirmCalls[0]);
    expect(pytanie, "pytanie musi wskazywać osobę, której dotyczy").toContain("Halina Sokół");
  });
});

describe("/admin/community/badges - tenant i uprawnienia", () => {
  it("bez rozwiązanego tenanta trasa NIE ODPYTUJE bazy", async () => {
    h.auth = { tenantId: null };
    await mountBadges();
    await screen.findByText(t("adminCommunity.badges.recentlyGranted"));

    // `enabled: !!tenantId` jest tu treścią: zapytanie wysłane przed
    // rozwiązaniem tenanta wpadłoby do cache pod kluczem „none" i pierwszy
    // render po zalogowaniu pokazałby wynik spod niewłaściwego klucza.
    expect(h.fetchBadges).not.toHaveBeenCalled();
    expect(h.verificationCard).toMatchObject({ tenantId: null });
  });

  it("z tenantem odpytuje raz i przekazuje ten sam tenant karcie domen", async () => {
    await mountBadges();
    await waitFor(() => expect(h.fetchBadges).toHaveBeenCalledTimes(1));
    expect(h.verificationCard).toMatchObject({ tenantId: TENANT, language: "pl" });
  });

  it("klucz cache listy jest ROZDZIELONY po tenancie", async () => {
    const { queryClient } = await mountBadges();
    await waitFor(() => expect(h.fetchBadges).toHaveBeenCalledTimes(1));

    const klucze = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    // Bez segmentu tenanta lista jednego tenanta zostałaby w pamięci pod
    // kluczem współdzielonym z drugim.
    expect(klucze).toContainEqual(["admin-badges", TENANT]);
  });

  it("warstwa danych NIE PODAJE tenanta - bierze go z sesji w RPC", () => {
    // Świadome NEGATYWNE ustalenie: gdyby tenant szedł argumentem
    // z przeglądarki, izolacja byłaby po stronie klienta, czyli do podmiany.
    const warstwa = readFileSync("src/lib/admin/badges.ts", "utf8");
    expect(warstwa).toMatch(/rpc\("admin_list_profile_badges"/);
    expect(warstwa).toMatch(/rpc\("admin_grant_profile_badge"/);
    expect(warstwa).toMatch(/rpc\("admin_revoke_profile_badge"/);
    expect(warstwa).not.toMatch(/p_tenant/);
    expect(warstwa).not.toMatch(/createServerFn/);
  });

  it("bramka roli NIE stoi w tej trasie - `useAuth` czyta wyłącznie tenant", () => {
    const zrodlo = readFileSync("src/routes/admin.community.badges.tsx", "utf8");
    expect(zrodlo).toMatch(/const \{ tenantId \} = useAuth\(\);/);
    expect(zrodlo).not.toMatch(/isStaff|isAdmin|isSuperAdmin/);
    expect(zrodlo).not.toMatch(/beforeLoad|redirect\(|<Navigate/);
  });

  it("kosz renderuje się BEZ pytania o rolę, choć RPC wymaga admina", async () => {
    // Zmierzony fakt, nie defekt bezpieczeństwa: `isStaff` w layoucie obejmuje
    // też `author`, a `admin_revoke_profile_badge` żąda `admin`/`super_admin`.
    // Autor zobaczy więc kosz i dostanie toast błędu z bazy (test wyżej).
    h.fetchBadges.mockResolvedValue([badgeRow()]);
    await mountBadges();
    expect(
      await screen.findByRole("button", { name: t("adminCommunity.badges.revokeBadge") }),
    ).toBeInTheDocument();
    const migracja = readFileSync(
      "supabase/migrations/20260803095150_6d9df3b2-518b-47a1-8d3c-2e947eeda4a2.sql",
      "utf8",
    );
    expect(migracja).toMatch(/profile_badges: admin role required/);
  });
});

describe("/admin/community/badges - dostępność", () => {
  it("KONTROLA DODATNIA: to SĄ dzisiejsze naruszenia axe tego panelu", async () => {
    h.fetchBadges.mockResolvedValue([badgeRow()]);
    const { container } = await mountBadges();
    await screen.findByText("Zofia Wilk");

    // Ten test trzyma STAN FAKTYCZNY, żeby `it.fails` niżej nie był workiem na
    // dowolną nową regresję: kolejne, INNE naruszenie oblewa właśnie ten test.
    const violations = await axeViolations(container);
    expect([...new Set(violations.map((violation) => violation.id))].sort()).toEqual([
      "aria-required-parent",
      "button-name",
    ]);
  });

  it.fails("DEFEKT: panel odznak ma naruszenia axe", async () => {
    // DWA naruszenia, oba realne dla czytnika ekranu i oba spoza tej trasy,
    // ale to ta trasa je serwuje:
    //   * `button-name` - `SelectTrigger` droplisty rodzaju odznaki jest
    //     `<button role="combobox">` bez `aria-label`, a `combobox` NIE bierze
    //     nazwy z treści. Czytnik ogłasza „lista rozwijana", bez informacji,
    //     czego dotyczy; przy dwóch droplistach obok siebie
    //     (`/admin/community/contributors`) jest to nie do rozróżnienia.
    //   * `aria-required-parent` (5 węzłów) - `ProfileBadge` renderuje
    //     `role="listitem"` (`src/components/atoms/ProfileBadge.tsx`), a tu stoi
    //     w kafelku katalogu i w wierszu listy, czyli POZA `role="list"`.
    //     Osierocony `listitem` jest w drzewie dostępności pozycją listy, której
    //     nie ma - czytnik ogłasza „element listy 1 z 1" dla każdej odznaki
    //     z osobna.
    // NIE naprawiam tego tutaj: `ProfileBadge` i `ui/select` są współdzielone
    // przez cały panel i publiczne profile, więc zmiana ich semantyki to osobna,
    // szersza robota niż pakiet trzech tras.
    h.fetchBadges.mockResolvedValue([badgeRow()]);
    const { container } = await mountBadges();
    await screen.findByText("Zofia Wilk");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

// ===========================================================================
// /admin/community/contributors
// ===========================================================================

describe("/admin/community/contributors - kolejka zgłoszeń", () => {
  it("head() ustawia tytuł karty", async () => {
    expect(routeHead(ContributorsRoute).meta).toContainEqual({
      title: "Contributors · Community · Admin",
    });
    const { meta } = await mountContributors();
    expect(meta()).toContainEqual({ title: "Contributors · Community · Admin" });
  });

  it("zgłoszenie pokazuje tytuł, pitch, język, status i notatkę redakcji", async () => {
    h.fetchSubmissions.mockResolvedValue([
      submission({
        editor_note: "Prosimy o skrócenie do 8 tysięcy znaków.",
        status: "approved",
        db_status: "accepted",
        reviewed_at: "2026-08-12T11:00:00.000Z",
      }),
    ]);
    await mountContributors();

    await screen.findByText("Reforma rynku energii - trzy scenariusze");
    expect(
      screen.getByText("Propozycja analizy skutków pakietu dla przemysłu energochłonnego."),
    ).toBeInTheDocument();
    expect(screen.getByText("PL")).toBeInTheDocument();
    expect(screen.getByText(t("adminCommunity.contributors.statusApproved"))).toBeInTheDocument();
    expect(screen.getByText("Prosimy o skrócenie do 8 tysięcy znaków.")).toBeInTheDocument();
    // Data recenzji odróżnia „leży od tygodnia" od „właśnie rozpatrzone".
    expect(screen.getByText(/Zrecenzowano/)).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: pusta kolejka mówi „brak zgłoszeń”", async () => {
    h.fetchSubmissions.mockResolvedValue([]);
    await mountContributors();
    expect(
      await screen.findByText(t("adminCommunity.contributors.noSubmissions")),
    ).toBeInTheDocument();
  });

  it.fails("DEFEKT: odmowa odczytu kolejki wygląda jak pusta kolejka", async () => {
    // KONSEKWENCJA: to jest kolejka MODERACYJNA. „Brak zgłoszeń" znaczy dla
    // redaktora „nie ma czego robić" i zamyka panel. Jeśli w rzeczywistości
    // odczyt padł (RLS, awaria, wygasła sesja), zgłoszenia autorów leżą
    // nierozpatrzone, a panel twierdzi, że kolejka jest czysta. Trasa nie
    // czyta `q.error` w ogóle, więc nie ma jak tego odróżnić.
    h.fetchSubmissions.mockRejectedValue(new Error("odmowa bazy"));
    await mountContributors();
    await waitFor(() => expect(h.fetchSubmissions).toHaveBeenCalled());

    await waitFor(() =>
      expect(
        screen.queryByText(t("adminCommunity.contributors.noSubmissions")),
        "awaria odczytu nie może udawać pustej kolejki",
      ).toBeNull(),
    );
  });

  it("stan ładowania jest osobnym komunikatem, nie pustką", async () => {
    let uwolnij: (rows: ContributorSubmissionView[]) => void = () => {};
    h.fetchSubmissions.mockImplementation(
      () =>
        new Promise<ContributorSubmissionView[]>((resolve) => {
          uwolnij = resolve;
        }),
    );
    await mountContributors();

    expect(screen.getByText(t("adminCommunity.contributors.loading"))).toBeInTheDocument();
    expect(screen.queryByText(t("adminCommunity.contributors.noSubmissions"))).toBeNull();
    uwolnij([]);
    await screen.findByText(t("adminCommunity.contributors.noSubmissions"));
  });
});

describe("/admin/community/contributors - filtry sterują ZAPYTANIEM", () => {
  it("domyślnie pyta o kolejkę oczekujących, we wszystkich językach", async () => {
    await mountContributors();
    await waitFor(() => expect(h.fetchSubmissions).toHaveBeenCalledWith("pending", "all"));
  });

  it("zmiana statusu wysyła NOWE zapytanie, nie filtruje w przeglądarce", async () => {
    await mountContributors();
    await waitFor(() => expect(h.fetchSubmissions).toHaveBeenCalledTimes(1));

    await pickInSelect(
      t("adminCommunity.contributors.statusPending"),
      t("adminCommunity.contributors.statusApproved"),
    );

    // Filtrowanie po stronie klienta na limicie 200 wierszy gubiłoby starsze
    // zgłoszenia bez śladu, więc to zapytanie MUSI pojechać do bazy.
    await waitFor(() => expect(h.fetchSubmissions).toHaveBeenCalledWith("approved", "all"));
  });

  it("zmiana języka też przechodzi do zapytania", async () => {
    await mountContributors();
    await waitFor(() => expect(h.fetchSubmissions).toHaveBeenCalledTimes(1));

    await pickInSelect(t("adminCommunity.contributors.allLanguages"), "PL");

    await waitFor(() => expect(h.fetchSubmissions).toHaveBeenCalledWith("pending", "pl"));
  });

  it("filtr „wszystkie” jest osobną wartością, nie brakiem filtra", async () => {
    await mountContributors();
    await pickInSelect(
      t("adminCommunity.contributors.statusPending"),
      t("adminCommunity.contributors.all"),
    );
    await waitFor(() => expect(h.fetchSubmissions).toHaveBeenCalledWith("all", "all"));
  });
});

describe("/admin/community/contributors - decyzja redakcji", () => {
  it("akceptacja niesie notatkę i unieważnia kolejkę ORAZ licznik zaangażowania", async () => {
    h.fetchSubmissions.mockResolvedValue([submission()]);
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mountContributors(queryClient);
    await screen.findByText("Reforma rynku energii - trzy scenariusze");

    fireEvent.change(
      screen.getByPlaceholderText(t("adminCommunity.contributors.editorNoteOptional")),
      { target: { value: "Przyjęte do numeru jesiennego." } },
    );
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.contributors.approve") }));

    await waitFor(() =>
      expect(h.reviewSubmission).toHaveBeenCalledWith(
        "sub-1",
        "approved",
        "Przyjęte do numeru jesiennego.",
      ),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-contributors"] }),
    );
    // Licznik „zgłoszenia czekające" na pulpicie zaangażowania liczy dokładnie
    // te wiersze - bez tego unieważnienia pokazywałby rozpatrzone jako czekające.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-engagement-snapshot"] });
    expect(h.toasts).toContainEqual({
      kind: "success",
      text: t("adminCommunity.contributors.saved"),
    });
  });

  it("KONTROLA DODATNIA: odrzucenie dojeżdża do warstwy danych (przycisk nie jest martwy)", async () => {
    h.fetchSubmissions.mockResolvedValue([submission()]);
    await mountContributors();
    await screen.findByText("Reforma rynku energii - trzy scenariusze");

    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.contributors.reject") }));

    await waitFor(() =>
      expect(h.reviewSubmission).toHaveBeenCalledWith("sub-1", "rejected", undefined),
    );
  });

  it.fails("DEFEKT: odrzucenie zgłoszenia nie pyta o potwierdzenie", async () => {
    // KONSEKWENCJA: przyciski decyzji renderują się WYŁĄCZNIE dla wierszy
    // `pending` (asercja niżej to utrwala), więc po kliknięciu „Odrzuć" nie ma
    // z tego panelu żadnej drogi powrotnej - wiersz przestaje mieć akcje.
    // „Akceptuj" i „Odrzuć" stoją obok siebie, mają ten sam rozmiar i dzielą
    // ten sam obszar kliknięcia w gęstej liście. Odbieranie odznaki (operacja
    // porównywalnie nieodwracalna) w tym samym module MA `confirmDialog`,
    // więc wzorzec jest dostępny i spójność go wymaga.
    h.fetchSubmissions.mockResolvedValue([submission()]);
    await mountContributors();
    await screen.findByText("Reforma rynku energii - trzy scenariusze");

    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.contributors.reject") }));

    await waitFor(() => expect(h.reviewSubmission).toHaveBeenCalled());
    expect(h.confirmCalls, "odrzucenie bez drogi powrotu musi pytać").toHaveLength(1);
  });

  it("wiersz już rozpatrzony NIE MA przycisków decyzji ani pola notatki", async () => {
    h.fetchSubmissions.mockResolvedValue([
      submission({ status: "rejected", db_status: "rejected", editor_note: "Poza zakresem." }),
    ]);
    await mountContributors();
    await screen.findByText("Reforma rynku energii - trzy scenariusze");

    expect(
      screen.queryByRole("button", { name: t("adminCommunity.contributors.approve") }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: t("adminCommunity.contributors.reject") }),
    ).toBeNull();
    expect(
      screen.queryByPlaceholderText(t("adminCommunity.contributors.editorNoteOptional")),
    ).toBeNull();
  });

  it("notatki są prowadzone PER WIERSZ, nie wspólnie", async () => {
    h.fetchSubmissions.mockResolvedValue([
      submission(),
      submission({ id: "sub-2", title: "Drugi pitch", pitch: "Krótka propozycja." }),
    ]);
    await mountContributors();
    await screen.findByText("Drugi pitch");

    const pola = screen.getAllByPlaceholderText(
      t("adminCommunity.contributors.editorNoteOptional"),
    );
    fireEvent.change(pola[1], { target: { value: "Notatka do drugiego" } });

    // Wspólny stan notatki wysłałby uzasadnienie odrzucenia jednego zgłoszenia
    // razem z akceptacją innego.
    expect(pola[0]).toHaveValue("");
    expect(pola[1]).toHaveValue("Notatka do drugiego");

    fireEvent.click(
      screen.getAllByRole("button", { name: t("adminCommunity.contributors.approve") })[1],
    );
    await waitFor(() =>
      expect(h.reviewSubmission).toHaveBeenCalledWith("sub-2", "approved", "Notatka do drugiego"),
    );
  });

  it("odmowa zapisu decyzji kończy się toastem błędu", async () => {
    h.fetchSubmissions.mockResolvedValue([submission()]);
    h.reviewSubmission.mockRejectedValue(new Error("odmowa bazy"));
    await mountContributors();
    await screen.findByText("Reforma rynku energii - trzy scenariusze");

    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.contributors.approve") }));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: t("adminCommunity.contributors.failed"),
      }),
    );
  });
});

describe("/admin/community/contributors - widoczność wierszy i granica dowodu", () => {
  it("trasa nie zna żadnego warunku zgody ani roli - decydują filtry i RLS", () => {
    // Zlecenie mówiło o „opt-inie do katalogu". W tej trasie takiego pojęcia
    // NIE MA i nie ma go też w tabeli (`contributor_submissions` nie ma kolumny
    // zgody). O tym, co widać, decydują dwa filtry UI i polityki RLS.
    const zrodlo = readFileSync("src/routes/admin.community.contributors.tsx", "utf8");
    expect(zrodlo).not.toMatch(/consent|opt_?in|isStaff|isAdmin|useAuth/i);
    expect(zrodlo).toMatch(/fetchContributorSubmissions\(status, language\)/);

    const warstwa = readFileSync("src/lib/admin/community.ts", "utf8");
    expect(warstwa).toMatch(/from\("contributor_submissions"\)/);
    // Brak `eq("tenant_id", ...)` to nie przeoczenie: tenant wynika z polityki
    // `submissions staff read`, a klient nie ma go czym podmienić.
    expect(warstwa).not.toMatch(/contributor_submissions[\s\S]{0,400}eq\("tenant_id"/);

    const migracja = readFileSync(
      "supabase/migrations/20260713097000_polls_contributor_program.sql",
      "utf8",
    );
    expect(migracja).toMatch(/CREATE POLICY "submissions staff read"/);
    expect(migracja).toMatch(/tenant_id = \(SELECT public\.current_tenant_id\(\)\)/);
  });

  it("klucz cache kolejki NIE zawiera tenanta (zmierzony fakt, granica opisana)", async () => {
    const { queryClient } = await mountContributors();
    await waitFor(() => expect(h.fetchSubmissions).toHaveBeenCalled());

    const klucze = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    // Nie jest to dziś eksploatowalne (tenant wynika z profilu, a wylogowanie
    // czyści cache), ale jest to różnica wobec trasy odznak i tak ją raportuję.
    expect(klucze).toContainEqual(["admin-contributors", "pending", "all"]);
  });
});

describe("/admin/community/contributors - dostępność", () => {
  it("KONTROLA DODATNIA: jedyne dzisiejsze naruszenie to nienazwane droplisty", async () => {
    h.fetchSubmissions.mockResolvedValue([submission()]);
    const { container } = await mountContributors();
    await screen.findByText("Reforma rynku energii - trzy scenariusze");

    const violations = await axeViolations(container);
    expect(violations.map((violation) => violation.id)).toEqual(["button-name"]);
    // DWA węzły, bo obie droplisty filtrów są bezimienne.
    expect(violations[0].nodes).toHaveLength(2);
  });

  it.fails("DEFEKT: filtry kolejki to droplisty bez nazwy dostępnej", async () => {
    // KONSEKWENCJA: `role="combobox"` nie bierze nazwy z treści, a żaden z tych
    // dwóch triggerów nie ma `aria-label`. Czytnik ekranu ogłasza dwie
    // identyczne „listy rozwijane" stojące obok siebie - jedna filtruje po
    // JĘZYKU, druga po STATUSIE, i nie da się ich rozróżnić inaczej niż
    // zgadując po bieżącej wartości. To jest ta sama przyczyna, dla której
    // `pickInSelect` w tym pliku szuka triggera po widocznym tekście.
    h.fetchSubmissions.mockResolvedValue([submission()]);
    const { container } = await mountContributors();
    await screen.findByText("Reforma rynku energii - trzy scenariusze");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

// ===========================================================================
// /admin/community/engagement
// ===========================================================================

describe("/admin/community/engagement - liczby i ich odniesienia", () => {
  it("head() ustawia tytuł karty", async () => {
    expect(routeHead(EngagementRoute).meta).toContainEqual({
      title: "Engagement · Community · Admin",
    });
    const { meta } = await mountEngagement();
    expect(meta()).toContainEqual({ title: "Engagement · Community · Admin" });
  });

  it("kafelki pokazują liczby z RPC, a aktywni także UDZIAŁ w bazie członków", async () => {
    await mountEngagement();

    await waitFor(() => expect(statValue(t("adminCommunity.engagement.total"))).toBe("200"));
    expect(statValue(t("adminCommunity.engagement.new30d"))).toBe("18");
    // Sama liczba aktywnych nic nie mówi bez mianownika: 50 z 200 to inny
    // wniosek niż 50 z 5000, a panel ma odpowiadać na „czy społeczność żyje".
    expect(statValue(t("adminCommunity.engagement.active7d"))).toBe("50 (25%)");
    expect(statValue(t("adminCommunity.engagement.active30d"))).toBe("120 (60%)");
    expect(statValue(t("adminCommunity.engagement.activeSubscriptions"))).toBe("44");
    expect(statValue(t("adminCommunity.engagement.webPush"))).toBe("61");
    expect(statValue(t("adminCommunity.engagement.emailDigest"))).toBe("88");
    expect(statValue(t("adminCommunity.engagement.upcomingEvents"))).toBe("5");
    expect(statValue(t("adminCommunity.engagement.rsvpsGoing"))).toBe("73");
    expect(statValue(t("adminCommunity.engagement.openQQuestions"))).toBe("9");
    expect(statValue(t("adminCommunity.engagement.pollVotes30d"))).toBe("240");
    expect(statValue(t("adminCommunity.engagement.pendingPitches"))).toBe("3");
    expect(statValue(t("adminCommunity.engagement.trackerFollows"))).toBe("156");
  });

  it("pusty mianownik NIE produkuje „NaN%” ani „Infinity%”", async () => {
    h.fetchEngagement.mockResolvedValue(
      overview({ members_total: 0, active_7d: 0, active_30d: 4 }),
    );
    await mountEngagement();

    await waitFor(() => expect(statValue(t("adminCommunity.engagement.total"))).toBe("0"));
    expect(statValue(t("adminCommunity.engagement.active7d"))).toBe("0");
    // Dzielenie przez zero na świeżym tenancie jest stanem NORMALNYM, nie awarią.
    expect(statValue(t("adminCommunity.engagement.active30d"))).toBe("4");
  });

  it("rozkład warstw jest posortowany malejąco i pokazuje liczności", async () => {
    h.fetchEngagement.mockResolvedValue(
      overview({ tier_distribution: { student: 5, vip: 40, standard: 12 } }),
    );
    const { container } = await mountEngagement();
    await waitFor(() => expect(statValue(t("adminCommunity.engagement.total"))).toBe("200"));

    const paski = Array.from(container.querySelectorAll("li")).filter((li) =>
      /^(vip|standard|student)/.test(li.textContent ?? ""),
    );
    // Kolejność jest treścią: pierwsza pozycja to warstwa, która niesie
    // najwięcej członków, a nie ta, która była pierwsza w jsonie.
    expect(paski.map((li) => li.textContent)).toEqual(["vip40", "standard12", "student5"]);
  });

  it("brak płatnych warstw mówi to wprost", async () => {
    h.fetchEngagement.mockResolvedValue(overview({ tier_distribution: {} }));
    await mountEngagement();
    expect(
      await screen.findByText(t("adminCommunity.engagement.noActivePaidSubscriptions")),
    ).toBeInTheDocument();
  });

  it("najbliższe wydarzenia linkują do strony publicznej i podają liczbę RSVP", async () => {
    await mountEngagement();

    const link = await screen.findByRole("link", { name: "Brukselski briefing jesienny" });
    // Panel ma prowadzić do wydarzenia jednym kliknięciem - inaczej operator
    // szuka slugu ręcznie w katalogu.
    expect(link).toHaveAttribute("href", "/events/brukselski-briefing-jesienny");
    expect(screen.getByText(`42 ${t("adminCommunity.engagement.going")}`)).toBeInTheDocument();
  });

  it("brak tytułu w języku UI spada na drugi język, a brak obu na slug", async () => {
    h.fetchEngagement.mockResolvedValue(
      overview({
        top_upcoming_events: [
          {
            slug: "energy-roundtable",
            title_pl: null,
            title_en: "Energy roundtable",
            starts_at: "2026-10-01T09:00:00.000Z",
            going: 3,
          },
          {
            slug: "bez-tytulu",
            title_pl: null,
            title_en: null,
            starts_at: "2026-10-02T09:00:00.000Z",
            going: 1,
          },
        ],
      }),
    );
    await mountEngagement();

    // Pusty wiersz z samą datą jest w tej liście bezużyteczny.
    expect(await screen.findByRole("link", { name: "Energy roundtable" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "bez-tytulu" })).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: brak nadchodzących wydarzeń mówi to wprost", async () => {
    h.fetchEngagement.mockResolvedValue(overview({ top_upcoming_events: [] }));
    await mountEngagement();
    expect(
      await screen.findByText(t("adminCommunity.engagement.noPublishedUpcomingEvents")),
    ).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: po odmowie odczytu LICZBY degradują się do „-”", async () => {
    h.fetchEngagement.mockRejectedValue(new Error("odmowa bazy"));
    await mountEngagement();
    await screen.findByText(t("adminCommunity.engagement.total"));

    // Ta połowa działa poprawnie i to ona pokazuje, że `it.fails` niżej nie
    // gaśnie na braku renderu, tylko na treści zdania obok.
    expect(statValue(t("adminCommunity.engagement.total"))).toBe("-");
    expect(statValue(t("adminCommunity.engagement.active7d"))).toBe("-");
    expect(statValue(t("adminCommunity.engagement.trackerFollows"))).toBe("-");
  });

  it.fails(
    "DEFEKT: po odmowie odczytu panel TWIERDZI, że nie ma wydarzeń i subskrypcji",
    async () => {
      // KONSEKWENCJA: kafelki degradują się uczciwie do „-", ale dwa zdania obok
      // nich mówią co innego: „Brak opublikowanych nadchodzących wydarzeń."
      // i „Brak aktywnych subskrypcji płatnych.". To nie są puste pola, tylko
      // TWIERDZENIA o stanie tenanta, wypowiedziane wtedy, gdy panel nie wie nic.
      // Warunek brzmi `!s || s.top_upcoming_events.length === 0`, czyli brak
      // danych jest sklejony z pustką - w tym samym widoku, w którym obok
      // zastosowano poprawne „-".
      h.fetchEngagement.mockRejectedValue(new Error("odmowa bazy"));
      await mountEngagement();
      await screen.findByText(t("adminCommunity.engagement.total"));

      expect(
        screen.queryByText(t("adminCommunity.engagement.noPublishedUpcomingEvents")),
        "awaria odczytu nie może twierdzić, że kalendarz jest pusty",
      ).toBeNull();
    },
  );
});

describe("/admin/community/engagement - okno czasowe i tenant", () => {
  it("okna 7/30 dni są PODPISANE na kafelkach", async () => {
    await mountEngagement();
    // Liczba bez okna jest nieinterpretowalna, a te okna są jedynym, co
    // odróżnia „aktywni" od „wszyscy".
    await screen.findByText(t("adminCommunity.engagement.active7d"));
    expect(screen.getByText(t("adminCommunity.engagement.active30d"))).toBeInTheDocument();
    expect(screen.getByText(t("adminCommunity.engagement.new30d"))).toBeInTheDocument();
    expect(screen.getByText(t("adminCommunity.engagement.pollVotes30d"))).toBeInTheDocument();
  });

  it("okna są ZASZYTE W SQL - z UI nie da się zmienić zakresu dni", () => {
    // Zlecenie zakładało „zmianę zakresu dni". Takiego sterowania w tej trasie
    // NIE MA i nie da się go dołożyć bez zmiany RPC: funkcja nie przyjmuje
    // argumentów, a interwały są stałymi w zapytaniu.
    const zrodlo = readFileSync("src/routes/admin.community.engagement.tsx", "utf8");
    expect(zrodlo).not.toMatch(/useState|validateSearch|useSearch/);
    expect(zrodlo).toMatch(/queryKey: \["admin-engagement-overview"\]/);

    const warstwa = readFileSync("src/lib/admin/community.ts", "utf8");
    expect(warstwa).toMatch(/rpc\("get_engagement_overview"\)/);

    const migracja = readFileSync(
      "supabase/migrations/20260713099000_engagement_overview.sql",
      "utf8",
    );
    expect(migracja).toMatch(/FUNCTION public\.get_engagement_overview\(\)/);
    expect(migracja).toMatch(/interval '7 days'/);
    expect(migracja).toMatch(/interval '30 days'/);
  });

  it("tenant nie idzie z przeglądarki - RPC bierze go z sesji i sam sprawdza rolę", () => {
    const migracja = readFileSync(
      "supabase/migrations/20260713099000_engagement_overview.sql",
      "utf8",
    );
    expect(migracja).toMatch(/SECURITY DEFINER/);
    expect(migracja).toMatch(/v_tenant uuid := public\.current_tenant_id\(\);/);
    expect(migracja).toMatch(/has_role\(v_user, 'admin'::app_role\)/);
  });

  it("stopka panelu mówi, skąd są dane i dokąd iść po analitykę", async () => {
    await mountEngagement();
    // Bez tego zdania panel wygląda na pełną analitykę, którą nie jest -
    // i ktoś podejmuje decyzję o kampanii na sześciu kafelkach.
    expect(
      await screen.findByText(t("adminCommunity.engagement.dataFromGetEngagement")),
    ).toBeInTheDocument();
  });
});

describe("/admin/community/engagement - dostępność", () => {
  // Ten panel nie ma ani droplisty, ani `ProfileBadge`, więc przechodzi czysto -
  // i tym samym jest kontrolą dodatnią dla dwóch `it.fails` wyżej: sam harness
  // axe w tym pliku potrafi oddać pustą listę naruszeń.
  it("panel nie ma naruszeń axe", async () => {
    const { container } = await mountEngagement();
    await screen.findByText(t("adminCommunity.engagement.total"));

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

// ===========================================================================
// WSPÓLNA BRAMKA UPRAWNIEŃ. Patrz USTALENIE w nagłówku pliku.
// ===========================================================================

describe("panel społeczności - gdzie stoi bramka roli sztabowej", () => {
  it("żadna z trzech tras nie bramkuje dostępu sama", () => {
    for (const plik of [
      "src/routes/admin.community.badges.tsx",
      "src/routes/admin.community.contributors.tsx",
      "src/routes/admin.community.engagement.tsx",
    ]) {
      const zrodlo = readFileSync(plik, "utf8");
      expect(zrodlo, plik).not.toMatch(/isStaff|isAdmin|isSuperAdmin/);
      expect(zrodlo, plik).not.toMatch(/beforeLoad|redirect\(|<Navigate/);
    }
  });

  it("layout `/admin/community` też nie dokłada warunku roli", () => {
    const layout = readFileSync("src/routes/admin.community.tsx", "utf8");
    expect(layout).not.toMatch(/isStaff|isAdmin|useAuth|redirect\(/);
  });

  it("bramka renderu żyje w layoucie `/admin` i prowadzi na /login", () => {
    // Odczyt pliku, nie render: layout jest RODZICEM tych tras, a harness
    // montuje pojedynczą trasę pod zastępczym korzeniem.
    const layout = readFileSync("src/routes/admin.tsx", "utf8");
    expect(layout).toMatch(/isStaff/);
    expect(layout).toMatch(/navigate\(\{\s*to:\s*"\/login"\s*\}\)/);
    expect(layout).toMatch(/if \(!session \|\| !isStaff\) return null;/);
  });

  it("wszystkie trzy renderują się bez sesji - bramki tu nie ma i nie udajemy, że jest", async () => {
    h.auth = { tenantId: TENANT };
    await mountBadges();
    expect(
      screen.getByRole("heading", { name: t("adminCommunity.badges.badges") }),
    ).toBeInTheDocument();
    cleanup();

    await mountContributors();
    expect(
      screen.getByRole("heading", { name: t("adminCommunity.contributors.contributors") }),
    ).toBeInTheDocument();
    cleanup();

    await mountEngagement();
    expect(
      screen.getByRole("heading", { name: t("adminCommunity.engagement.engagementConversion") }),
    ).toBeInTheDocument();
  });
});
