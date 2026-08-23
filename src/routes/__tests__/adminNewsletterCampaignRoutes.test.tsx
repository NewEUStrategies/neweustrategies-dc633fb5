// Trzy trasy rodziny `/admin/newsletter/campaigns/*` ZAMONTOWANE.
//
// DLACZEGO AKURAT TE TRASY, A NIE „każda trasa panelu”. Bramka
// `adminRouteAuthority.gate.test.ts` argumentuje wprost, że render-testowanie
// tras panelu dla samego pokrycia jest farmą, bo ryzyko w trasie panelu to
// DOSTĘP - a dostępu pilnuje wspólny layout `/admin` (`isStaff`). Ten plik
// pokrywa to, czego bramka celowo nie dotyka, i akurat tutaj nie jest to
// kosmetyka: MAILA NIE DA SIĘ WYCOFAĆ. Cztery decyzje mieszkają wyłącznie
// w tych plikach tras i nigdzie indziej:
//
//  1. KONWERSJA HARMONOGRAMU W OBIE STRONY. `isoToLocalInput` /
//     `localInputToIso` tłumaczą między UTC w bazie a czasem lokalnym w polu
//     `datetime-local`. Pomyłka o godzinę = wysyłka o złej godzinie do
//     WSZYSTKICH odbiorców. Obie funkcje są prywatne, więc dosięgamy ich
//     jedyną uczciwą drogą: przez pole formularza i przez ładunek zapisu.
//  2. HARMONOGRAM W PRZESZŁOŚCI. Data wcześniejsza niż „teraz" powinna zostać
//     odrzucona PRZED zapisem - zaplanowana wstecz kampania jest natychmiast
//     zaległa i wychodzi przy najbliższym ticku, bez decyzji człowieka.
//  3. ZAPIS KAMPANII JUŻ WYSŁANEJ. Edycja treści po wysyłce nie zmienia tego,
//     co ludzie dostali, ale zmienia to, co widzi redakcja - czyli kasuje
//     dowód, co właściwie poszło.
//  4. WZNOWIENIE. Przycisk „wznów" przy kampanii, która się SKOŃCZYŁA, to
//     WYSYŁKA PODWÓJNA - najgorszy defekt tego modułu. Lista kampanii
//     rozstrzyga to jednym predykatem (`isResumableSending`) i to on decyduje,
//     komu ten przycisk w ogóle się pokaże.
//
// STREFA CZASOWA JEST USTAWIANA JAWNIE. Bez tego test przechodzi na maszynie
// w Warszawie i pada na runnerze w UTC (albo, gorzej, odwrotnie: przechodzi
// w UTC, bo tam konwersja jest tożsamością, i nie dowodzi niczego). Każdy
// przypadek konwersji biegnie na STAŁEJ dacie i JAWNEJ strefie.
//
// CZEGO TEN PLIK NIE DUBLUJE: reguł serwerowych (`newsletter-campaigns.
// functions.ts` ma trzy własne pliki testowe), kreatora treści
// (`CampaignContentBuilder.test.tsx`) ani kafla automatu wysyłki
// (`JobRunnerCard.test.tsx`) - tu są atrapami-markerami.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

/** Kampania w kształcie, w jakim czyta ją trasa (podzbiór `CampaignRow`). */
interface KampaniaTestowa {
  id: string;
  tenant_id: string;
  name: string;
  subject_pl: string;
  subject_en: string;
  html_pl: string;
  html_en: string;
  editor: string;
  content_doc: unknown;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  audience_filter: Record<string, unknown>;
  status: string;
  scheduled_at: string | null;
  lease_until: string | null;
  started_at: string | null;
  finished_at: string | null;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface WynikWysylki {
  ok: true;
  sent: number;
  failed: number;
  done: boolean;
  remaining: number;
}

const env = vi.hoisted(() => ({
  /** `undefined` = zapytanie wciąż w locie. */
  campaign: undefined as unknown,
  campaignRejects: null as string | null,
  campaignPending: false,
  savePayloads: [] as Record<string, unknown>[],
  saveError: null as string | null,
  sendCalls: [] as Record<string, unknown>[],
  sendResults: [] as unknown[],
  sendError: null as string | null,
  testCalls: [] as Record<string, unknown>[],
  testError: null as string | null,
  countCalls: [] as unknown[],
  audience: 128,
  listRows: [] as unknown[],
  listRejects: null as string | null,
  listPending: false,
  deleteCalls: [] as string[],
  deleteError: null as string | null,
  createResult: { id: "nowa-kampania" },
  processDueCalls: 0,
  processDueError: null as string | null,
  processDuePending: false,
  sendPending: false,
  tiers: [
    { key: "friend", rank: 10, name_pl: "Przyjaciel", name_en: "Friend" },
    { key: "member", rank: 20, name_pl: "Członek", name_en: "Member" },
    { key: "gosc", rank: 0, name_pl: "Gość", name_en: "Guest" },
  ] as { key: string; rank: number; name_pl: string; name_en: string }[] | undefined,
  processDueResult: { fired: 0, continued: 0, sent: 0 } as {
    fired: number;
    continued: number;
    sent: number;
  },
  navigations: [] as { to: string; params?: Record<string, unknown> }[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-newsletter-admin", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({
  toast: { success: env.toastSuccess, error: env.toastError, info: env.toastInfo },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    // Edytor wraca strzałką na listę, a lista przenosi do świeżo utworzonej
    // kampanii - obie nawigacje są przedmiotem dowodu, a docelowych tras nie
    // ma w drzewie harnessu (montujemy jedną trasę naraz).
    useNavigate: () => (options: { to: string; params?: Record<string, unknown> }) => {
      env.navigations.push(options);
      return Promise.resolve();
    },
    Link: ({
      to,
      params,
      children,
      ...rest
    }: {
      to: string;
      params?: Record<string, string>;
      children?: ReactNode;
      className?: string;
    }) => (
      <a
        href={Object.entries(params ?? {}).reduce(
          (path, [key, value]) => path.replace(`$${key}`, value),
          to,
        )}
        className={rest.className}
      >
        {children}
      </a>
    ),
  };
});
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: { kind?: string }) => async (input?: { data?: Record<string, unknown> }) => {
    switch (fn.kind) {
      case "getCampaign":
        if (env.campaignPending) return new Promise(() => undefined);
        if (env.campaignRejects) throw new Error(env.campaignRejects);
        return env.campaign;
      case "engagement":
        return { opens: 0, clicks: 0, uniqueOpens: 0, uniqueClicks: 0 };
      case "upsert":
        if (env.saveError) throw new Error(env.saveError);
        env.savePayloads.push(input?.data ?? {});
        return env.createResult;
      case "count":
        env.countCalls.push(input?.data);
        return { count: env.audience };
      case "test":
        env.testCalls.push(input?.data ?? {});
        if (env.testError) throw new Error(env.testError);
        return { ok: true };
      case "send": {
        env.sendCalls.push(input?.data ?? {});
        if (env.sendPending) return new Promise(() => undefined);
        if (env.sendError) throw new Error(env.sendError);
        const next = env.sendResults.shift();
        return (next ?? { ok: true, sent: 1, failed: 0, done: true, remaining: 0 }) as WynikWysylki;
      }
      case "list":
        if (env.listPending) return new Promise(() => undefined);
        if (env.listRejects) throw new Error(env.listRejects);
        return env.listRows;
      case "delete":
        env.deleteCalls.push(String(input?.data?.id ?? ""));
        if (env.deleteError) throw new Error(env.deleteError);
        return { ok: true };
      case "processDue":
        env.processDueCalls += 1;
        if (env.processDuePending) return new Promise(() => undefined);
        if (env.processDueError) throw new Error(env.processDueError);
        return env.processDueResult;
      default:
        throw new Error(`test: nieznana funkcja serwerowa ${String(fn.kind)}`);
    }
  },
}));
vi.mock("@/lib/newsletter-campaigns.functions", () => ({
  getCampaign: { kind: "getCampaign" },
  getCampaignEngagement: { kind: "engagement" },
  upsertCampaign: { kind: "upsert" },
  countCampaignAudience: { kind: "count" },
  sendCampaignTest: { kind: "test" },
  sendCampaign: { kind: "send" },
  listCampaigns: { kind: "list" },
  deleteCampaign: { kind: "delete" },
  processDueCampaigns: { kind: "processDue" },
  readAudienceFilter: (raw: unknown) =>
    raw !== null && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {},
}));
vi.mock("@/lib/billing/tiers", () => ({
  useMembershipTiers: () => ({ data: env.tiers }),
  tierName: (tier: { name_pl: string; name_en: string }, lang: string) =>
    lang === "en" ? tier.name_en : tier.name_pl,
}));
vi.mock("@/components/admin/newsletter/CampaignContentBuilder", () => ({
  CampaignContentBuilder: ({ onChange }: { onChange: (doc: unknown) => void }) => (
    <button
      type="button"
      data-testid="kreator-tresci"
      onClick={() => onChange({ version: 1, blocks: [], style: {} })}
    >
      kreator
    </button>
  ),
}));
vi.mock("@/components/admin/newsletter/molecules/CampaignEngagementCard", () => ({
  CampaignEngagementCard: () => <div data-testid="kafel-zaangazowania" />,
}));
vi.mock("@/components/admin/newsletter/runner/JobRunnerCard", () => ({
  JobRunnerCard: () => <div data-testid="kafel-automatu" />,
}));
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    disabled,
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      checked={checked === true}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));
// Radix Select i Tabs nie działają pod happy-dom bez pełnego pointer API.
// Przedmiotem dowodu jest to, KTÓRE opcje trasa wystawia i co robi ze zmianą.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    disabled?: boolean;
    children?: ReactNode;
  }) => (
    <select
      data-testid="wybor"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  TabsContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
// Dialog potwierdzenia: treść renderuje się, gdy `open` nie jest jawnie
// wyłączone. Dzięki temu widać ZARÓWNO wyzwalacz (dialog niekontrolowany),
// JAK I to, czy dialog ryzyka reputacyjnego się otworzył (kontrolowany).
vi.mock("@/components/ui/alert-dialog", () => {
  const Fragment = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: ReactNode;
    }) =>
      open === false ? null : (
        <div data-testid="dialog">
          {onOpenChange ? (
            <button type="button" data-testid="dialog-zamknij" onClick={() => onOpenChange(false)}>
              zamknij
            </button>
          ) : null}
          {children}
        </div>
      ),
    AlertDialogTrigger: Fragment,
    AlertDialogContent: Fragment,
    AlertDialogHeader: Fragment,
    AlertDialogFooter: Fragment,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => (
      <button type="button">{children}</button>
    ),
    AlertDialogAction: ({ onClick, children }: { onClick?: () => void; children?: ReactNode }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

import { renderRoute } from "@/test/routeHarness";
import { Route as DetailRoute } from "@/routes/admin.newsletter.campaigns.$id";
import { Route as ListRoute } from "@/routes/admin.newsletter.campaigns.index";
import { Route as LayoutRoute } from "@/routes/admin.newsletter.campaigns";

const CAMPAIGN_ID = "11111111-2222-3333-4444-555555555555";
/** Stała data bazowa - „przeszłość" i „przyszłość" mają być powtarzalne. */
const TERAZ = new Date("2026-08-22T10:00:00.000Z");

function kampania(overrides: Partial<KampaniaTestowa> = {}): KampaniaTestowa {
  return {
    id: CAMPAIGN_ID,
    tenant_id: "tenant-1",
    name: "Sierpniowy przegląd",
    subject_pl: "Temat PL",
    subject_en: "Subject EN",
    html_pl: "<p>PL</p>",
    html_en: "<p>EN</p>",
    editor: "html",
    content_doc: null,
    from_name: "NES",
    from_email: "biuro@example.test",
    reply_to: null,
    audience_filter: {},
    status: "draft",
    scheduled_at: null,
    lease_until: null,
    started_at: null,
    finished_at: null,
    recipient_count: 0,
    sent_count: 0,
    failed_count: 0,
    last_error: null,
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-08-01T08:00:00.000Z",
    ...overrides,
  };
}

/** Wiersz listy kampanii. */
function wiersz(overrides: Partial<KampaniaTestowa> = {}): KampaniaTestowa {
  return kampania({ name: "Kampania", ...overrides });
}

let zapisanaStrefa: string | undefined;

/** Jawna strefa czasowa - bez tego test mierzy strefę runnera, nie konwersję. */
function wStrefie(tz: string): void {
  process.env.TZ = tz;
}

async function zamontujEdytor() {
  const utils = await renderRoute({
    route: DetailRoute,
    path: "/admin/newsletter/campaigns/$id",
    initialEntry: `/admin/newsletter/campaigns/${CAMPAIGN_ID}`,
  });
  await screen.findByText("adminNewsletter.campaigns.settingsHeading");
  return utils;
}

async function zamontujListe() {
  const utils = await renderRoute({
    route: ListRoute,
    path: "/admin/newsletter/campaigns/",
    initialEntry: "/admin/newsletter/campaigns",
  });
  await screen.findByText("adminNewsletter.campaigns.listHeading");
  return utils;
}

/** Pole harmonogramu jako element formularza. */
function poleHarmonogramu(): HTMLInputElement {
  const pole = screen.getByLabelText("adminNewsletter.campaigns.scheduleSend");
  if (!(pole instanceof HTMLInputElement))
    throw new Error("test: pole harmonogramu nie jest inputem");
  return pole;
}

function przyciskZapisu(): HTMLButtonElement {
  const przycisk = screen.getByRole("button", { name: /saveChanges/ });
  if (!(przycisk instanceof HTMLButtonElement)) throw new Error("test: brak przycisku zapisu");
  return przycisk;
}

/** Ostatni ładunek przekazany do serwerowego zapisu kampanii. */
async function zapisz(): Promise<Record<string, unknown>> {
  fireEvent.click(przyciskZapisu());
  await waitFor(() => expect(env.savePayloads.length).toBeGreaterThan(0));
  return env.savePayloads.at(-1) ?? {};
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(TERAZ);
  zapisanaStrefa = process.env.TZ;
  wStrefie("Europe/Warsaw");

  env.campaign = kampania();
  env.campaignRejects = null;
  env.campaignPending = false;
  env.savePayloads = [];
  env.saveError = null;
  env.sendCalls = [];
  env.sendResults = [];
  env.sendError = null;
  env.testCalls = [];
  env.testError = null;
  env.countCalls = [];
  env.audience = 128;
  env.listRows = [];
  env.listRejects = null;
  env.listPending = false;
  env.deleteCalls = [];
  env.deleteError = null;
  env.createResult = { id: "nowa-kampania" };
  env.processDueCalls = 0;
  env.processDueError = null;
  env.processDuePending = false;
  env.sendPending = false;
  env.tiers = [
    { key: "friend", rank: 10, name_pl: "Przyjaciel", name_en: "Friend" },
    { key: "member", rank: 20, name_pl: "Członek", name_en: "Member" },
    { key: "gosc", rank: 0, name_pl: "Gość", name_en: "Guest" },
  ];
  env.processDueResult = { fired: 0, continued: 0, sent: 0 };
  env.navigations = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (zapisanaStrefa === undefined) delete process.env.TZ;
  else process.env.TZ = zapisanaStrefa;
});

// ---------------------------------------------------------------------------
// KONWERSJA HARMONOGRAMU
// ---------------------------------------------------------------------------

describe("harmonogram - konwersja UTC ↔ czas lokalny w obie strony", () => {
  it.each([
    ["Europe/Warsaw", "2026-09-01T10:30:00.000Z", "2026-09-01T12:30"],
    ["UTC", "2026-09-01T10:30:00.000Z", "2026-09-01T10:30"],
  ])(
    "w strefie %s data z bazy pokazuje się jako czas LOKALNY operatora",
    async (tz, zapisane, oczekiwane) => {
      // Operator planuje wysyłkę „na 12:30", patrząc na własny zegar. Pokazanie
      // mu UTC oznacza kampanię wysłaną dwie godziny za wcześnie.
      wStrefie(tz);
      env.campaign = kampania({ scheduled_at: zapisane });

      await zamontujEdytor();

      expect(poleHarmonogramu().value).toBe(oczekiwane);
    },
  );

  it.each([
    ["Europe/Warsaw", "2026-12-01T08:00", "2026-12-01T07:00:00.000Z"],
    ["UTC", "2026-12-01T08:00", "2026-12-01T08:00:00.000Z"],
  ])("w strefie %s wpisana godzina jedzie do bazy jako UTC", async (tz, wpisane, oczekiwane) => {
    wStrefie(tz);

    await zamontujEdytor();
    fireEvent.change(poleHarmonogramu(), { target: { value: wpisane } });

    expect((await zapisz()).scheduled_at).toBe(oczekiwane);
  });

  it.each(["Europe/Warsaw", "UTC"])(
    "w strefie %s obieg tam i z powrotem jest TOŻSAMOŚCIĄ dla pełnych minut",
    async (tz) => {
      // To jest właściwość, o którą tu naprawdę chodzi: otwarcie kampanii
      // i zapis BEZ dotykania harmonogramu nie mogą przesunąć wysyłki.
      wStrefie(tz);
      const zapisane = "2026-09-01T10:30:00.000Z";
      env.campaign = kampania({ scheduled_at: zapisane });

      await zamontujEdytor();

      expect((await zapisz()).scheduled_at).toBe(zapisane);
    },
  );

  it("obieg GUBI sekundy - to granulacja pola `datetime-local`, nie błąd godziny", async () => {
    // Pole `datetime-local` w tej postaci ma rozdzielczość MINUTY, więc
    // harmonogram zapisany z sekundami wraca zaokrąglony w dół. Konsekwencja
    // jest ograniczona do sekund w obrębie tej samej minuty - godzina wysyłki
    // się NIE zmienia. Przypinamy to jawnie, żeby czyjaś „poprawka" nie zaczęła
    // czytać tego jako straty godziny.
    env.campaign = kampania({ scheduled_at: "2026-09-01T10:30:45.123Z" });

    await zamontujEdytor();

    expect(poleHarmonogramu().value).toBe("2026-09-01T12:30");
    expect((await zapisz()).scheduled_at).toBe("2026-09-01T10:30:00.000Z");
  });

  it("puste pole znaczy BRAK PLANU, a nie „wyślij teraz”", async () => {
    env.campaign = kampania({ scheduled_at: "2026-09-01T10:30:00.000Z" });

    await zamontujEdytor();
    fireEvent.click(screen.getByRole("button", { name: /clearSchedule/ }));

    expect(poleHarmonogramu().value).toBe("");
    expect((await zapisz()).scheduled_at).toBeNull();
  });

  it("kampania bez planu nie pokazuje przycisku czyszczenia harmonogramu", async () => {
    await zamontujEdytor();

    expect(screen.queryByRole("button", { name: /clearSchedule/ })).toBeNull();
    expect(poleHarmonogramu().value).toBe("");
  });

  it("nieczytelna data w bazie daje PUSTE pole, a nie „Invalid Date” na ekranie", async () => {
    env.campaign = kampania({ scheduled_at: "kiedyś-tam" });

    await zamontujEdytor();

    expect(poleHarmonogramu().value).toBe("");
    expect((await zapisz()).scheduled_at).toBeNull();
  });
});

describe("harmonogram - zmiana czasu i daty spoza zakresu", () => {
  it("godzina NIEISTNIEJĄCA (noc zmiany na letni) przesuwa się o godzinę do przodu", async () => {
    // 2026-03-29 o 02:00 zegar w Warszawie skacze na 03:00, więc 02:30 nie
    // istnieje. Operator, który wpisze 02:30, dostanie wysyłkę o 03:30 -
    // i pole po ponownym otwarciu pokaże mu właśnie 03:30. Godzina jest inna
    // niż wpisana; to konsekwencja kalendarza, nie błąd konwersji, ale musi
    // być widoczna, bo nikt jej się nie spodziewa.
    await zamontujEdytor();
    fireEvent.change(poleHarmonogramu(), { target: { value: "2026-03-29T02:30" } });

    expect((await zapisz()).scheduled_at).toBe("2026-03-29T01:30:00.000Z");

    cleanup();
    env.campaign = kampania({ scheduled_at: "2026-03-29T01:30:00.000Z" });
    await zamontujEdytor();
    expect(poleHarmonogramu().value).toBe("2026-03-29T03:30");
  });

  it("godzina PODWÓJNA (noc zmiany na zimowy) traci swoje drugie wystąpienie", async () => {
    // 2026-10-25 godzina 02:30 zdarza się dwa razy: raz w CEST (00:30 UTC),
    // raz w CET (01:30 UTC). Pole `datetime-local` nie ma jak ich rozróżnić,
    // więc kampania zaplanowana na DRUGIE wystąpienie, po otwarciu i zapisaniu
    // edytora, przesuwa się o godzinę WCZEŚNIEJ. Jedna noc w roku, ale skutek
    // jest realny: mail wychodzi o 02:30 CEST zamiast 02:30 CET.
    env.campaign = kampania({ scheduled_at: "2026-10-25T01:30:00.000Z" });

    await zamontujEdytor();

    expect(poleHarmonogramu().value).toBe("2026-10-25T02:30");
    expect((await zapisz()).scheduled_at).toBe("2026-10-25T00:30:00.000Z");
  });

  it("pierwsze wystąpienie godziny podwójnej obiega się tożsamościowo", async () => {
    env.campaign = kampania({ scheduled_at: "2026-10-25T00:30:00.000Z" });

    await zamontujEdytor();

    expect((await zapisz()).scheduled_at).toBe("2026-10-25T00:30:00.000Z");
  });

  it("data sprzed roku 1000 GUBI harmonogram po cichu przy zapisie", async () => {
    // Rok jest formatowany bez dopełnienia do czterech cyfr ("1-01-01T01:24"),
    // a takiego napisu odwrotna konwersja nie umie przeczytać. Formularz
    // pokazuje wtedy plan (przycisk czyszczenia jest widoczny), a zapis
    // wysyła `null` - kampania cicho przestaje być zaplanowana.
    env.campaign = kampania({ scheduled_at: "0001-01-01T00:00:00.000Z" });

    await zamontujEdytor();

    expect(screen.getByRole("button", { name: /clearSchedule/ })).toBeTruthy();
    expect((await zapisz()).scheduled_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// REGUŁY ZAPISU
// ---------------------------------------------------------------------------

describe("reguły zapisu kampanii", () => {
  it.fails("harmonogram w PRZESZŁOŚCI powinien zostać odrzucony PRZED zapisem", async () => {
    // STAN FAKTYCZNY: nie jest. Ani formularz, ani walidator serwerowy nie
    // porównują daty z „teraz", więc kampania zaplanowana wstecz zapisuje się
    // ze statusem `scheduled` i `scheduled_at` w przeszłości - czyli jest
    // NATYCHMIAST zaległa i wychodzi przy najbliższym ticku
    // (`processDueCampaigns` bierze `scheduled_at <= now()`). Operator, który
    // pomylił się o dzień, nie ma sekundy na cofnięcie.
    await zamontujEdytor();
    fireEvent.change(poleHarmonogramu(), { target: { value: "2026-08-01T09:00" } });
    fireEvent.click(przyciskZapisu());
    // Mutacja dostaje pełną szansę się wykonać - inaczej „zero wywołań"
    // znaczyłoby tylko „jeszcze nie zdążyła", a test byłby wyścigiem.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(env.savePayloads).toHaveLength(0);
  });

  it("kampania JUŻ WYSŁANA nie da się zapisać - przycisk i pola są zablokowane", async () => {
    // Edycja po wysyłce nie zmienia tego, co ludzie dostali, ale kasuje dowód,
    // co właściwie poszło.
    env.campaign = kampania({ status: "sent", sent_count: 500, recipient_count: 500 });

    await zamontujEdytor();
    fireEvent.click(przyciskZapisu());

    expect(przyciskZapisu().disabled).toBe(true);
    expect(poleHarmonogramu().disabled).toBe(true);
    expect(env.savePayloads).toHaveLength(0);
  });

  it("kampania W TRAKCIE wysyłki też jest zablokowana do edycji", async () => {
    env.campaign = kampania({ status: "sending" });

    await zamontujEdytor();
    fireEvent.click(przyciskZapisu());

    expect(env.savePayloads).toHaveLength(0);
  });

  it("zapis niesie OBA silniki treści - przełączenie doc↔html niczego nie kasuje", async () => {
    await zamontujEdytor();
    fireEvent.click(screen.getByRole("button", { name: /builderTab/ }));

    const payload = await zapisz();
    expect(payload.editor).toBe("doc");
    expect(payload.html_pl).toBe("<p>PL</p>");
    expect(payload.content_doc).toBeTruthy();
  });

  it("puste pola nadawcy zapisują się jako brak, a nie jako pusty napis", async () => {
    // Pusty napis w `from_email` przeszedłby walidację adresu na serwerze
    // jako błąd; `null` znaczy „użyj domyślnego nadawcy".
    env.campaign = kampania({ from_name: null, from_email: null, reply_to: null });

    await zamontujEdytor();

    const payload = await zapisz();
    expect(payload.from_name).toBeNull();
    expect(payload.from_email).toBeNull();
    expect(payload.reply_to).toBeNull();
  });

  it("każde pole formularza trafia do ładunku zapisu - nic nie ginie po drodze", async () => {
    // Pola nadawcy i tematów decydują o tym, co widzi odbiorca w skrzynce
    // (nadawca i temat to jedyne, po czym decyduje, czy w ogóle otworzy).
    await zamontujEdytor();

    fireEvent.change(screen.getByLabelText("adminNewsletter.campaigns.internalName"), {
      target: { value: "Wrześniowy przegląd" },
    });
    fireEvent.change(screen.getByLabelText("adminNewsletter.campaigns.fromName"), {
      target: { value: "Redakcja NES" },
    });
    fireEvent.change(screen.getByLabelText("adminNewsletter.campaigns.fromEmail"), {
      target: { value: "redakcja@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Reply-To"), {
      target: { value: "odpowiedzi@example.test" },
    });
    fireEvent.change(screen.getByLabelText("adminNewsletter.campaigns.subjectPl"), {
      target: { value: "Temat wrześniowy" },
    });
    fireEvent.change(screen.getByLabelText("adminNewsletter.campaigns.subjectEn"), {
      target: { value: "September subject" },
    });
    // Pola HTML mają etykietę bez powiązania `htmlFor`, więc sięgamy po nie
    // podpowiedzią - tą samą, którą widzi redakcja.
    fireEvent.change(screen.getByPlaceholderText(/Witaj/), {
      target: { value: "<p>Nowa treść PL</p>" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Hi \{\{/), {
      target: { value: "<p>New body EN</p>" },
    });

    expect(await zapisz()).toMatchObject({
      id: CAMPAIGN_ID,
      name: "Wrześniowy przegląd",
      from_name: "Redakcja NES",
      from_email: "redakcja@example.test",
      reply_to: "odpowiedzi@example.test",
      subject_pl: "Temat wrześniowy",
      subject_en: "September subject",
      html_pl: "<p>Nowa treść PL</p>",
      html_en: "<p>New body EN</p>",
    });
  });

  it("kampania zapisana w kreatorze otwiera się w kreatorze, nie w surowym HTML-u", async () => {
    env.campaign = kampania({
      editor: "doc",
      content_doc: { version: 1, blocks: [], style: {} },
    });

    await zamontujEdytor();

    expect(screen.getByTestId("kreator-tresci")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Witaj/)).toBeNull();
  });

  it("zmiana w kreatorze wchodzi do dokumentu, a przełączenie na HTML jej nie kasuje", async () => {
    env.campaign = kampania({ editor: "doc", content_doc: { version: 1, blocks: [], style: {} } });

    await zamontujEdytor();
    fireEvent.click(screen.getByTestId("kreator-tresci"));
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));

    const payload = await zapisz();
    expect(payload.editor).toBe("html");
    expect(payload.content_doc).toEqual({ version: 1, blocks: [], style: {} });
  });

  it("udany zapis potwierdza się operatorowi", async () => {
    await zamontujEdytor();
    await zapisz();

    await waitFor(() =>
      expect(env.toastSuccess).toHaveBeenCalledWith("adminNewsletter.campaigns.detailSaved"),
    );
  });

  it("odrzucony zapis pokazuje POWÓD, a nie ogólne „coś poszło nie tak”", async () => {
    env.saveError = "invalid_content_doc";

    await zamontujEdytor();
    fireEvent.click(przyciskZapisu());

    await waitFor(() => expect(env.toastError).toHaveBeenCalledWith("invalid_content_doc"));
  });
});

// ---------------------------------------------------------------------------
// STANY EDYTORA
// ---------------------------------------------------------------------------

describe("stany edytora kampanii", () => {
  it("dopóki kampania się ładuje, formularz się nie pokazuje", async () => {
    env.campaignPending = true;

    await renderRoute({
      route: DetailRoute,
      path: "/admin/newsletter/campaigns/$id",
      initialEntry: `/admin/newsletter/campaigns/${CAMPAIGN_ID}`,
    });

    expect(screen.getByText("adminNewsletter.campaigns.detailLoading")).toBeTruthy();
    expect(screen.queryByText("adminNewsletter.campaigns.settingsHeading")).toBeNull();
  });

  it.fails("kampania NIEISTNIEJĄCA powinna powiedzieć, że jej nie ma", async () => {
    // STAN FAKTYCZNY: ekran zostaje na komunikacie ładowania NA ZAWSZE.
    // Warunek `isLoading || !form` stoi PRZED `if (!campaign)`, a `form`
    // ustawia się wyłącznie dla istniejącej kampanii - więc gałąź „nie
    // znaleziono" jest nieosiągalna. Operator z nieaktualnym odnośnikiem
    // (skasowana kampania) patrzy w wieczny spinner zamiast dowiedzieć się,
    // że kampanii nie ma.
    env.campaign = null;

    await renderRoute({
      route: DetailRoute,
      path: "/admin/newsletter/campaigns/$id",
      initialEntry: `/admin/newsletter/campaigns/${CAMPAIGN_ID}`,
    });

    await screen.findByText("adminNewsletter.campaigns.notFound");
  });

  it.fails("BŁĄD POBRANIA kampanii powinien być odróżnialny od ładowania", async () => {
    // STAN FAKTYCZNY: nie jest. Zapytanie kończy się błędem, `form` zostaje
    // pusty i ekran pokazuje ten sam komunikat „ładowanie" - czyli awaria
    // sieci wygląda dokładnie jak wolne łącze i nikt nie próbuje jej naprawić.
    env.campaignRejects = "network down";

    await renderRoute({
      route: DetailRoute,
      path: "/admin/newsletter/campaigns/$id",
      initialEntry: `/admin/newsletter/campaigns/${CAMPAIGN_ID}`,
    });

    await waitFor(() =>
      expect(screen.queryByText("adminNewsletter.campaigns.detailLoading")).toBeNull(),
    );
  });

  it("kampania NOWA (bez treści i bez planu) otwiera się gotowa do pisania", async () => {
    env.campaign = kampania({ name: "", subject_pl: "", subject_en: "", html_pl: "", html_en: "" });

    await zamontujEdytor();

    // Bez nazwy nagłówek schodzi na etykietę zastępczą - pusty nagłówek
    // wygląda jak uszkodzony ekran.
    expect(screen.getByText("adminNewsletter.campaigns.detailEyebrow")).toBeTruthy();
    expect(przyciskZapisu().disabled).toBe(false);
  });

  it("kampania EDYTOWANA pokazuje swoją nazwę, status i postęp wysyłki", async () => {
    env.campaign = kampania({ status: "sending", sent_count: 120, recipient_count: 500 });

    await zamontujEdytor();

    expect(screen.getByText("Sierpniowy przegląd")).toBeTruthy();
    expect(screen.getByText("sending")).toBeTruthy();
    expect(screen.getByText(/120/)).toBeTruthy();
  });

  it("strzałka wstecz wraca na listę kampanii", async () => {
    await zamontujEdytor();
    fireEvent.click(screen.getByRole("button", { name: "adminNewsletter.campaigns.back" }));

    expect(env.navigations).toEqual([{ to: "/admin/newsletter/campaigns" }]);
  });
});

// ---------------------------------------------------------------------------
// AUDIENCJA
// ---------------------------------------------------------------------------

describe("dobór odbiorców w edytorze", () => {
  it("licznik odbiorców pyta serwer filtrem kampanii, a nie zgaduje", async () => {
    env.campaign = kampania({ audience_filter: { languages: ["pl"], source: "stopka" } });

    await zamontujEdytor();

    await waitFor(() =>
      expect(env.countCalls.at(-1)).toEqual({ languages: ["pl"], source: "stopka" }),
    );
    expect(screen.getByText("128")).toBeTruthy();
  });

  it("odznaczenie ostatniego języka znaczy WSZYSCY, a nie NIKT", async () => {
    // Pusta tablica języków w filtrze wycięłaby całą listę. Brak klucza znaczy
    // „bez zawężenia" - i to jest różnica między kampanią do 5000 osób a do zera.
    env.campaign = kampania({ audience_filter: { languages: ["pl"] } });
    await zamontujEdytor();

    const [pl] = screen.getAllByRole("checkbox");
    fireEvent.click(pl);

    await waitFor(() => expect(env.countCalls.at(-1)).toEqual({}));
  });

  it("zaznaczenie drugiego języka dokłada go do filtru", async () => {
    env.campaign = kampania({ audience_filter: { languages: ["pl"] } });
    await zamontujEdytor();

    const [, en] = screen.getAllByRole("checkbox");
    fireEvent.click(en);

    await waitFor(() => expect(env.countCalls.at(-1)).toEqual({ languages: ["pl", "en"] }));
  });

  it("wyczyszczone źródło znika z filtru zamiast szukać pustego napisu", async () => {
    env.campaign = kampania({ audience_filter: { source: "stopka" } });
    await zamontujEdytor();

    fireEvent.change(screen.getByLabelText("adminNewsletter.campaigns.sourceOptional"), {
      target: { value: "" },
    });

    await waitFor(() => expect(env.countCalls.at(-1)).toEqual({ source: undefined }));
  });

  it("próg członkostwa wystawia WYŁĄCZNIE warstwy o dodatniej randze", async () => {
    await zamontujEdytor();

    const wartosci = Array.from(screen.getByTestId("wybor").querySelectorAll("option")).map(
      (option) => option.value,
    );
    expect(wartosci).toEqual(["0", "10", "20"]);
  });

  it("wybór „wszyscy subskrybenci” kasuje próg, zamiast szukać rangi zero", async () => {
    env.campaign = kampania({ audience_filter: { min_tier_rank: 20 } });
    await zamontujEdytor();

    fireEvent.change(screen.getByTestId("wybor"), { target: { value: "0" } });

    await waitFor(() => expect(env.countCalls.at(-1)).toEqual({ min_tier_rank: undefined }));
  });

  it("pierwszy zaznaczony język tworzy filtr od zera", async () => {
    // Kampania bez zawężenia językowego nie ma klucza `languages` - dołożenie
    // pierwszego języka musi go utworzyć, a nie dopisać do nieistniejącej listy.
    await zamontujEdytor();

    const [pl] = screen.getAllByRole("checkbox");
    fireEvent.click(pl);

    await waitFor(() => expect(env.countCalls.at(-1)).toEqual({ languages: ["pl"] }));
  });

  it("nieodczytany słownik warstw zostawia sam wybór „wszyscy”, a nie pustą droplistę", async () => {
    env.tiers = undefined;

    await zamontujEdytor();

    const wartosci = Array.from(screen.getByTestId("wybor").querySelectorAll("option")).map(
      (option) => option.value,
    );
    expect(wartosci).toEqual(["0"]);
  });

  it("wybrana warstwa jedzie do filtru jako liczba", async () => {
    await zamontujEdytor();
    fireEvent.change(screen.getByTestId("wybor"), { target: { value: "20" } });

    await waitFor(() => expect(env.countCalls.at(-1)).toEqual({ min_tier_rank: 20 }));
  });
});

// ---------------------------------------------------------------------------
// WYSYŁKA Z EDYTORA
// ---------------------------------------------------------------------------

describe("wysyłka z edytora", () => {
  it("potwierdzona wysyłka rusza bez zgody na ryzyko reputacyjne", async () => {
    await zamontujEdytor();
    fireEvent.click(screen.getByRole("button", { name: /campaigns\.send$/ }));

    await waitFor(() => expect(env.sendCalls).toHaveLength(1));
    expect(env.sendCalls[0]).toEqual({ id: CAMPAIGN_ID, acknowledgeReputation: false });
  });

  it("wysyłka porcjami dobija do końca bez udziału operatora", async () => {
    // Jedno wywołanie wysyła najwyżej porcję; pętla kontynuuje, aż `done`.
    // Zatrzymanie się na pierwszej porcji zostawiłoby połowę listy bez maila.
    env.sendResults = [
      { ok: true, sent: 200, failed: 0, done: false, remaining: 50 },
      { ok: true, sent: 250, failed: 0, done: true, remaining: 0 },
    ];

    await zamontujEdytor();
    fireEvent.click(screen.getByRole("button", { name: /campaigns\.send$/ }));

    await waitFor(() => expect(env.sendCalls).toHaveLength(2));
    // Kolejne porcje NIE pytają ponownie o zgodę na ryzyko - kampania jest już
    // w locie, więc bramka reputacji jej nie dotyczy.
    expect(env.sendCalls[1]).toEqual({ id: CAMPAIGN_ID, acknowledgeReputation: false });
  });

  it("bramka reputacji otwiera dialog z POWODAMI, zamiast surowego komunikatu", async () => {
    env.sendError = "reputation_blocked:complaint_rate,hard_bounce_rate";

    await zamontujEdytor();
    fireEvent.click(screen.getByRole("button", { name: /campaigns\.send$/ }));

    await screen.findByText("adminNewsletter.campaigns.sendingPaused");
    expect(screen.getByText("adminNewsletter.campaigns.riskComplaints")).toBeTruthy();
    expect(screen.getByText("adminNewsletter.campaigns.riskBounces")).toBeTruthy();
    // Ryzyko reputacyjne to decyzja o całej domenie nadawczej - nie toast.
    expect(env.toastError).not.toHaveBeenCalled();
  });

  it("świadome potwierdzenie ryzyka wysyła kampanię ze zgodą operatora", async () => {
    env.sendError = "reputation_blocked:complaint_rate";
    await zamontujEdytor();
    fireEvent.click(screen.getByRole("button", { name: /campaigns\.send$/ }));
    await screen.findByText("adminNewsletter.campaigns.sendingPaused");

    env.sendError = null;
    fireEvent.click(screen.getByRole("button", { name: /sendDespiteRisk/ }));

    await waitFor(() =>
      expect(env.sendCalls.at(-1)).toEqual({
        id: CAMPAIGN_ID,
        acknowledgeReputation: true,
      }),
    );
  });

  it.fails("blokada reputacji BEZ powodów też musi coś powiedzieć operatorowi", async () => {
    // STAN FAKTYCZNY: nie mówi nic. Serwer potrafi zwrócić samo
    // `reputation_blocked` (bez listy powodów - patrz `gate.errorCode ??
    // "reputation_blocked"`), a wtedy lista powodów jest pusta, dialog zostaje
    // zamknięty (`open={gateReasons.length > 0}`) i `return` zjada toast.
    // Operator klika „Wyślij", nic się nie dzieje i próbuje ponownie.
    env.sendError = "reputation_blocked";

    await zamontujEdytor();
    fireEvent.click(screen.getByRole("button", { name: /campaigns\.send$/ }));

    await waitFor(() => expect(env.toastError).toHaveBeenCalled());
  });

  it("zwykła awaria wysyłki idzie toastem z powodem", async () => {
    env.sendError = "campaign_not_sendable";

    await zamontujEdytor();
    fireEvent.click(screen.getByRole("button", { name: /campaigns\.send$/ }));

    await waitFor(() => expect(env.toastError).toHaveBeenCalledWith("campaign_not_sendable"));
  });

  it("kampania W TRAKCIE wysyłki daje wznowienie z poziomu edytora", async () => {
    env.campaign = kampania({ status: "sending" });

    await zamontujEdytor();
    fireEvent.click(screen.getByRole("button", { name: /campaigns\.resume/ }));

    await waitFor(() => expect(env.sendCalls).toHaveLength(1));
  });

  it("kampania ZAKOŃCZONA nie oferuje wznowienia - to byłaby wysyłka podwójna", async () => {
    env.campaign = kampania({ status: "sent" });

    await zamontujEdytor();

    expect(screen.queryByRole("button", { name: /campaigns\.resume/ })).toBeNull();
  });

  it("wysyłka testowa idzie na wskazany adres w wybranym języku", async () => {
    await zamontujEdytor();
    fireEvent.change(screen.getByLabelText("adminNewsletter.campaigns.testEmail"), {
      target: { value: "redakcja@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    fireEvent.click(screen.getByRole("button", { name: /sendTest/ }));

    await waitFor(() =>
      expect(env.testCalls).toEqual([
        { id: CAMPAIGN_ID, toEmail: "redakcja@example.test", language: "en" },
      ]),
    );
    await waitFor(() =>
      expect(env.toastSuccess).toHaveBeenCalledWith("adminNewsletter.campaigns.testSent"),
    );
  });

  it("nieudana wysyłka testowa pokazuje powód, a nie „wysłano”", async () => {
    env.testError = "missing_content_for_language";

    await zamontujEdytor();
    fireEvent.change(screen.getByLabelText("adminNewsletter.campaigns.testEmail"), {
      target: { value: "redakcja@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sendTest/ }));

    await waitFor(() =>
      expect(env.toastError).toHaveBeenCalledWith("missing_content_for_language"),
    );
    expect(env.toastSuccess).not.toHaveBeenCalled();
  });

  it("powrót do wersji polskiej testu jest możliwy po przełączeniu na angielską", async () => {
    await zamontujEdytor();
    fireEvent.change(screen.getByLabelText("adminNewsletter.campaigns.testEmail"), {
      target: { value: "redakcja@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    fireEvent.click(screen.getByRole("button", { name: "PL" }));
    fireEvent.click(screen.getByRole("button", { name: /sendTest/ }));

    await waitFor(() => expect(env.testCalls.at(-1)).toMatchObject({ language: "pl" }));
  });

  it("zamknięcie dialogu ryzyka NIE wysyła kampanii", async () => {
    // Zamknięcie okna to rezygnacja. Gdyby czyściło tylko powody, a wysyłka
    // szła dalej, operator straciłby ostatni moment na wycofanie się.
    env.sendError = "reputation_blocked:complaint_rate";

    await zamontujEdytor();
    fireEvent.click(screen.getByRole("button", { name: /campaigns\.send$/ }));
    await screen.findByText("adminNewsletter.campaigns.sendingPaused");

    fireEvent.click(screen.getByTestId("dialog-zamknij"));

    await waitFor(() =>
      expect(screen.queryByText("adminNewsletter.campaigns.sendingPaused")).toBeNull(),
    );
    expect(env.sendCalls).toHaveLength(1);
  });

  it("bez adresu testowego przycisk jest nieczynny", async () => {
    await zamontujEdytor();

    const przycisk = screen.getByRole("button", { name: /sendTest/ });
    expect(przycisk instanceof HTMLButtonElement && przycisk.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LISTA KAMPANII - WZNOWIENIE
// ---------------------------------------------------------------------------

describe("lista kampanii - komu wolno zaproponować WZNOWIENIE", () => {
  // Wznowienie kampanii, która już się skończyła, to WYSYŁKA PODWÓJNA: cała
  // lista dostaje tę samą wiadomość drugi raz, a każde takie zdarzenie to
  // skargi na spam i obniżona reputacja CAŁEJ domeny nadawczej. Dlatego
  // przycisk „wznów" ma się pokazywać wyłącznie przy kampanii, która jest
  // w locie i NIE MA aktywnej dzierżawy.
  const WSZYSTKIE_STATUSY = [
    ["draft", false],
    ["scheduled", false],
    ["sending", true],
    ["sent", false],
    ["failed", false],
    ["cancelled", false],
  ] as const;

  it.each(WSZYSTKIE_STATUSY)(
    "status `%s`: wznowienie oferowane = %s",
    async (status, oczekiwane) => {
      env.listRows = [wiersz({ id: `k-${status}`, status, lease_until: null })];

      await zamontujListe();

      expect(Boolean(screen.queryByRole("button", { name: /campaigns\.resume/ }))).toBe(oczekiwane);
    },
  );

  it("wysyłka z AKTYWNĄ dzierżawą NIE jest wznawialna - ktoś ją właśnie przetwarza", async () => {
    // Drugi procesor tej samej kampanii wysyła te same adresy równolegle.
    env.listRows = [wiersz({ status: "sending", lease_until: "2026-08-22T10:02:00.000Z" })];

    await zamontujListe();

    expect(screen.queryByRole("button", { name: /campaigns\.resume/ })).toBeNull();
  });

  it("wysyłka z WYGASŁĄ dzierżawą jest wznawialna - poprzedni proces zginął", async () => {
    env.listRows = [wiersz({ status: "sending", lease_until: "2026-08-22T09:58:00.000Z" })];

    await zamontujListe();

    expect(screen.getByRole("button", { name: /campaigns\.resume/ })).toBeTruthy();
  });

  it("NIECZYTELNA dzierżawa jest traktowana jak jej brak, a nie jak dzierżawa wieczna", async () => {
    // Śmieć w kolumnie nie może zamrozić kampanii w `sending` na zawsze -
    // wtedy połowa listy nigdy nie dostałaby wiadomości.
    env.listRows = [wiersz({ status: "sending", lease_until: "nie-data" })];

    await zamontujListe();

    expect(screen.getByRole("button", { name: /campaigns\.resume/ })).toBeTruthy();
  });

  it("wznowienie wysyła identyfikator TEJ kampanii i potwierdza wynik", async () => {
    env.listRows = [wiersz({ id: "kampania-w-locie", status: "sending", lease_until: null })];

    await zamontujListe();
    fireEvent.click(screen.getByRole("button", { name: /campaigns\.resume/ }));

    await waitFor(() => expect(env.sendCalls).toEqual([{ id: "kampania-w-locie" }]));
    await waitFor(() => expect(env.toastSuccess).toHaveBeenCalled());
  });

  it("trwające wznowienie blokuje przyciski wznowienia na całej liście", async () => {
    // Dwa kliknięcia w dwóch wierszach naraz to dwa procesory tej samej
    // kolejki - a więc ryzyko, że ten sam adres dostanie wiadomość dwa razy.
    env.listRows = [
      wiersz({ id: "k-1", status: "sending", lease_until: null }),
      wiersz({ id: "k-2", status: "sending", lease_until: null }),
    ];
    env.sendPending = true;

    await zamontujListe();
    const przyciski = screen.getAllByRole("button", { name: /campaigns\.resume/ });
    fireEvent.click(przyciski[0]);

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("button", { name: /campaigns\.resume/ })
          .every((b) => b instanceof HTMLButtonElement && b.disabled),
      ).toBe(true),
    );
  });

  it("nieudane wznowienie pokazuje powód i odświeża listę", async () => {
    env.listRows = [wiersz({ status: "sending", lease_until: null })];
    env.sendError = "campaign_not_sendable";

    await zamontujListe();
    fireEvent.click(screen.getByRole("button", { name: /campaigns\.resume/ }));

    await waitFor(() => expect(env.toastError).toHaveBeenCalledWith("campaign_not_sendable"));
  });
});

// ---------------------------------------------------------------------------
// LISTA KAMPANII - STANY, KASOWANIE, ZALEGŁE
// ---------------------------------------------------------------------------

describe("lista kampanii - stany i operacje", () => {
  it("dopóki lista się ładuje, nie mówimy „brak kampanii”", async () => {
    env.listPending = true;

    await zamontujListe();

    expect(screen.getByText("adminNewsletter.campaigns.detailLoading")).toBeTruthy();
    expect(screen.queryByText("adminNewsletter.campaigns.listEmpty")).toBeNull();
  });

  it("pusta lista mówi wprost, że nie ma jeszcze kampanii", async () => {
    await zamontujListe();

    expect(screen.getByText("adminNewsletter.campaigns.listEmpty")).toBeTruthy();
  });

  it.fails("AWARIA listy musi wyglądać inaczej niż lista pusta", async () => {
    // STAN FAKTYCZNY: wygląda tak samo. `useQuery` z domyślną wartością
    // `campaigns = []` sprowadza błąd zapytania do pustej tablicy, więc panel
    // pokazuje „nie masz jeszcze żadnych kampanii" komuś, kto ma ich sto -
    // i kto na tej podstawie może założyć nową zamiast naprawić połączenie.
    env.listRejects = "network down";

    await zamontujListe();

    await waitFor(() =>
      expect(screen.queryByText("adminNewsletter.campaigns.listEmpty")).toBeNull(),
    );
  });

  it("wiersz kampanii pokazuje plan, odbiorców i porażki", async () => {
    env.listRows = [
      wiersz({
        name: "Wydanie sierpniowe",
        status: "sent",
        scheduled_at: "2026-08-20T06:00:00.000Z",
        recipient_count: 500,
        sent_count: 498,
        failed_count: 2,
      }),
    ];

    await zamontujListe();

    expect(screen.getByRole("link", { name: "Wydanie sierpniowe" }).getAttribute("href")).toBe(
      `/admin/newsletter/campaigns/${CAMPAIGN_ID}`,
    );
    expect(screen.getByText("adminNewsletter.campaigns.status.sent")).toBeTruthy();
    expect(screen.getByText("500")).toBeTruthy();
    expect(screen.getByText("/ 2")).toBeTruthy();
  });

  it("kampania bez planu pokazuje kreskę, a nie „Invalid Date”", async () => {
    env.listRows = [wiersz({ scheduled_at: null })];

    await zamontujListe();

    expect(screen.getByText("-")).toBeTruthy();
  });

  it.each([
    ["draft", true],
    ["scheduled", true],
    ["failed", true],
    ["cancelled", true],
    ["sending", false],
    ["sent", false],
  ])("status `%s`: kasowanie oferowane = %s", async (status, oczekiwane) => {
    // Skasowanie kampanii W LOCIE zostawiłoby wysyłkę bez wiersza, do którego
    // dopisuje postęp; skasowanie WYSŁANEJ kasuje dowód, co poszło do ludzi.
    env.listRows = [wiersz({ status })];

    await zamontujListe();

    expect(Boolean(screen.queryByRole("button", { name: "Delete" }))).toBe(oczekiwane);
  });

  it("potwierdzone kasowanie usuwa WSKAZANĄ kampanię", async () => {
    env.listRows = [wiersz({ id: "do-skasowania", status: "draft" })];

    await zamontujListe();
    fireEvent.click(screen.getByRole("button", { name: /campaigns\.delete$/ }));

    await waitFor(() => expect(env.deleteCalls).toEqual(["do-skasowania"]));
    await waitFor(() => expect(env.toastSuccess).toHaveBeenCalledWith("adminCampaigns.deleted"));
  });

  it("nieudane kasowanie pokazuje POWÓD, a nie znika po cichu", async () => {
    env.listRows = [wiersz({ status: "draft" })];
    env.deleteError = "campaign_in_flight";

    await zamontujListe();
    fireEvent.click(screen.getByRole("button", { name: /campaigns\.delete$/ }));

    await waitFor(() => expect(env.toastError).toHaveBeenCalledWith("campaign_in_flight"));
  });

  it("nowa kampania startuje w kreatorze bloków i od razu otwiera edytor", async () => {
    await zamontujListe();
    fireEvent.click(screen.getByRole("button", { name: /newCampaign/ }));

    await waitFor(() => expect(env.savePayloads).toHaveLength(1));
    expect(env.savePayloads[0]).toMatchObject({ editor: "doc", audience_filter: {} });
    await waitFor(() =>
      expect(env.navigations).toEqual([
        { to: "/admin/newsletter/campaigns/$id", params: { id: "nowa-kampania" } },
      ]),
    );
  });

  it("nieudane utworzenie kampanii nie przenosi donikąd", async () => {
    env.saveError = "no_tenant";

    await zamontujListe();
    fireEvent.click(screen.getByRole("button", { name: /newCampaign/ }));

    await waitFor(() => expect(env.toastError).toHaveBeenCalledWith("no_tenant"));
    expect(env.navigations).toHaveLength(0);
  });

  it("wejście na listę samo próbuje dopchnąć zaległe kampanie", async () => {
    // Zapasowy mechanizm harmonogramu: bez crona zaplanowana kampania czeka na
    // pierwszego admina, który wejdzie na tę stronę.
    await zamontujListe();

    await waitFor(() => expect(env.processDueCalls).toBeGreaterThan(0));
  });

  it("ręczne „wyślij zaległe” bez zaległości mówi to wprost", async () => {
    await zamontujListe();
    fireEvent.click(screen.getByRole("button", { name: /processDue/ }));

    await waitFor(() =>
      expect(env.toastInfo).toHaveBeenCalledWith("adminNewsletter.campaigns.noDueCampaigns"),
    );
  });

  it("ręczne „wyślij zaległe” raportuje, ile ruszyło i ile wznowiono", async () => {
    env.processDueResult = { fired: 2, continued: 1, sent: 40 };

    await zamontujListe();
    fireEvent.click(screen.getByRole("button", { name: /processDue/ }));

    await waitFor(() =>
      expect(env.toastSuccess).toHaveBeenCalledWith(
        "adminNewsletter.campaigns.dueSummary(continued=1,fired=2)",
      ),
    );
  });

  it("nieudany tick zaległych pokazuje powód operatorowi", async () => {
    await zamontujListe();
    env.processDueError = "no_tenant";
    fireEvent.click(screen.getByRole("button", { name: /processDue/ }));

    await waitFor(() => expect(env.toastError).toHaveBeenCalledWith("no_tenant"));
  });

  it("tick przy WEJŚCIU na listę milczy o awarii - to praca w tle, nie akcja operatora", async () => {
    // Zapasowy tick odpala się sam. Czerwony toast przy każdym wejściu na
    // listę nauczyłby operatora ignorować toasty w tym panelu.
    env.processDueError = "no_tenant";

    await zamontujListe();

    await waitFor(() => expect(env.processDueCalls).toBeGreaterThan(0));
    expect(env.toastError).not.toHaveBeenCalled();
  });

  it("tick przy wejściu MELDUJE, gdy naprawdę coś wysłał", async () => {
    env.processDueResult = { fired: 2, continued: 0, sent: 30 };

    await zamontujListe();

    await waitFor(() =>
      expect(env.toastSuccess).toHaveBeenCalledWith("adminNewsletter.campaigns.dueFired(count=2)"),
    );
  });

  it("tick, który tylko WZNOWIŁ porcję, odświeża listę bez chwalenia się wysyłką", async () => {
    // „Kontynuowano" nie znaczy „wysłano nowe" - toast o wysyłce w tym miejscu
    // kazałby operatorowi szukać kampanii, która właśnie nie ruszyła od zera.
    env.processDueResult = { fired: 0, continued: 1, sent: 5 };

    await zamontujListe();

    await waitFor(() => expect(env.processDueCalls).toBeGreaterThan(0));
    expect(env.toastSuccess).not.toHaveBeenCalled();
  });

  it("trwający tick blokuje własny przycisk - dwa równoległe ticki to podwójna praca", async () => {
    env.processDuePending = true;

    await zamontujListe();
    const przycisk = screen.getByRole("button", { name: /processDue/ });
    fireEvent.click(przycisk);

    await waitFor(() =>
      expect(przycisk instanceof HTMLButtonElement && przycisk.disabled).toBe(true),
    );
  });

  it("kafel automatu wysyłki jest częścią listy - stan wysyłki widać obok kampanii", async () => {
    await zamontujListe();

    expect(screen.getByTestId("kafel-automatu")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// POWŁOKA
// ---------------------------------------------------------------------------

describe("powłoka `/admin/newsletter/campaigns`", () => {
  it("layout rodziny montuje się i oddaje miejsce podstronie", async () => {
    // Powłoka nie ma własnej treści; jej jedynym zadaniem jest `Outlet`.
    // Gdyby przestała się montować, obie podstrony zniknęłyby naraz.
    const utils = await renderRoute({
      route: LayoutRoute,
      path: "/admin/newsletter/campaigns",
      initialEntry: "/admin/newsletter/campaigns",
    });

    expect(utils.currentPath()).toBe("/admin/newsletter/campaigns");
    expect(utils.container.textContent).toBe("");
  });
});
