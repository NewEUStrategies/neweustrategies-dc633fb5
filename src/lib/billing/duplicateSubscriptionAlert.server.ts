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
// CO ROBIMY, A CZEGO NIE.
//   * Tylko alarm dla administratorów najemcy (`notifyTenantAdmins`) i głośny
//     log. NIC nie anulujemy automatycznie: która subskrypcja jest zbędna,
//     wie człowiek (zwrot, proracja, rozmowa z klientem), a pomyłka
//     automatu to odcięcie płacącego.
//   * Najemca i właściciel pochodzą z WIERSZA W BAZIE (RETURNING wstawienia;
//     `tenant_id` przypina trigger z profilu właściciela), nigdy z ładunku.
//   * Liczą się wyłącznie żywe subskrypcje planu (te same statusy, które
//     blokują zakup - `LIVE_PLAN_SUBSCRIPTION_STATUSES`) w TYM SAMYM najemcy
//     i środowisku. Darowizny cykliczne odpadają po obu stronach: nowa
//     z `metadata.purpose = "donation"` i istniejący wiersz, którego
//     identyfikator zna rejestr darowizn.
//   * Osobny zakup w innym modelu rozliczenia rozpoznaje TA SAMA reguła co
//     kasa (`planPurchaseConflict` -> `catalogSwitchRefusal`): `null` znaczy
//     „dozwolony osobny zakup", więc alarm jest wtedy informacyjny (niższa
//     waga), a nie ostrzeżeniem o podwójnym obciążeniu.
//   * Klucz deduplikacji jest DETERMINISTYCZNY: posortowany zbiór
//     identyfikatorów subskrypcji w `href` dzwonka. `enqueue_notification`
//     deduplikuje po (odbiorca, rodzaj, href), więc dwa równoległe zdarzenia
//     `created`, które widzą się nawzajem (A widzi B, B widzi A), dają ten sam
//     adres i jeden dzwonek. Ponowienie TEGO SAMEGO zdarzenia w ogóle tu nie
//     wraca: alarm idzie wyłącznie po wyniku `inserted`, a ponowienie zastaje
//     wiersz (`exists`).
//   * Nigdy nie rzuca i nie wstrzymuje webhooka: sprawdzenie biegnie za
//     odpowiedzią (`runAfterResponse` -> `ctx.waitUntil`), a każdy błąd kończy
//     się logiem. Awaria alarmu nie może kosztować klienta uprawnienia, za
//     które zapłacił.
//
// TREŚĆ NIESIE TYLKO IDENTYFIKATORY subskrypcji operatora - żadnych adresów
// e-mail ani nazwisk (jak każdy alarm `tenantAdminAlert`).
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
  /** Identyfikator operatora NOWO wstawionej subskrypcji. */
  subscriptionId: string;
  /** Właściciel z wiersza w bazie (RETURNING), nie z ładunku. */
  userId: string;
  /** Najemca z wiersza w bazie (trigger z profilu właściciela), nie z ładunku. */
  tenantId: string;
  environment: StripeEnv;
  /** `lookup_key` ceny nowej subskrypcji (`subscriptions.price_id`). */
  priceId: string;
  /** Znormalizowany status operatora w chwili wstawienia. */
  status: string;
  /** `metadata.purpose` z ładunku - `donation` to nie plan. */
  purpose?: string | null;
}

export type DuplicatePlanSubscriptionOutcome =
  | { kind: "skipped"; reason: "donation" | "not_entitled" }
  | { kind: "none" }
  | {
      kind: "alerted";
      severity: DuplicatePlanAlertSeverity;
      otherSubscriptionIds: string[];
      dedupeKey: string;
      /** Liczba dzwonków doręczonych administratorom (0 = deduplikacja albo brak administratora). */
      delivered: number;
    }
  | { kind: "failed" };

/**
 * Górna granica wierszy w odczycie: konto z kilkunastoma żywymi planami to już
 * incydent, a treść dzwonka i tak wymienia identyfikatory jeden po drugim.
 */
const MAX_OTHER_SUBSCRIPTIONS = 10;

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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  supabase: Awaited<ReturnType<typeof admin>>,
  input: DuplicatePlanSubscriptionInput,
  ids: readonly string[],
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("donations")
    .select("provider_subscription_id")
    .eq("tenant_id", input.tenantId)
    .eq("environment", input.environment)
    .in("provider_subscription_id", [...ids]);
  if (error) {
    console.warn("[payments] duplicate plan check: donation ledger lookup failed", {
      subscriptionId: input.subscriptionId,
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

function alertCopy(
  severity: DuplicatePlanAlertSeverity,
  input: DuplicatePlanSubscriptionInput,
  others: readonly string[],
) {
  const list = others.join(", ");
  const many = others.length > 1;
  const sandboxPl = input.environment === "sandbox" ? " (środowisko testowe operatora)" : "";
  const sandboxEn = input.environment === "sandbox" ? " (provider sandbox)" : "";
  if (severity === "warning") {
    return {
      titlePl: "Druga aktywna subskrypcja planu",
      titleEn: "Second active plan subscription",
      bodyPl: `Nowa subskrypcja ${input.subscriptionId} działa obok ${many ? "żywych subskrypcji" : "żywej subskrypcji"} planu ${list} tego samego konta${sandboxPl}. Klient może płacić podwójnie - sprawdź je u operatora płatności i anuluj zbędną ręcznie. Nic nie anulowano automatycznie.`,
      bodyEn: `New subscription ${input.subscriptionId} runs alongside live plan ${many ? "subscriptions" : "subscription"} ${list} of the same account${sandboxEn}. The customer may be charged twice - review them with the payment provider and cancel the redundant one manually. Nothing was cancelled automatically.`,
    };
  }
  return {
    titlePl: "Informacja: osobny plan w innym modelu rozliczenia",
    titleEn: "Info: separate plan in another billing model",
    bodyPl: `Nowa subskrypcja ${input.subscriptionId} działa obok subskrypcji ${list} tego samego konta${sandboxPl}. To dozwolony osobny zakup (plan Zespół za miejsce i plan indywidualny) - sprawdź tylko, czy klient świadomie utrzymuje oba.`,
    bodyEn: `New subscription ${input.subscriptionId} runs alongside ${many ? "subscriptions" : "subscription"} ${list} of the same account${sandboxEn}. This is an allowed separate purchase (per-seat Team plan and an individual plan) - just confirm the customer intends to keep both.`,
  };
}

/**
 * Sprawdza, czy nowo wstawiona subskrypcja planu nie jest drugą żywą
 * subskrypcją planu tego konta, i jeśli jest - podnosi alarm. Nigdy nie
 * rzuca: wynik `failed` oznacza błąd zapisany w logu.
 */
export async function alertOnDuplicatePlanSubscription(
  input: DuplicatePlanSubscriptionInput,
): Promise<DuplicatePlanSubscriptionOutcome> {
  try {
    if (input.purpose === "donation") return { kind: "skipped", reason: "donation" };
    // Subskrypcja bez dostępu (`incomplete`, zaległa od pierwszej faktury) nie
    // jest jeszcze drugim opłaconym planem - kasa unieważnia taką pierwszą
    // fakturę, zanim otworzy nową sesję.
    if (!isEntitledSubscriptionStatus(input.status)) {
      return { kind: "skipped", reason: "not_entitled" };
    }

    const supabase = await admin();
    const { data, error } = await supabase
      .from("subscriptions")
      .select("provider_subscription_id, price_id, status")
      .eq("tenant_id", input.tenantId)
      .eq("user_id", input.userId)
      .eq("environment", input.environment)
      .in("status", [...LIVE_PLAN_SUBSCRIPTION_STATUSES])
      .neq("provider_subscription_id", input.subscriptionId)
      .order("created_at", { ascending: true })
      .limit(MAX_OTHER_SUBSCRIPTIONS);
    if (error) throw new Error(`live plan subscriptions lookup failed: ${error.message}`);

    const candidates = Array.isArray(data) ? data : [];
    if (candidates.length === 0) return { kind: "none" };

    const donations = await donationSubscriptionIds(
      supabase,
      input,
      candidates.map((row) => row.provider_subscription_id),
    );
    const others = candidates.filter((row) => !donations.has(row.provider_subscription_id));
    if (others.length === 0) return { kind: "none" };

    const otherIds = others.map((row) => row.provider_subscription_id);
    const severity = duplicatePlanSeverity(
      input.priceId,
      others.map((row) => row.price_id),
    );
    const dedupeKey = duplicatePlanAlertKey([input.subscriptionId, ...otherIds]);
    const details = {
      subscriptionId: input.subscriptionId,
      otherSubscriptionIds: otherIds,
      tenantId: input.tenantId,
      environment: input.environment,
      severity,
      dedupeKey,
    };
    // Log PRZED dzwonkiem: gdy dzwonek padnie, ślad i tak zostaje w logu
    // serwera, skąd odczyta go operator platformy.
    if (severity === "warning") {
      console.error("[payments] duplicate live plan subscription", details);
    } else {
      console.warn("[payments] separate plan subscription in another billing model", details);
    }

    const { notifyTenantAdmins } = await import("@/lib/events/tenantAdminAlert.server");
    const delivered = await notifyTenantAdmins({
      tenantId: input.tenantId,
      kind: "billing",
      ...alertCopy(severity, input, otherIds),
      href: duplicatePlanAlertHref(dedupeKey),
      icon: "credit-card",
    });
    return { kind: "alerted", severity, otherSubscriptionIds: otherIds, dedupeKey, delivered };
  } catch (err) {
    console.error("[payments] duplicate plan subscription check failed", {
      subscriptionId: input.subscriptionId,
      error: errorMessage(err),
    });
    return { kind: "failed" };
  }
}

/**
 * Wejście z webhooka: sprawdzenie biegnie ZA odpowiedzią (`ctx.waitUntil`),
 * więc nie wydłuża obsługi zdarzenia, a jego błąd nie wraca do wołającego.
 * Nigdy nie rzuca.
 */
export function scheduleDuplicatePlanSubscriptionAlert(
  input: DuplicatePlanSubscriptionInput,
): void {
  try {
    runAfterResponse(alertOnDuplicatePlanSubscription(input));
  } catch (err) {
    console.error("[payments] duplicate plan subscription check not scheduled", {
      subscriptionId: input.subscriptionId,
      error: errorMessage(err),
    });
  }
}
