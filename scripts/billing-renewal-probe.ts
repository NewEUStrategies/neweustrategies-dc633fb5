/**
 * Nocna sonda odnowienia i dunningu w środowisku testowym Stripe.
 *
 * Dlaczego istnieje: odnowienie subskrypcji i ścieżka nieudanej płatności są
 * jedynymi elementami lejka, których nie da się sprawdzić klikając checkout -
 * trzeba przesunąć zegar rozliczeniowy i poczekać, aż Stripe naliczy fakturę.
 * Sonda robi to za nas i zostawia dowód w podsumowaniu przebiegu CI.
 *
 * Jak to działa w Stripe (inaczej niż u poprzedniego operatora): nie da się
 * dowolnie przesunąć `next_billed_at`. Odnowienie w sandboxie wymusza się
 * przez Test Clock przypięty do klienta subskrypcji - sonda przesuwa zegar
 * tuż za koniec bieżącego okresu i weryfikuje, czy powstała nowa faktura.
 *
 * Tryby:
 *   arm    - wybiera aktywną subskrypcję testową z Test Clockiem, przesuwa
 *            zegar na `current_period_end + 60 s` i zapisuje stan do pliku
 *            wskazanego przez PROBE_STATE_FILE,
 *   verify - sprawdza, czy po armowaniu powstała nowa faktura i czy okres
 *            rozliczeniowy przesunął się do przodu; dodatkowo raportuje
 *            subskrypcje w stanie `past_due` (dunning).
 *
 * Brak kluczy = zielone wyjście z ostrzeżeniem: świeży klon i fork nie mogą
 * wywracać CI, ale brak konfiguracji ma być widoczny.
 */
import { readFileSync, writeFileSync } from "node:fs";

const GATEWAY = "https://connector-gateway.lovable.dev/stripe";
const STATE_FILE = process.env.PROBE_STATE_FILE ?? "/tmp/billing-renewal-probe.json";

interface ProbeState {
  subscriptionId: string;
  testClockId: string;
  armedAt: string;
  advancedTo: number;
  previousPeriodEnd: number | null;
}

interface StripeSubscriptionItem {
  quantity?: number;
  current_period_end?: number | null;
  price?: { lookup_key?: string | null } | null;
}

interface StripeSubscription {
  id: string;
  status: string;
  customer: string | { id: string; test_clock?: string | { id: string } | null };
  test_clock?: string | { id: string } | null;
  items?: { data?: StripeSubscriptionItem[] };
}

interface StripeInvoice {
  id: string;
  status: string | null;
  created: number;
  billing_reason?: string | null;
}

interface StripeList<T> {
  data?: T[];
}

interface StripeTestClock {
  id: string;
  status: string;
  frozen_time: number;
}

interface Auth {
  connection: string;
  platform: string;
}

function summary(line: string): void {
  console.log(line);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) writeFileSync(file, `${line}\n`, { flag: "a" });
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
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

async function api<T>(
  path: string,
  init: { auth: Auth; method?: "GET" | "POST"; body?: Record<string, string | number> },
): Promise<T> {
  const { auth, method = "GET", body } = init;
  const res = await fetch(`${GATEWAY}/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Connection-Api-Key": auth.connection,
      "Lovable-API-Key": auth.platform,
    },
    ...(body ? { body: form(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as T;
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function periodEndOf(sub: StripeSubscription): number | null {
  // W API `2026-03-25.dahlia` okres rozliczeniowy żyje na pozycji subskrypcji.
  const ends = (sub.items?.data ?? [])
    .map((item) => item.current_period_end ?? null)
    .filter((v): v is number => typeof v === "number");
  return ends.length ? Math.max(...ends) : null;
}

async function arm(auth: Auth): Promise<number> {
  const listed = await api<StripeList<StripeSubscription>>(
    "/subscriptions?status=active&limit=50&expand[]=data.customer",
    { auth },
  );
  // Odnowienie da się wymusić tylko na subskrypcji z Test Clockiem - inaczej
  // trzeba by czekać realny miesiąc.
  const candidate = (listed.data ?? []).find((sub) => {
    const clock =
      idOf(sub.test_clock) ??
      (typeof sub.customer === "object" ? idOf(sub.customer.test_clock) : null);
    return sub.status === "active" && !!clock && periodEndOf(sub) !== null;
  });
  const testClockId = candidate
    ? (idOf(candidate.test_clock) ??
      (typeof candidate.customer === "object" ? idOf(candidate.customer.test_clock) : null))
    : null;

  if (!candidate || !testClockId) {
    summary(
      "::warning title=Brak subskrypcji testowej z Test Clockiem::Sonda odnowienia pominięta - w sandboxie Stripe nie ma aktywnej subskrypcji przypiętej do Test Clocka. Utwórz klienta z Test Clockiem i wykonaj checkout kartą 4242 4242 4242 4242.",
    );
    return 0;
  }

  const previousPeriodEnd = periodEndOf(candidate);
  const advancedTo = (previousPeriodEnd ?? Math.floor(Date.now() / 1000)) + 60;
  await api(`/test_helpers/test_clocks/${testClockId}/advance`, {
    auth,
    method: "POST",
    body: { frozen_time: advancedTo },
  });

  const state: ProbeState = {
    subscriptionId: candidate.id,
    testClockId,
    armedAt: new Date().toISOString(),
    advancedTo,
    previousPeriodEnd,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state));
  summary(
    `### Sonda odnowienia\nSubskrypcja \`${candidate.id}\` - Test Clock \`${testClockId}\` przesunięty na ${new Date(advancedTo * 1000).toISOString()}.`,
  );
  return 0;
}

async function verify(auth: Auth): Promise<number> {
  let state: ProbeState;
  try {
    state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as ProbeState;
  } catch {
    summary(
      "::warning title=Brak stanu sondy::Krok `arm` nie zapisał stanu - weryfikacja pominięta.",
    );
    return 0;
  }

  const clock = await api<StripeTestClock>(`/test_helpers/test_clocks/${state.testClockId}`, {
    auth,
  });
  if (clock.status === "advancing") {
    summary(
      "::warning title=Test Clock wciąż przesuwa czas::Stripe nie zakończył przeliczania - weryfikacja pominięta w tym przebiegu.",
    );
    return 0;
  }

  const sub = await api<StripeSubscription>(`/subscriptions/${state.subscriptionId}`, { auth });
  const periodEnd = periodEndOf(sub);
  const moved =
    periodEnd !== null && (state.previousPeriodEnd === null || periodEnd > state.previousPeriodEnd);

  const invoices = await api<StripeList<StripeInvoice>>(
    `/invoices?subscription=${state.subscriptionId}&limit=20`,
    { auth },
  );
  const armedAtUnix = Math.floor(new Date(state.armedAt).getTime() / 1000);
  const renewal = (invoices.data ?? []).find(
    (inv) => inv.created >= armedAtUnix || inv.billing_reason === "subscription_cycle",
  );

  const pastDue = await api<StripeList<StripeSubscription>>(
    "/subscriptions?status=past_due&limit=50",
    { auth },
  );

  summary(
    [
      "### Weryfikacja odnowienia",
      `- subskrypcja: \`${state.subscriptionId}\``,
      `- nowa faktura: ${renewal ? `\`${renewal.id}\` (${renewal.status ?? "-"})` : "brak"}`,
      `- okres rozliczeniowy przesunięty: ${moved ? "tak" : "nie"} (${periodEnd ? new Date(periodEnd * 1000).toISOString() : "-"})`,
      `- subskrypcje w dunningu (past_due): ${(pastDue.data ?? []).length}`,
    ].join("\n"),
  );

  if (!renewal || !moved) {
    summary(
      "::error title=Odnowienie nie zadziałało::Po przesunięciu Test Clocka Stripe nie wystawił faktury odnowieniowej albo okres się nie przesunął - sprawdź dziennik webhooków w panelu administratora.",
    );
    return 1;
  }
  return 0;
}

async function main(): Promise<void> {
  const auth = keys();
  if (!auth) {
    summary(
      "::warning title=Sonda rozliczeń nieskonfigurowana::Ustaw secrets.STRIPE_SANDBOX_API_KEY oraz secrets.LOVABLE_API_KEY, żeby nocna sonda odnowienia działała.",
    );
    return;
  }
  const mode = process.argv[2] === "verify" ? "verify" : "arm";
  const code = mode === "verify" ? await verify(auth) : await arm(auth);
  if (code !== 0) process.exitCode = code;
}

void main().catch((e: unknown) => {
  summary(`::error title=Sonda rozliczeń przerwana::${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
