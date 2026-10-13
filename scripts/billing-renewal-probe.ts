/**
 * Nocna sonda odnowienia i dunningu w środowisku testowym Stripe - runner.
 *
 * Cała logika decyzyjna (wybór subskrypcji, klasyfikacja wyniku, format
 * podsumowania) i jej uzasadnienie żyją w `src/lib/ci/billingRenewalProbe.ts`,
 * gdzie mają test jednostkowy. Tutaj zostaje wyłącznie wejście/wyjście: HTTP
 * przez bramkę konektorów, plik stanu między krokami joba i kod wyjścia.
 *
 * Tryby:
 *   arm    - wybiera aktywną subskrypcję testową z Test Clockiem, zapamiętuje
 *            istniejące faktury i przesuwa zegar tuż za koniec bieżącego okresu,
 *   await  - ODPYTUJE Test Clock, aż przestanie przeliczać (`advancing` ->
 *            `ready`). Zastępuje ślepe `sleep 40m`: Stripe kończy zwykle
 *            w kilkadziesiąt sekund, a przy awarii i tak mamy twardy termin,
 *   verify - sprawdza, czy powstała NOWA faktura cykliczna, czy okres poszedł
 *            do przodu i czy stan faktury jest spójny ze stanem subskrypcji;
 *            czy punkt odbioru webhooków piaskownicy subskrybuje KAŻDY
 *            obsługiwany typ zdarzenia (przegląd 7.12); a potem - przez RPC
 *            `billing_probe_status` (klucz publikowalny + token sondy, NIE
 *            klucz `service_role`, przegląd 7.6) - czy NASZA strona odebrała
 *            odnowienie: przetworzone zdarzenie `subscription.*` w dzienniku
 *            webhooków, brak porażek w oknie po zbrojeniu i koniec okresu
 *            w `subscriptions` co najmniej taki jak u operatora. Dostawa
 *            webhooka jest asynchroniczna, więc naszą stronę ODPYTUJEMY do
 *            terminu (domyślnie 3 min).
 *
 * Brak kluczy: domyślnie zielone wyjście z ostrzeżeniem (świeży klon i fork nie
 * mogą wywracać CI). W trybie ścisłym (`PROBE_STRICT=true`, ustawianym dla
 * przebiegów z harmonogramu w repozytorium właściciela) brak konfiguracji jest
 * BŁĘDEM - nocna sonda, która nic nie sprawdza, nie ma prawa świecić na zielono.
 * Dotyczy to także dostępu do NASZEJ bazy w kroku `verify` (PROBE_SUPABASE_URL,
 * PROBE_SUPABASE_PUBLISHABLE_KEY, BILLING_PROBE_TOKEN): bez niego sonda widzi
 * tylko operatora, czyli przegapia awarię naszego webhooka - w trybie ścisłym
 * to błąd, ręcznie ostrzeżenie.
 *
 * Zmienne: STRIPE_SANDBOX_API_KEY, LOVABLE_API_KEY, PROBE_STATE_FILE,
 *          PROBE_REPORT_FILE, PROBE_STRICT, PROBE_REQUIRE_CONFIG,
 *          PROBE_SUBSCRIPTION_ID, PROBE_WAIT_TIMEOUT_MS, PROBE_WAIT_TIMEOUT_S,
 *          PROBE_WAIT_POLL_MS, PROBE_REQUEST_TIMEOUT_MS, PROBE_GATEWAY_URL,
 *          PROBE_SUPABASE_URL, PROBE_SUPABASE_PUBLISHABLE_KEY,
 *          BILLING_PROBE_TOKEN, PROBE_APP_BASE_URL (tylko `verify`),
 *          PROBE_DB_WAIT_TIMEOUT_MS, PROBE_DB_POLL_MS
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type LocalSyncVerdict,
  type ProbeOutcome,
  type ProbeState,
  type ProbeStatus,
  type StripeInvoice,
  type StripeSubscription,
  type StripeTestClock,
  type StripeWebhookEndpoint,
  type WebhookEndpointVerdict,
  classifyLocalSync,
  classifyRenewal,
  classifyWebhookEndpoints,
  combineOutcomes,
  isFailure,
  parseProbeState,
  parseProbeStatus,
  periodEndOf,
  renderArmSummary,
  renderLocalSyncSummary,
  renderVerifySummary,
  renderWebhookEndpointSummary,
  selectRenewalCandidate,
  withEndpointVerdict,
} from "../src/lib/ci/billingRenewalProbe";
import { STRIPE_WEBHOOK_EVENT_TYPES } from "../src/lib/billing/stripeEventTypes";

/**
 * Bramka konektorów platformy - SDK ani skrypt nigdy nie widzą prawdziwego
 * klucza operatora. Nadpisywalna, żeby dało się przepuścić pełną ścieżkę
 * arm -> await -> verify przez lokalny serwer atrap; w CI zawsze domyślna.
 */
const GATEWAY = process.env.PROBE_GATEWAY_URL ?? "https://connector-gateway.lovable.dev/stripe";
const STATE_FILE = process.env.PROBE_STATE_FILE ?? "/tmp/billing-renewal-probe.json";
const REPORT_FILE = process.env.PROBE_REPORT_FILE ?? "reports/billing-renewal-probe.json";
const STRICT = /^(1|true|yes)$/i.test(process.env.PROBE_STRICT ?? "");

const WAIT_TIMEOUT_MS = positiveNumber(
  process.env.PROBE_WAIT_TIMEOUT_MS,
  positiveNumber(process.env.PROBE_WAIT_TIMEOUT_S, 20 * 60) * 1000,
);
const WAIT_POLL_MS = positiveNumber(process.env.PROBE_WAIT_POLL_MS, 5_000);
const REQUEST_TIMEOUT_MS = positiveNumber(process.env.PROBE_REQUEST_TIMEOUT_MS, 15_000);
/**
 * Ile czekamy, aż NASZA strona odbierze odnowienie. Stripe wysyła webhooki
 * po przeliczeniu Test Clocka zwykle w sekundach; 3 minuty to zapas na
 * ponowienie po chwilowym 503/409 naszego punktu odbioru.
 */
const DB_WAIT_TIMEOUT_MS = positiveNumber(process.env.PROBE_DB_WAIT_TIMEOUT_MS, 3 * 60_000);
const DB_POLL_MS = positiveNumber(process.env.PROBE_DB_POLL_MS, 10_000);
const RETRY_DELAYS_MS = [250, 1_000, 3_000] as const;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

interface Auth {
  readonly connection: string;
  readonly platform: string;
}

/**
 * Dostęp do NASZEJ bazy - tylko `verify`. Klucz PUBLIKOWALNY (ten sam, który
 * ma przeglądarka) otwiera wyłącznie RPC `billing_probe_status`, a ta oddaje
 * dane dopiero po sprawdzeniu tokenu sondy. Klucz `service_role` produkcji
 * nie ma tu czego szukać (przegląd 7.6).
 */
interface DbAuth {
  readonly url: string;
  readonly publishableKey: string;
  readonly token: string;
}

/**
 * Wynik pojedynczego kroku. `arm` i `await` mają własne etykiety, żeby wartość
 * w `GITHUB_OUTPUT` mówiła, CO się stało, a nie tylko „poszło".
 */
type StepOutcome = ProbeOutcome | "armed" | "ready";

interface StripeList<T> {
  readonly data?: readonly T[];
}

/**
 * Odczyt liczbowy z jawnie PRZEKAZANĄ wartością. Dynamiczne `process.env[name]`
 * byłoby niewidoczne dla bramki kontraktu env (check:workflow-env-contract),
 * która dopasowuje statyczne odczyty - a to ona pilnuje, żeby workflow nie
 * eksportował zmiennych, których nikt nie czyta.
 */
function positiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Treść widoczna w podsumowaniu przebiegu (i w logu kroku). */
function summary(markdown: string): void {
  console.log(markdown);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n\n`);
}

/**
 * Adnotacja workflow. Musi iść WYŁĄCZNIE na stdout - wpisana do podsumowania
 * renderuje się jako surowy tekst `::warning title=...`, co poprzednia wersja
 * robiła przy każdym ostrzeżeniu.
 */
function annotate(level: "warning" | "error" | "notice", title: string, message: string): void {
  const clean = (value: string): string => value.replaceAll("\n", " ").replaceAll("::", ":");
  console.log(`::${level} title=${clean(title)}::${clean(message)}`);
}

function setOutput(key: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${key}=${value}\n`);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function keys(): Auth | null {
  const connection = process.env.STRIPE_SANDBOX_API_KEY;
  const platform = process.env.LOVABLE_API_KEY;
  if (!connection || !platform) return null;
  return { connection, platform };
}

function dbKeys(): DbAuth | null {
  const url = process.env.PROBE_SUPABASE_URL?.trim().replace(/\/+$/, "");
  const publishableKey = process.env.PROBE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const token = process.env.BILLING_PROBE_TOKEN?.trim();
  if (!url || !publishableKey || !token) return null;
  return { url, publishableKey, token };
}

/** Stripe przyjmuje wyłącznie `application/x-www-form-urlencoded`. */
function form(body: Record<string, string | number>): string {
  return Object.entries(body)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

/**
 * Żądanie z ponowieniami. Nocny przebieg rozmawia z usługami zdalnymi, więc
 * pojedynczy 502 na odczycie nie może oznaczać „odnowienie nie działa" -
 * inaczej bramka generuje fałszywe alarmy i przestaje być czytana.
 *
 * Ponawiane są WYŁĄCZNIE odczyty (GET i jawnie oznaczone `idempotent` - RPC
 * sondy jest funkcją STABLE, która niczego nie zapisuje). `POST .../advance` nie jest idempotentny
 * i nie ma klucza idempotencji: przy błędzie sieciowym nie wiadomo, czy operator
 * przesunął już zegar, a ponowienie w tym stanie zwraca 400 „clock is currently
 * advancing" - czyli zamienia jedną usterkę przejściową w czerwony przebieg
 * z mylącym komunikatem. Zapis ma paść od razu, z prawdziwą przyczyną.
 */
async function requestJson<T>(
  url: string,
  label: string,
  init: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
    idempotent?: boolean;
  },
): Promise<T> {
  const attempts = init.method === "GET" || init.idempotent ? RETRY_DELAYS_MS.length : 0;
  let lastError = "";

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method,
        headers: init.headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(init.body !== undefined ? { body: init.body } : {}),
      });
    } catch (error) {
      lastError = `${init.method} ${label} -> ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }

    const text = await response.text();
    if (response.ok) return JSON.parse(text) as T;

    lastError = `${init.method} ${label} -> ${response.status}: ${text.slice(0, 400)}`;
    if (!RETRYABLE_STATUS.has(response.status)) break;
  }

  throw new Error(lastError);
}

/** Żądanie do bramki konektorów operatora. */
async function api<T>(
  path: string,
  init: { auth: Auth; method?: "GET" | "POST"; body?: Record<string, string | number> },
): Promise<T> {
  const { auth, method = "GET", body } = init;
  return requestJson<T>(`${GATEWAY}/v1${path}`, path, {
    method,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Connection-Api-Key": auth.connection,
      "Lovable-API-Key": auth.platform,
    },
    ...(body ? { body: form(body) } : {}),
  });
}

/**
 * Stan NASZEJ strony przez RPC `billing_probe_status` (PostgREST). Token idzie
 * w CIELE żądania, nie w adresie - adresy lądują w logach pośredników. Funkcja
 * jest STABLE i tylko czyta, więc żądanie wolno ponowić jak GET. Błąd nie
 * ujawnia tokenu ani klucza: etykieta to sama ścieżka RPC.
 */
async function probeStatus(db: DbAuth, state: ProbeState): Promise<ProbeStatus> {
  const raw = await requestJson<unknown>(
    `${db.url}/rest/v1/rpc/billing_probe_status`,
    "/rest/v1/rpc/billing_probe_status",
    {
      method: "POST",
      idempotent: true,
      headers: {
        apikey: db.publishableKey,
        Authorization: `Bearer ${db.publishableKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_token: db.token,
        p_subscription_id: state.subscriptionId,
        p_since: state.armedAt,
      }),
    },
  );
  const parsed = parseProbeStatus(raw);
  if (!parsed) {
    throw new Error(
      "billing_probe_status zwróciła nieoczekiwany kształt - sprawdź migrację `billing_probe_status`.",
    );
  }
  return parsed;
}

/**
 * Punkty odbioru webhooków w piaskownicy Stripe (przegląd 7.12): czy nasz
 * odbiornik subskrybuje KAŻDY typ, który integracja obsługuje.
 */
async function verifyWebhookEndpoints(auth: Auth): Promise<WebhookEndpointVerdict> {
  const listed = await api<StripeList<StripeWebhookEndpoint>>("/webhook_endpoints?limit=100", {
    auth,
  });
  return classifyWebhookEndpoints({
    endpoints: listed.data ?? [],
    expectedTypes: STRIPE_WEBHOOK_EVENT_TYPES,
    // Niezdefiniowana zmienna repozytorium dociera tu jako pusty łańcuch.
    appBaseUrl: process.env.PROBE_APP_BASE_URL?.trim() || null,
  });
}

async function listInvoiceIds(auth: Auth, subscriptionId: string): Promise<string[]> {
  const invoices = await api<StripeList<StripeInvoice>>(
    `/invoices?subscription=${encodeURIComponent(subscriptionId)}&limit=100`,
    { auth },
  );
  return (invoices.data ?? []).map((invoice) => invoice.id);
}

async function arm(auth: Auth): Promise<StepOutcome> {
  const listed = await api<StripeList<StripeSubscription>>(
    "/subscriptions?status=active&limit=100&expand[]=data.customer",
    { auth },
  );

  // Niezdefiniowana zmienna repozytorium dociera tu jako pusty łańcuch.
  const preferred = process.env.PROBE_SUBSCRIPTION_ID?.trim() || null;
  const candidate = selectRenewalCandidate(listed.data ?? [], preferred);

  if (!candidate) {
    annotate(
      "warning",
      "Brak subskrypcji testowej z Test Clockiem",
      preferred
        ? `W sandboxie nie ma aktywnej subskrypcji ${preferred} przypiętej do Test Clocka.`
        : "W sandboxie Stripe nie ma aktywnej subskrypcji przypiętej do Test Clocka. " +
            "Utwórz klienta z Test Clockiem i wykonaj checkout kartą 4242 4242 4242 4242.",
    );
    return "skipped";
  }

  const clock = await api<StripeTestClock>(`/test_helpers/test_clocks/${candidate.testClockId}`, {
    auth,
  });
  // Zegar w trakcie przeliczania odrzuca `advance` błędem 400. Zdarza się po
  // przebiegu przerwanym w połowie - lepszy jawny komunikat niż surowy 400
  // z bramki, który wygląda na awarię integracji.
  if (clock.status !== "ready") {
    annotate(
      "warning",
      "Test Clock zajęty",
      `Zegar ${clock.id} ma status ${clock.status} - poprzedni przebieg prawdopodobnie nie dobiegł końca. Zbrojenie pominięte.`,
    );
    return "pending";
  }

  const previousPeriodEnd = periodEndOf(candidate.subscription);
  // Zegara nie da się cofnąć: celujemy tuż ZA koniec okresu, a gdyby okres już
  // minął (przebieg po awarii) - tuż za aktualny czas zegara.
  const advancedTo = Math.max(previousPeriodEnd ?? 0, clock.frozen_time) + 60;
  const knownInvoiceIds = await listInvoiceIds(auth, candidate.subscription.id);

  await api(`/test_helpers/test_clocks/${candidate.testClockId}/advance`, {
    auth,
    method: "POST",
    body: { frozen_time: advancedTo },
  });

  const state: ProbeState = {
    version: 1,
    subscriptionId: candidate.subscription.id,
    testClockId: candidate.testClockId,
    armedAt: new Date().toISOString(),
    frozenBefore: clock.frozen_time,
    advancedTo,
    previousPeriodEnd,
    knownInvoiceIds,
  };
  writeJson(STATE_FILE, state);
  summary(renderArmSummary(state));
  return "armed";
}

/**
 * Czeka na zakończenie przeliczania Test Clocka, ODPYTUJĄC jego status.
 *
 * Poprzednia wersja miała w tym miejscu `for i in $(seq 1 40); do sleep 60; done`
 * - 40 minut runnera co dobę, niezależnie od tego, czy Stripe skończył po
 * dwudziestu sekundach, i bez żadnej reakcji, gdyby nie skończył nigdy.
 */
async function awaitClock(auth: Auth): Promise<StepOutcome> {
  const state = readState();
  if (!state) return "skipped";

  const startedAt = Date.now();
  let delay = WAIT_POLL_MS;

  for (;;) {
    const clock = await api<StripeTestClock>(`/test_helpers/test_clocks/${state.testClockId}`, {
      auth,
    });

    if (clock.status === "ready") {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      summary(`Test Clock \`${clock.id}\` gotowy po ${seconds} s (status \`ready\`).`);
      return "ready";
    }

    if (clock.status === "internal_failure") {
      annotate(
        "error",
        "Test Clock padł po stronie Stripe",
        `Zegar ${clock.id} zakończył przeliczanie stanem internal_failure - odnowienia nie da się zweryfikować.`,
      );
      return "failed";
    }

    if (Date.now() - startedAt >= WAIT_TIMEOUT_MS) {
      // `pending`, nie `skipped`: opieszałość operatora nie jest naszym błędem
      // konfiguracyjnym, więc tryb ścisły nie ma jej zamieniać w czerwony job.
      annotate(
        "warning",
        "Test Clock wciąż przelicza",
        `Po ${Math.round(WAIT_TIMEOUT_MS / 1000)} s zegar ${clock.id} nadal ma status ${clock.status} - weryfikacja nierozstrzygnięta w tym przebiegu.`,
      );
      return "pending";
    }

    await sleep(Math.min(delay, Math.max(0, WAIT_TIMEOUT_MS - (Date.now() - startedAt))));
    // Łagodny backoff: gęsto na starcie (typowy przypadek to kilkadziesiąt
    // sekund), rzadziej przy dłuższym przeliczaniu.
    delay = Math.min(delay * 2, 30_000);
  }
}

function readState(): ProbeState | null {
  let raw: string;
  try {
    raw = readFileSync(STATE_FILE, "utf8");
  } catch {
    annotate(
      "warning",
      "Brak stanu sondy",
      "Krok `arm` nie zapisał stanu - dalsze kroki pominięte.",
    );
    return null;
  }
  const state = parseProbeState(raw);
  if (!state) {
    annotate(
      "warning",
      "Uszkodzony stan sondy",
      `Plik ${STATE_FILE} nie zawiera poprawnego stanu w wersji 1 - dalsze kroki pominięte.`,
    );
  }
  return state;
}

/**
 * Odpytuje NASZĄ bazę, aż odnowienie dotrze do naszej obsługi albo minie
 * termin. Porażka w dzienniku kończy odpytywanie od razu - czekanie jej nie
 * naprawi.
 */
async function awaitLocalSync(
  db: DbAuth,
  state: ProbeState,
  stripePeriodEnd: number | null,
): Promise<LocalSyncVerdict> {
  const startedAt = Date.now();

  for (;;) {
    const { webhookRows, subscription } = await probeStatus(db, state);

    const deadlineReached = Date.now() - startedAt >= DB_WAIT_TIMEOUT_MS;
    const verdict = classifyLocalSync({
      state,
      stripePeriodEnd,
      webhookRows,
      subscription,
      deadlineReached,
    });
    if (verdict.outcome !== "waiting") return verdict;

    await sleep(Math.min(DB_POLL_MS, Math.max(0, DB_WAIT_TIMEOUT_MS - (Date.now() - startedAt))));
  }
}

async function verify(auth: Auth): Promise<StepOutcome> {
  const state = readState();
  if (!state) return "skipped";

  const clock = await api<StripeTestClock>(`/test_helpers/test_clocks/${state.testClockId}`, {
    auth,
  });
  if (clock.status !== "ready") {
    annotate(
      "warning",
      "Test Clock nie jest gotowy",
      `Status ${clock.status} - Stripe nie zakończył przeliczania, weryfikacja nierozstrzygnięta.`,
    );
    return "pending";
  }

  const [subscription, invoices, dunning] = await Promise.all([
    api<StripeSubscription>(`/subscriptions/${state.subscriptionId}`, { auth }),
    api<StripeList<StripeInvoice>>(
      `/invoices?subscription=${encodeURIComponent(state.subscriptionId)}&limit=100`,
      { auth },
    ),
    api<StripeList<StripeSubscription>>("/subscriptions?status=past_due&limit=100", { auth }),
  ]);

  const verdict = classifyRenewal({ subscription, invoices: invoices.data ?? [], state });
  const dunningCensus = (dunning.data ?? []).length;

  summary(renderVerifySummary({ state, subscription, verdict, dunningCensus }));

  const endpoint = await verifyWebhookEndpoints(auth);
  summary(renderWebhookEndpointSummary(endpoint));

  // Nasza strona ma sens wyłącznie wtedy, gdy operator potwierdził odnowienie
  // albo dunning - przy porażce operatora nie ma czego u nas szukać.
  let local: LocalSyncVerdict | null = null;
  let outcome: ProbeOutcome = verdict.outcome;
  if (verdict.outcome === "renewed" || verdict.outcome === "dunning") {
    const db = dbKeys();
    if (db) {
      local = await awaitLocalSync(db, state, verdict.periodEnd);
      summary(renderLocalSyncSummary(local));
      outcome = combineOutcomes(verdict.outcome, local);
    } else {
      // Tu dociera wyłącznie przebieg ręczny - w trybie ścisłym brak dostępu
      // do bazy zatrzymał `verify` już w `main`, jak brak kluczy operatora.
      annotate(
        "warning",
        "Sonda nie widzi naszej strony",
        "Ustaw PROBE_SUPABASE_URL, PROBE_SUPABASE_PUBLISHABLE_KEY oraz BILLING_PROBE_TOKEN - " +
          "bez nich sonda potwierdza wyłącznie stan u operatora, a nie odbiór odnowienia " +
          "przez nasz webhook.",
      );
    }
  }
  outcome = withEndpointVerdict(outcome, endpoint);

  writeJson(REPORT_FILE, {
    generatedAt: new Date().toISOString(),
    outcome,
    stripeOutcome: verdict.outcome,
    reason: verdict.reason,
    subscriptionId: state.subscriptionId,
    subscriptionStatus: subscription.status,
    renewalInvoiceId: verdict.renewalInvoice?.id ?? null,
    renewalInvoiceStatus: verdict.renewalInvoice?.status ?? null,
    previousPeriodEnd: state.previousPeriodEnd,
    periodEnd: verdict.periodEnd,
    periodMoved: verdict.periodMoved,
    dunningCensus,
    webhookEndpoint: {
      outcome: endpoint.outcome,
      reason: endpoint.reason,
      checked: endpoint.checked,
      gaps: endpoint.gaps,
    },
    local: local
      ? {
          outcome: local.outcome,
          reason: local.reason,
          processedEvents: local.processedEvents,
          failedEventIds: local.failedEvents.map((row) => row.event_id),
          localPeriodEnd: local.localPeriodEnd,
        }
      : null,
  });

  if (endpoint.outcome === "failed") {
    annotate(
      "error",
      "Punkt odbioru webhooków piaskownicy nie subskrybuje obsługiwanych zdarzeń",
      endpoint.reason,
    );
  }
  if (verdict.outcome === "failed") {
    annotate("error", "Regresja odnowienia lub dunningu", verdict.reason);
  } else if (verdict.outcome === "pending") {
    annotate("warning", "Wynik nierozstrzygnięty", verdict.reason);
  } else if (local && local.outcome !== "synced") {
    annotate("error", "Nasza strona nie odebrała odnowienia", local.reason);
  }
  return outcome;
}

type Mode = "arm" | "await" | "verify";

function resolveMode(argument: string | undefined): Mode {
  if (argument === "wait") return "await";
  if (argument === undefined || argument === "arm") return "arm";
  if (argument === "await" || argument === "verify") return argument;
  throw new Error(`Unknown probe mode: ${argument}. Use arm, wait or verify.`);
}

async function main(): Promise<void> {
  const mode = resolveMode(process.argv[2]);
  const auth = keys();
  const strict = STRICT || process.env.PROBE_REQUIRE_CONFIG === "true";
  if (!auth) {
    annotate(
      strict ? "error" : "warning",
      "Sonda rozliczeń nieskonfigurowana",
      "Ustaw STRIPE_SANDBOX_API_KEY oraz LOVABLE_API_KEY.",
    );
    setOutput("outcome", "skipped");
    if (strict) process.exitCode = 1;
    return;
  }
  // Weryfikacja bez dostępu do NASZEJ bazy widzi tylko operatora - przegapia
  // awarię naszego webhooka, czyli najdroższy scenariusz. W trybie ścisłym to
  // ten sam błąd konfiguracji co brak kluczy operatora; ręcznie - ostrzeżenie
  // w `verify` i weryfikacja samego operatora.
  if (mode === "verify" && strict && !dbKeys()) {
    annotate(
      "error",
      "Sonda rozliczeń nieskonfigurowana",
      "Ustaw PROBE_SUPABASE_URL, PROBE_SUPABASE_PUBLISHABLE_KEY oraz BILLING_PROBE_TOKEN " +
        "(krok weryfikacji; token z `SELECT public.billing_probe_rotate_token();`).",
    );
    setOutput("outcome", "skipped");
    process.exitCode = 1;
    return;
  }
  const outcome =
    mode === "verify"
      ? await verify(auth)
      : mode === "await"
        ? await awaitClock(auth)
        : await arm(auth);
  setOutput("outcome", outcome);
  if (
    (outcome !== "armed" && outcome !== "ready" && isFailure(outcome)) ||
    (strict && (outcome === "skipped" || outcome === "pending"))
  ) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  annotate(
    "error",
    "Sonda rozliczeń przerwana",
    error instanceof Error ? error.message : String(error),
  );
  setOutput("outcome", "failed");
  process.exitCode = 1;
});
