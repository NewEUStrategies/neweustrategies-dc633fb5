/**
 * Nocna sonda odnowienia i dunningu w środowisku testowym operatora płatności.
 *
 * Dlaczego istnieje: odnowienie subskrypcji i ścieżka nieudanej płatności są
 * jedynymi elementami lejka, których nie da się sprawdzić klikając checkout -
 * trzeba przesunąć datę kolejnego obciążenia i poczekać, aż operator naliczy.
 * Sonda robi to za nas i zostawia dowód w podsumowaniu przebiegu CI.
 *
 * Tryby:
 *   arm    - wybiera aktywną subskrypcję testową i przesuwa `next_billed_at`
 *            na +31 minut (minimum wymagane przez operatora), zapisując stan
 *            do pliku wskazanego przez PROBE_STATE_FILE,
 *   verify - sprawdza, czy po armowaniu powstała nowa transakcja i czy okres
 *            rozliczeniowy przesunął się do przodu; dodatkowo raportuje
 *            subskrypcje w stanie `past_due` (dunning).
 *
 * Brak kluczy = zielone wyjście z ostrzeżeniem: świeży klon i fork nie mogą
 * wywracać CI, ale brak konfiguracji ma być widoczny.
 */
import { readFileSync, writeFileSync } from "node:fs";

const GATEWAY = "https://connector-gateway.lovable.dev/paddle";
const STATE_FILE = process.env.PROBE_STATE_FILE ?? "/tmp/billing-renewal-probe.json";

interface ProbeState {
  subscriptionId: string;
  armedAt: string;
  nextBilledAt: string;
  previousPeriodEnd: string | null;
}

interface SubscriptionItem {
  quantity?: number;
  price?: { import_meta?: { external_id?: string | null } | null } | null;
}

interface Subscription {
  id: string;
  status: string;
  next_billed_at?: string | null;
  current_billing_period?: { starts_at?: string | null; ends_at?: string | null } | null;
  items?: SubscriptionItem[];
}

interface TransactionRow {
  id: string;
  status: string;
  created_at: string;
  origin?: string;
}

function summary(line: string): void {
  console.log(line);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) writeFileSync(file, `${line}\n`, { flag: "a" });
}

function keys(): { connection: string; lovable: string } | null {
  const connection = process.env.PADDLE_SANDBOX_API_KEY;
  const lovable = process.env.LOVABLE_API_KEY;
  if (!connection || !lovable) return null;
  return { connection, lovable };
}

async function api<T>(
  path: string,
  init: RequestInit & { auth: { connection: string; lovable: string } },
): Promise<T> {
  const { auth, ...rest } = init;
  const res = await fetch(`${GATEWAY}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      "X-Connection-Api-Key": auth.connection,
      "Lovable-API-Key": auth.lovable,
      ...rest.headers,
    },
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as T;
}

async function arm(auth: { connection: string; lovable: string }): Promise<number> {
  const listed = await api<{ data?: Subscription[] }>("/subscriptions?status=active&per_page=50", {
    auth,
  });
  // Subskrypcja w okresie próbnym wymaga `do_not_bill`, a jej odnowienie nie
  // tworzy transakcji - do sondy nadaje się wyłącznie subskrypcja płacąca.
  const candidate = (listed.data ?? []).find((s) => s.status === "active" && !!s.next_billed_at);
  if (!candidate) {
    summary(
      "::warning title=Brak subskrypcji testowej::Sonda odnowienia pominięta - w środowisku testowym nie ma aktywnej subskrypcji. Wykonaj checkout kartą 4242 4242 4242 4242.",
    );
    return 0;
  }

  const nextBilledAt = new Date(Date.now() + 31 * 60_000).toISOString();
  await api(`/subscriptions/${candidate.id}`, {
    auth,
    method: "PATCH",
    body: JSON.stringify({ next_billed_at: nextBilledAt, proration_billing_mode: "do_not_bill" }),
  });

  const state: ProbeState = {
    subscriptionId: candidate.id,
    armedAt: new Date().toISOString(),
    nextBilledAt,
    previousPeriodEnd: candidate.current_billing_period?.ends_at ?? null,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state));
  summary(
    `### Sonda odnowienia\nSubskrypcja \`${candidate.id}\` - obciążenie przesunięte na ${nextBilledAt}.`,
  );
  return 0;
}

async function verify(auth: { connection: string; lovable: string }): Promise<number> {
  let state: ProbeState;
  try {
    state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as ProbeState;
  } catch {
    summary(
      "::warning title=Brak stanu sondy::Krok `arm` nie zapisał stanu - weryfikacja pominięta.",
    );
    return 0;
  }

  const sub = await api<{ data?: Subscription }>(`/subscriptions/${state.subscriptionId}`, {
    auth,
  });
  const periodEnd = sub.data?.current_billing_period?.ends_at ?? null;
  const moved =
    !!periodEnd &&
    (!state.previousPeriodEnd || new Date(periodEnd) > new Date(state.previousPeriodEnd));

  const txs = await api<{ data?: TransactionRow[] }>(
    `/transactions?subscription_id=${state.subscriptionId}&per_page=20`,
    { auth },
  );
  const renewal = (txs.data ?? []).find(
    (t) => new Date(t.created_at).getTime() >= new Date(state.armedAt).getTime(),
  );

  const pastDue = await api<{ data?: Subscription[] }>(
    "/subscriptions?status=past_due&per_page=50",
    {
      auth,
    },
  );

  summary(
    [
      "### Weryfikacja odnowienia",
      `- subskrypcja: \`${state.subscriptionId}\``,
      `- nowa transakcja: ${renewal ? `\`${renewal.id}\` (${renewal.status})` : "brak"}`,
      `- okres rozliczeniowy przesunięty: ${moved ? "tak" : "nie"} (${periodEnd ?? "-"})`,
      `- subskrypcje w dunningu (past_due): ${(pastDue.data ?? []).length}`,
    ].join("\n"),
  );

  if (!renewal || !moved) {
    summary(
      "::error title=Odnowienie nie zadziałało::Po przesunięciu daty operator nie naliczył odnowienia albo okres się nie przesunął - sprawdź dziennik webhooków w panelu administratora.",
    );
    return 1;
  }
  return 0;
}

async function main(): Promise<void> {
  const auth = keys();
  if (!auth) {
    summary(
      "::warning title=Sonda rozliczeń nieskonfigurowana::Ustaw secrets.PADDLE_SANDBOX_API_KEY oraz secrets.LOVABLE_API_KEY, żeby nocna sonda odnowienia działała.",
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
