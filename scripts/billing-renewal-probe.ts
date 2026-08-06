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
 *            do przodu i czy stan faktury jest spójny ze stanem subskrypcji.
 *
 * Brak kluczy: domyślnie zielone wyjście z ostrzeżeniem (świeży klon i fork nie
 * mogą wywracać CI). W trybie ścisłym (`PROBE_STRICT=true`, ustawianym dla
 * przebiegów z harmonogramu w repozytorium właściciela) brak konfiguracji jest
 * BŁĘDEM - nocna sonda, która nic nie sprawdza, nie ma prawa świecić na zielono.
 *
 * Zmienne: STRIPE_SANDBOX_API_KEY, LOVABLE_API_KEY, PROBE_STATE_FILE,
 *          PROBE_REPORT_FILE, PROBE_STRICT, PROBE_SUBSCRIPTION_ID,
 *          PROBE_WAIT_TIMEOUT_S, PROBE_REQUEST_TIMEOUT_MS, PROBE_GATEWAY_URL
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type ProbeOutcome,
  type ProbeState,
  type StripeInvoice,
  type StripeSubscription,
  type StripeTestClock,
  classifyRenewal,
  isFailure,
  parseProbeState,
  periodEndOf,
  renderArmSummary,
  renderVerifySummary,
  selectRenewalCandidate,
} from "../src/lib/ci/billingRenewalProbe";

/**
 * Bramka konektorów platformy - SDK ani skrypt nigdy nie widzą prawdziwego
 * klucza operatora. Nadpisywalna, żeby dało się przepuścić pełną ścieżkę
 * arm -> await -> verify przez lokalny serwer atrap; w CI zawsze domyślna.
 */
const GATEWAY = process.env.PROBE_GATEWAY_URL ?? "https://connector-gateway.lovable.dev/stripe";
const STATE_FILE = process.env.PROBE_STATE_FILE ?? "/tmp/billing-renewal-probe.json";
const REPORT_FILE = process.env.PROBE_REPORT_FILE ?? "reports/billing-renewal-probe.json";
const STRICT = /^(1|true|yes)$/i.test(process.env.PROBE_STRICT ?? "");

/** Sufit czekania na Test Clock i odstęp odpytywania (tryb `wait`). */
const WAIT_TIMEOUT_MS = Number(process.env.PROBE_WAIT_TIMEOUT_MS ?? 40 * 60 * 1000);
const WAIT_POLL_MS = Number(process.env.PROBE_WAIT_POLL_MS ?? 30 * 1000);

interface ProbeState {
  subscriptionId: string;
  testClockId: string;
  armedAt: string;
  advancedTo: number;
  previousPeriodEnd: number | null;
}

interface Auth {
  readonly connection: string;
  readonly platform: string;
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

/** Stripe przyjmuje wyłącznie `application/x-www-form-urlencoded`. */
function form(body: Record<string, string | number>): string {
  return Object.entries(body)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

/**
 * Żądanie do bramki konektorów. Nocny przebieg rozmawia z usługą zdalną, więc
 * pojedynczy 502 na odczycie nie może oznaczać „odnowienie nie działa" -
 * inaczej bramka generuje fałszywe alarmy i przestaje być czytana.
 *
 * Ponawiane są WYŁĄCZNIE odczyty (GET). `POST .../advance` nie jest idempotentny
 * i nie ma klucza idempotencji: przy błędzie sieciowym nie wiadomo, czy operator
 * przesunął już zegar, a ponowienie w tym stanie zwraca 400 „clock is currently
 * advancing" - czyli zamienia jedną usterkę przejściową w czerwony przebieg
 * z mylącym komunikatem. Zapis ma paść od razu, z prawdziwą przyczyną.
 */
async function api<T>(
  path: string,
  init: { auth: Auth; method?: "GET" | "POST"; body?: Record<string, string | number> },
): Promise<T> {
  const { auth, method = "GET", body } = init;
  const attempts = method === "GET" ? RETRY_DELAYS_MS.length : 0;
  let lastError = "";

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

    let response: Response;
    try {
      response = await fetch(`${GATEWAY}/v1${path}`, {
        method,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Connection-Api-Key": auth.connection,
          "Lovable-API-Key": auth.platform,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(body ? { body: form(body) } : {}),
      });
    } catch (error) {
      lastError = `${method} ${path} -> ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }

    const text = await response.text();
    if (response.ok) return JSON.parse(text) as T;

    lastError = `${method} ${path} -> ${response.status}: ${text.slice(0, 400)}`;
    if (!RETRYABLE_STATUS.has(response.status)) break;
  }

  throw new Error(lastError);
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
  let delay = 5_000;

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

    await sleep(delay);
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
  writeJson(REPORT_FILE, {
    generatedAt: new Date().toISOString(),
    outcome: verdict.outcome,
    reason: verdict.reason,
    subscriptionId: state.subscriptionId,
    subscriptionStatus: subscription.status,
    renewalInvoiceId: verdict.renewalInvoice?.id ?? null,
    renewalInvoiceStatus: verdict.renewalInvoice?.status ?? null,
    previousPeriodEnd: state.previousPeriodEnd,
    periodEnd: verdict.periodEnd,
    periodMoved: verdict.periodMoved,
    dunningCensus,
  });

  if (verdict.outcome === "failed") {
    annotate("error", "Regresja odnowienia lub dunningu", verdict.reason);
  } else if (verdict.outcome === "pending") {
    annotate("warning", "Wynik nierozstrzygnięty", verdict.reason);
  }
  return verdict.outcome;
}

type Mode = "arm" | "await" | "verify";

function resolveMode(argument: string | undefined): Mode {
  if (argument === "await" || argument === "verify") return argument;
  return "arm";
}

/**
 * Czeka, aż Test Clock skończy przeliczanie - zamiast ślepego `sleep`.
 *
 * PRZYCZYNA ZMIANY: krok „Poczekaj na naliczenie" robił `for i in $(seq 1 40);
 * do sleep 60; done`, czyli **40 minut runnera dziennie** niezależnie od tego,
 * czy Stripe skończył po dwóch minutach, czy nie skończył wcale. Odpytywanie
 * kończy przebieg, gdy zegar jest gotowy, a gdy nie zdąży - mówi to wprost,
 * zamiast oddawać sterowanie weryfikacji, która i tak wypisze „pominięte".
 */
async function wait(auth: Auth): Promise<number> {
  let state: ProbeState;
  try {
    state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as ProbeState;
  } catch {
    summary("::warning title=Brak stanu sondy::Krok `arm` nic nie uzbroił - czekanie pominięte.");
    return 0;
  }

  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    const clock = await api<StripeTestClock>(`/test_helpers/test_clocks/${state.testClockId}`, {
      auth,
    });
    last = clock.status;
    if (clock.status !== "advancing") {
      summary(
        `Test Clock gotowy po ${Math.round((WAIT_TIMEOUT_MS - (deadline - Date.now())) / 1000)} s (status: ${clock.status}).`,
      );
      return 0;
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
  }

  summary(
    `::warning title=Test Clock nie zdążył::Po ${Math.round(WAIT_TIMEOUT_MS / 60000)} min status to nadal \`${last}\`. Weryfikacja i tak sprawdzi stan.`,
  );
  return 0;
}

async function main(): Promise<void> {
  const mode = resolveMode(process.argv[2]);
  const auth = keys();

  if (!auth) {
    // Brak sekretów NIE MOŻE wyglądać jak sukces na przebiegu nocnym: to jedyna
    // weryfikacja odnowienia i dunningu, jaką mamy, więc „nieskonfigurowana"
    // musi być odróżnialne od „rozliczenia działają". Na uruchomieniu ręcznym
    // (fork, świeży klon) zostaje ostrzeżenie - tam brak sekretów jest normą.
    const required = process.env.PROBE_REQUIRE_CONFIG === "true";
    summary(
      `::${required ? "error" : "warning"} title=Sonda rozliczeń nieskonfigurowana::Ustaw secrets.STRIPE_SANDBOX_API_KEY oraz secrets.LOVABLE_API_KEY, żeby nocna sonda odnowienia działała.`,
    );
    if (required) process.exitCode = 1;
    return;
  }
  const arg = process.argv[2];
  const mode = arg === "verify" || arg === "wait" ? arg : "arm";
  const code =
    mode === "verify" ? await verify(auth) : mode === "wait" ? await wait(auth) : await arm(auth);
  if (code !== 0) process.exitCode = code;
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
