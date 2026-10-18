// Siatka bezpieczeństwa po stronie webhooka: DRUGA żywa subskrypcja PLANU
// tego samego konta.
//
// PO CO, SKORO KASA JUŻ BLOKUJE. Kasa planu (`planSubscriptionGuard`,
// `adhocCheckout.server`: wygaszanie otwartych sesji i kontrola wyścigu po
// utworzeniu) zamyka drogę do drugiej subskrypcji, ale tylko tę, która
// przechodzi przez NASZĄ kasę. Obok zostają trzy drogi, których kasa nie
// widzi: subskrypcja założona ręcznie w panelu operatora, skrajny wyścig
// dwóch sesji i świadomie dopuszczony osobny zakup w innym modelu
// rozliczenia (Zespół za miejsce <-> plan indywidualny). Do dziś organizator
// dowiadywał się o podwójnym obciążeniu z reklamacji klienta.
//
// KIEDY SPRAWDZAMY.
//   * Subskrypcja z właścicielem w metadanych (nasza kasa, wyścig, osobny
//     zakup): RAZ, przy PIERWSZYM wejściu w stan uprawniający - w chwili, gdy
//     webhook wygrywa atomowe zajęcie potwierdzenia zakupu
//     (`claimPurchaseConfirmation`). To samo zajęcie niesie `created` w
//     `active|trialing` i `updated` po 3DS albo przelewie (`created` jako
//     `incomplete`, potem `active` - zwykła droga kart z UE). Wcześniej
//     sprawdzenie szło tylko przy wstawieniu wiersza, a `incomplete` je
//     pomijało, więc większość duplikatów z kasy nie dzwoniła wcale.
//     Ponowienie po sukcesie zastaje zajęte potwierdzenie i nie sprawdza drugi
//     raz; ponowienie po awarii PRZED zajęciem (zapis uprawnienia, newsletter)
//     dochodzi do zajęcia i sprawdza wtedy. Lustrzany przypadek (to INNA
//     subskrypcja była jeszcze `incomplete`) łapie sprawdzenie przy JEJ
//     aktywacji.
//   * Subskrypcja bez `metadata.userId` (panel operatora - metadane wpisuje
//     tam tylko człowiek): wiersza w lustrze nie zakładamy i dostępu nie
//     nadajemy, jak dotąd. Właściciela bierzemy z NASZYCH wierszy
//     `subscriptions` tego samego klienta operatora i środowiska (jak
//     `customerSync.server`), przy każdym zdarzeniu w stanie uprawniającym -
//     bez wiersza nie ma czym zapamiętać „już sprawdzone", więc powtórki
//     tłumi bramka niżej (najwyżej jeden dzwonek na dobę dla tego samego
//     zbioru subskrypcji; kolejny cykl takiego duplikatu to kolejne podwójne
//     obciążenie, więc przypomnienie jest zamierzone). Klient, którego nie
//     znamy, nie ma najemcy - zostaje log `missing customData.userId`.
//
// CO ROBIMY, A CZEGO NIE.
//   * Tylko alarm dla administratorów najemcy (`notifyTenantAdmins`) i głośny
//     log. NIC nie anulujemy automatycznie: która subskrypcja jest zbędna,
//     wie człowiek (zwrot, proracja, rozmowa z klientem), a pomyłka
//     automatu to odcięcie płacącego.
//   * Najemca i właściciel pochodzą z WIERSZY W BAZIE (RETURNING wstawienia,
//     odczyt `existing` aktualizacji albo wiersze tego samego klienta;
//     `tenant_id` przypina trigger z profilu właściciela), nigdy z ładunku.
//   * Liczą się wyłącznie żywe subskrypcje planu (te same statusy, które
//     blokują zakup - `LIVE_PLAN_SUBSCRIPTION_STATUSES`) w TYM SAMYM najemcy
//     i środowisku. Darowizny cykliczne odpadają po obu stronach: nowa
//     z `metadata.purpose = "donation"` i istniejący wiersz, którego
//     identyfikator zna rejestr darowizn.
//   * Osobny zakup w innym modelu rozliczenia rozpoznaje TA SAMA reguła co
//     kasa (`planPurchaseConflict` -> `catalogSwitchRefusal`): `null` znaczy
//     „dozwolony osobny zakup", więc alarm jest wtedy informacyjny (niższa
//     waga), a nie ostrzeżeniem o podwójnym obciążeniu. Subskrypcja spoza
//     lustra zawsze OSTRZEGA: nie nadała dostępu, więc nawet osobny zakup to
//     pieniądze bez uprawnienia.
//
// DEDUPLIKACJA. Klucz jest DETERMINISTYCZNY: posortowany zbiór
// identyfikatorów subskrypcji (A widzi B i B widzi A dają ten sam klucz).
// Sama deduplikacja `enqueue_notification` (odbiorca, rodzaj, href) NIE
// wystarcza: to nieatomowe `IF EXISTS ... RETURN; INSERT` w oknie 5 minut, więc
// dwa sprawdzenia z równoległych izolatów mijają się między sprawdzeniem
// a zapisem i każdy administrator dostaje dwa dzwonki. Dlatego przed
// dzwonkiem stoi ATOMOWA bramka `rate_limit_hit` (INSERT ... ON CONFLICT DO
// UPDATE RETURNING, limit 1 na zakres + najemcę + środowisko + klucz), tak jak
// bramka powtórzeń SMS (`notify/sms.server`). Okno to doba (najdłuższe okno,
// które przeżywa retencję `rate_limits`), wyrównane do epoki: dwa sprawdzenia
// rozdzielone granicą okna przejdą oba - wtedy zostaje już tylko okno
// `enqueue_notification`, a dla sprawdzeń sekundy od siebie to praktycznie
// zawsze dość. Awaria bramki NIE wycisza alarmu (fail-open): podwójny dzwonek
// jest tańszy niż przegapione podwójne obciążenie.
//
// NIGDY NIE RZUCA I NIE WSTRZYMUJE WEBHOOKA: sprawdzenie biegnie za
// odpowiedzią (`runAfterResponse` -> `ctx.waitUntil`), chwilowy błąd odczytu
// ponawia samo (krótko, w tle - drugiej okazji przy tym samym zajęciu nie
// będzie), a każdy błąd ostateczny kończy się logiem. Awaria alarmu nie może
// kosztować klienta uprawnienia, za które zapłacił.
//
// TREŚĆ NIESIE TYLKO IDENTYFIKATORY subskrypcji operatora - żadnych adresów
// e-mail ani nazwisk (jak każdy alarm `tenantAdminAlert`).
import type { PostgrestSingleResponse } from "@supabase/supabase-js";

import { isEntitledSubscriptionStatus } from "@/lib/billing/accessPeriod";
import { catalogEntryByPriceId } from "@/lib/billing/catalog";
import {
  LIVE_PLAN_SUBSCRIPTION_STATUSES,
  planPurchaseConflict,
} from "@/lib/billing/planSubscriptionGuard";
import { runAfterResponse } from "@/lib/http/waitUntil.server";
import type { StripeEnv } from "@/lib/stripe.server";

/**
 * Waga alarmu: `warning` = ten sam model rozliczenia (klient płaci dwa razy za
 * jeden dostęp), `info` = świadomie dopuszczony osobny zakup w innym modelu.
 */
export type DuplicatePlanAlertSeverity = "warning" | "info";

export interface DuplicatePlanSubscriptionInput {
  /** Identyfikator operatora subskrypcji, która właśnie weszła w stan uprawniający. */
  subscriptionId: string;
  /** Właściciel z wiersza w bazie (RETURNING albo `existing`), nie z ładunku. */
  userId: string;
  /** Najemca z wiersza w bazie (trigger z profilu właściciela), nie z ładunku. */
  tenantId: string;
  environment: StripeEnv;
  /** `lookup_key` ceny subskrypcji (`subscriptions.price_id`). */
  priceId: string;
  /** Znormalizowany status operatora w chwili sprawdzenia. */
  status: string;
  /** `metadata.purpose` z ładunku - `donation` to nie plan. */
  purpose?: string | null;
}

/**
 * Subskrypcja bez właściciela w metadanych (panel operatora). Ładunek daje
 * WYŁĄCZNIE klucz klienta operatora; właściciela i najemcę czytamy z naszych
 * wierszy tego klienta.
 */
export interface UnmirroredPlanSubscriptionInput {
  subscriptionId: string;
  customerId: string;
  environment: StripeEnv;
  /** `lookup_key` ceny - spoza katalogu planów to nie plan. */
  priceId: string | null;
  status: string;
  purpose?: string | null;
}

export type DuplicatePlanSubscriptionOutcome =
  | {
      kind: "skipped";
      reason: "donation" | "not_entitled" | "not_a_plan" | "unknown_customer" | "mirrored";
    }
  | { kind: "none" }
  | {
      kind: "alerted";
      severity: DuplicatePlanAlertSeverity;
      otherSubscriptionIds: string[];
      dedupeKey: string;
      /** Liczba dzwonków doręczonych administratorom (0 = brak administratora albo awaria dzwonka). */
      delivered: number;
    }
  | {
      /** Ten sam zbiór subskrypcji już zadzwonił (bramka jednokrotności) - tylko log. */
      kind: "deduped";
      severity: DuplicatePlanAlertSeverity;
      otherSubscriptionIds: string[];
      dedupeKey: string;
    }
  | { kind: "failed" };

/**
 * Górna granica wierszy w odczycie: konto z kilkunastoma żywymi planami to już
 * incydent, a treść dzwonka i tak wymienia identyfikatory jeden po drugim.
 */
const MAX_OTHER_SUBSCRIPTIONS = 10;

/** Górna granica wierszy jednego klienta operatora przy szukaniu właściciela. */
const MAX_CUSTOMER_ROWS = 25;

/**
 * Bramka jednokrotności dzwonka (`rate_limit_hit`, limit 1). Doba to
 * najdłuższe okno, które przeżywa retencję `rate_limits` (wiersze starsze niż
 * 2 doby znikają co godzinę, 20261007140800).
 */
const ALERT_GATE_SCOPE = "billing.duplicate_plan_alert";
const ALERT_GATE_WINDOW_MINUTES = 24 * 60;

/**
 * Przerwy przed ponowieniem odczytu (żywe subskrypcje, właściciel klienta
 * operatora). Sprawdzenie biegnie RAZ na zajęcie potwierdzenia zakupu, a
 * subskrypcja z panelu ma następną okazję dopiero przy kolejnym zdarzeniu
 * stanu (zwykle odnowienie), więc chwilowy błąd bazy bez ponowienia gubiłby
 * alarm. Krótko: praca w tle ma limit czasu runtime'u.
 */
const LOOKUP_RETRY_DELAYS_MS = [150, 600] as const;

/**
 * Deterministyczny klucz deduplikacji: posortowany zbiór identyfikatorów
 * (nowa + istniejące). Ten sam zbiór daje ten sam klucz bez względu na to,
 * które zdarzenie przyszło pierwsze.
 */
export function duplicatePlanAlertKey(subscriptionIds: readonly string[]): string {
  return [...new Set(subscriptionIds)].sort().join(",");
}

/**
 * Adres dzwonka. Rozróżnia sygnały przy deduplikacji `enqueue_notification`
 * (odbiorca, rodzaj, href) - jak `?refund_job=` w alarmach zwrotów.
 */
export function duplicatePlanAlertHref(dedupeKey: string): string {
  return `/admin/billing?duplicate_subscriptions=${dedupeKey
    .split(",")
    .map(encodeURIComponent)
    .join(",")}`;
}

/**
 * Waga względem istniejącej subskrypcji - wspólna reguła kasy: `null` z
 * `planPurchaseConflict` to wyłącznie `plan_kind_mismatch` (inny model
 * rozliczenia, osobny zakup). Każdy inny wynik (zmiana planu, ten sam plan,
 * cena spoza katalogu) to konflikt, który kasa by zablokowała.
 */
export function duplicatePlanSeverity(
  newPriceId: string,
  otherPriceIds: readonly (string | null | undefined)[],
): DuplicatePlanAlertSeverity {
  const target = catalogEntryByPriceId(newPriceId);
  return otherPriceIds.some((priceId) => planPurchaseConflict(priceId, target) !== null)
    ? "warning"
    : "info";
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type AdminClient = Awaited<ReturnType<typeof admin>>;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Zakres jednego sprawdzenia: właściciel i najemca już z bazy. */
interface CheckScope extends DuplicatePlanSubscriptionInput {
  /** Subskrypcja bez wiersza w lustrze (panel operatora) - inna treść i zawsze ostrzeżenie. */
  unmirrored: boolean;
}

/**
 * Odczyt z krótkim ponowieniem chwilowego błędu (`LOOKUP_RETRY_DELAYS_MS`).
 * Rzuca po wyczerpaniu prób - wołający zamienia to na log.
 */
async function readWithRetry<T>(
  label: string,
  read: () => PromiseLike<PostgrestSingleResponse<T>>,
): Promise<T> {
  let lastError = "";
  for (const delay of [0, ...LOOKUP_RETRY_DELAYS_MS]) {
    if (delay > 0) await sleep(delay);
    const { data, error } = await read();
    if (!error) return data;
    lastError = error.message;
  }
  throw new Error(`${label} failed: ${lastError}`);
}

/** Inne żywe subskrypcje planu konta - z krótkim ponowieniem chwilowego błędu. */
function otherLivePlanRows(supabase: AdminClient, scope: CheckScope) {
  return readWithRetry("live plan subscriptions lookup", () =>
    supabase
      .from("subscriptions")
      .select("provider_subscription_id, price_id, status")
      .eq("tenant_id", scope.tenantId)
      .eq("user_id", scope.userId)
      .eq("environment", scope.environment)
      .in("status", [...LIVE_PLAN_SUBSCRIPTION_STATUSES])
      .neq("provider_subscription_id", scope.subscriptionId)
      .order("created_at", { ascending: true })
      .limit(MAX_OTHER_SUBSCRIPTIONS),
  );
}

/**
 * Identyfikatory, które rejestr darowizn zna jako darowizny cykliczne tego
 * najemcy i środowiska. Lustro `subscriptions` z założenia trzyma tylko plany
 * (darowizny idą osobną ścieżką), ale alarm o „podwójnym planie" przy
 * darowiźnie byłby fałszywym alarmem o pieniądzach - stąd druga zapora.
 *
 * Błąd odczytu NIE wycisza alarmu: „nie wiem, czy to darowizna" przy żywym
 * wierszu planu to wciąż możliwe podwójne obciążenie, więc wolimy dzwonek
 * z logiem niż ciszę.
 */
async function donationSubscriptionIds(
  supabase: AdminClient,
  scope: CheckScope,
  ids: readonly string[],
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("donations")
    .select("provider_subscription_id")
    .eq("tenant_id", scope.tenantId)
    .eq("environment", scope.environment)
    .in("provider_subscription_id", [...ids]);
  if (error) {
    console.warn("[payments] duplicate plan check: donation ledger lookup failed", {
      subscriptionId: scope.subscriptionId,
      error: error.message,
    });
    return new Set();
  }
  return new Set(
    (Array.isArray(data) ? data : [])
      .map((row) => row.provider_subscription_id)
      .filter((id): id is string => typeof id === "string" && id !== ""),
  );
}

/**
 * Atomowe „pierwszy wygrywa" dla zbioru subskrypcji przed dzwonkiem. `true` =
 * dzwonimy. Błąd bramki = `true` (fail-open): `rateLimit` sam zwraca `true`
 * przy błędzie RPC, a wyjątek (np. import) łapiemy tutaj.
 */
async function claimAlertGate(scope: CheckScope, dedupeKey: string): Promise<boolean> {
  try {
    const { rateLimit } = await import("@/lib/server/rate-limit.server");
    return await rateLimit({
      scope: ALERT_GATE_SCOPE,
      subjectId: `${scope.tenantId}:${scope.environment}:${dedupeKey}`,
      max: 1,
      windowMinutes: ALERT_GATE_WINDOW_MINUTES,
    });
  } catch (err) {
    console.error("[payments] duplicate plan alert gate failed", {
      subscriptionId: scope.subscriptionId,
      dedupeKey,
      error: errorMessage(err),
    });
    return true;
  }
}

function alertCopy(
  severity: DuplicatePlanAlertSeverity,
  scope: CheckScope,
  others: readonly string[],
) {
  const list = others.join(", ");
  const many = others.length > 1;
  const sandboxPl = scope.environment === "sandbox" ? " (środowisko testowe operatora)" : "";
  const sandboxEn = scope.environment === "sandbox" ? " (provider sandbox)" : "";
  if (scope.unmirrored) {
    return {
      titlePl: "Subskrypcja planu spoza kasy obok żywego planu",
      titleEn: "Plan subscription created outside checkout next to a live plan",
      bodyPl: `Subskrypcja ${scope.subscriptionId} powstała u operatora płatności bez właściciela w metadanych (np. ręcznie w panelu operatora), więc nie nadała dostępu, a to samo konto klienta ma już ${many ? "żywe subskrypcje" : "żywą subskrypcję"} planu ${list}${sandboxPl}. Klient może płacić podwójnie - sprawdź je u operatora płatności i anuluj zbędną ręcznie. Nic nie anulowano automatycznie.`,
      bodyEn: `Subscription ${scope.subscriptionId} was created at the payment provider without an owner in its metadata (e.g. manually in the provider dashboard), so it grants no access, while the same customer account already has live plan ${many ? "subscriptions" : "subscription"} ${list}${sandboxEn}. The customer may be charged twice - review them with the payment provider and cancel the redundant one manually. Nothing was cancelled automatically.`,
    };
  }
  if (severity === "warning") {
    return {
      titlePl: "Druga aktywna subskrypcja planu",
      titleEn: "Second active plan subscription",
      bodyPl: `Nowa subskrypcja ${scope.subscriptionId} działa obok ${many ? "żywych subskrypcji" : "żywej subskrypcji"} planu ${list} tego samego konta${sandboxPl}. Klient może płacić podwójnie - sprawdź je u operatora płatności i anuluj zbędną ręcznie. Nic nie anulowano automatycznie.`,
      bodyEn: `New subscription ${scope.subscriptionId} runs alongside live plan ${many ? "subscriptions" : "subscription"} ${list} of the same account${sandboxEn}. The customer may be charged twice - review them with the payment provider and cancel the redundant one manually. Nothing was cancelled automatically.`,
    };
  }
  return {
    titlePl: "Informacja: osobny plan w innym modelu rozliczenia",
    titleEn: "Info: separate plan in another billing model",
    bodyPl: `Nowa subskrypcja ${scope.subscriptionId} działa obok subskrypcji ${list} tego samego konta${sandboxPl}. To dozwolony osobny zakup (plan Zespół za miejsce i plan indywidualny) - sprawdź tylko, czy klient świadomie utrzymuje oba.`,
    bodyEn: `New subscription ${scope.subscriptionId} runs alongside ${many ? "subscriptions" : "subscription"} ${list} of the same account${sandboxEn}. This is an allowed separate purchase (per-seat Team plan and an individual plan) - just confirm the customer intends to keep both.`,
  };
}

function logDuplicate(scope: CheckScope, details: Record<string, unknown>) {
  if (scope.unmirrored) {
    console.error("[payments] unmirrored plan subscription next to a live plan", details);
  } else if (details.severity === "warning") {
    console.error("[payments] duplicate live plan subscription", details);
  } else {
    console.warn("[payments] separate plan subscription in another billing model", details);
  }
}

/**
 * Jedno sprawdzenie w gotowym zakresie (właściciel i najemca z bazy). Rzuca
 * wyłącznie po wyczerpaniu ponowień odczytu - wołający zamienia to na log.
 */
async function checkLivePlans(scope: CheckScope): Promise<DuplicatePlanSubscriptionOutcome> {
  const supabase = await admin();
  const candidates = await otherLivePlanRows(supabase, scope);
  if (candidates.length === 0) return { kind: "none" };

  const donations = await donationSubscriptionIds(
    supabase,
    scope,
    candidates.map((row) => row.provider_subscription_id),
  );
  const others = candidates.filter((row) => !donations.has(row.provider_subscription_id));
  if (others.length === 0) return { kind: "none" };

  const otherIds = others.map((row) => row.provider_subscription_id);
  const severity: DuplicatePlanAlertSeverity = scope.unmirrored
    ? "warning"
    : duplicatePlanSeverity(
        scope.priceId,
        others.map((row) => row.price_id),
      );
  const dedupeKey = duplicatePlanAlertKey([scope.subscriptionId, ...otherIds]);
  // Log PRZED bramką i dzwonkiem: każde sprawdzenie zostawia ślad w logu
  // serwera, także to wytłumione i to, którego dzwonek padnie.
  logDuplicate(scope, {
    subscriptionId: scope.subscriptionId,
    otherSubscriptionIds: otherIds,
    tenantId: scope.tenantId,
    environment: scope.environment,
    severity,
    dedupeKey,
  });

  if (!(await claimAlertGate(scope, dedupeKey))) {
    console.info("[payments] duplicate plan alert already raised", {
      subscriptionId: scope.subscriptionId,
      dedupeKey,
    });
    return { kind: "deduped", severity, otherSubscriptionIds: otherIds, dedupeKey };
  }

  const { notifyTenantAdmins } = await import("@/lib/events/tenantAdminAlert.server");
  const delivered = await notifyTenantAdmins({
    tenantId: scope.tenantId,
    kind: "billing",
    ...alertCopy(severity, scope, otherIds),
    href: duplicatePlanAlertHref(dedupeKey),
    icon: "credit-card",
  });
  return { kind: "alerted", severity, otherSubscriptionIds: otherIds, dedupeKey, delivered };
}

/** `checkLivePlans` bez wyjątków: błąd ostateczny = log + `failed`. */
async function safeCheck(scope: CheckScope): Promise<DuplicatePlanSubscriptionOutcome> {
  try {
    return await checkLivePlans(scope);
  } catch (err) {
    console.error("[payments] duplicate plan subscription check failed", {
      subscriptionId: scope.subscriptionId,
      error: errorMessage(err),
    });
    return { kind: "failed" };
  }
}

/**
 * Sprawdza, czy subskrypcja planu, która właśnie weszła w stan uprawniający,
 * nie jest drugą żywą subskrypcją planu tego konta, i jeśli jest - podnosi
 * alarm. Nigdy nie rzuca: wynik `failed` oznacza błąd zapisany w logu.
 */
export async function alertOnDuplicatePlanSubscription(
  input: DuplicatePlanSubscriptionInput,
): Promise<DuplicatePlanSubscriptionOutcome> {
  if (input.purpose === "donation") return { kind: "skipped", reason: "donation" };
  // Subskrypcja bez dostępu (`incomplete`, zaległa od pierwszej faktury) nie
  // jest jeszcze drugim opłaconym planem - kasa unieważnia taką pierwszą
  // fakturę, zanim otworzy nową sesję. Wołający sprawdza przy zajęciu
  // potwierdzenia, które i tak idzie wyłącznie w stanie uprawniającym.
  if (!isEntitledSubscriptionStatus(input.status)) {
    return { kind: "skipped", reason: "not_entitled" };
  }
  return safeCheck({ ...input, unmirrored: false });
}

/**
 * Subskrypcja spoza lustra (bez `metadata.userId`): właściciel z NASZYCH
 * wierszy tego klienta operatora i środowiska, potem to samo sprawdzenie dla
 * każdego (najemca, właściciel), w którym ten klient kupował. Nigdy nie rzuca.
 */
export async function alertOnUnmirroredPlanSubscription(
  input: UnmirroredPlanSubscriptionInput,
): Promise<DuplicatePlanSubscriptionOutcome[]> {
  if (input.purpose === "donation") return [{ kind: "skipped", reason: "donation" }];
  if (!isEntitledSubscriptionStatus(input.status)) {
    return [{ kind: "skipped", reason: "not_entitled" }];
  }
  const priceId = input.priceId;
  // Cena spoza katalogu planów to nie plan (inny produkt na tym samym koncie
  // operatora) - alarm o „drugim planie" byłby fałszywy.
  if (!priceId || !catalogEntryByPriceId(priceId)) {
    return [{ kind: "skipped", reason: "not_a_plan" }];
  }
  if (!input.customerId) return [{ kind: "skipped", reason: "unknown_customer" }];

  let rows: { provider_subscription_id: string; user_id: string; tenant_id: string }[];
  try {
    const supabase = await admin();
    rows = await readWithRetry("customer owner lookup", () =>
      supabase
        .from("subscriptions")
        .select("provider_subscription_id, user_id, tenant_id")
        .eq("provider_customer_id", input.customerId)
        .eq("environment", input.environment)
        .limit(MAX_CUSTOMER_ROWS),
    );
  } catch (err) {
    console.error("[payments] duplicate plan subscription check failed", {
      subscriptionId: input.subscriptionId,
      error: errorMessage(err),
    });
    return [{ kind: "failed" }];
  }

  // Wiersz tej subskrypcji jednak jest (metadane dopisane później): to już
  // lustro, a jego sprawdzenie idzie przy zajęciu potwierdzenia zakupu.
  if (rows.some((row) => row.provider_subscription_id === input.subscriptionId)) {
    return [{ kind: "skipped", reason: "mirrored" }];
  }
  const owners = new Map<string, { userId: string; tenantId: string }>();
  for (const row of rows) {
    if (!row.user_id || !row.tenant_id) continue;
    owners.set(`${row.tenant_id}:${row.user_id}`, { userId: row.user_id, tenantId: row.tenant_id });
  }
  if (owners.size === 0) {
    console.warn("[payments] unmirrored plan subscription: customer unknown", {
      subscriptionId: input.subscriptionId,
      environment: input.environment,
    });
    return [{ kind: "skipped", reason: "unknown_customer" }];
  }

  // Po kolei, nie równolegle: właścicieli jest zwykle jeden, a sprawdzenia
  // jednego zdarzenia nie mają się ścigać o tę samą bramkę.
  const outcomes: DuplicatePlanSubscriptionOutcome[] = [];
  for (const owner of owners.values()) {
    outcomes.push(
      await safeCheck({
        subscriptionId: input.subscriptionId,
        userId: owner.userId,
        tenantId: owner.tenantId,
        environment: input.environment,
        priceId,
        status: input.status,
        purpose: input.purpose ?? null,
        unmirrored: true,
      }),
    );
  }
  return outcomes;
}

/** Rejestracja pracy w tle; błąd rejestracji to log, nigdy wyjątek. */
function inBackground(subscriptionId: string, work: () => Promise<unknown>): void {
  try {
    runAfterResponse(work());
  } catch (err) {
    console.error("[payments] duplicate plan subscription check not scheduled", {
      subscriptionId,
      error: errorMessage(err),
    });
  }
}

/**
 * Wejście z webhooka (zajęcie potwierdzenia zakupu): sprawdzenie biegnie ZA
 * odpowiedzią (`ctx.waitUntil`), więc nie wydłuża obsługi zdarzenia, a jego
 * błąd nie wraca do wołającego. Nigdy nie rzuca.
 */
export function scheduleDuplicatePlanSubscriptionAlert(
  input: DuplicatePlanSubscriptionInput,
): void {
  inBackground(input.subscriptionId, () => alertOnDuplicatePlanSubscription(input));
}

/** Wejście z webhooka dla subskrypcji bez `metadata.userId`. Nigdy nie rzuca. */
export function scheduleUnmirroredPlanSubscriptionAlert(
  input: UnmirroredPlanSubscriptionInput,
): void {
  inBackground(input.subscriptionId, () => alertOnUnmirroredPlanSubscription(input));
}
