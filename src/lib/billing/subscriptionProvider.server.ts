// Operacje na istniejącej subskrypcji u dostawcy (anulowanie, wznowienie,
// zmiana planu, zmiana liczby miejsc) - odpowiednik dawnego pliku Paddle,
// przepięty na Stripe. Wydzielone z `checkout.functions`, bo moduł jest
// server-only (klucz API przez bramkę) i musi być importowany dynamicznie
// w handlerach.
//
// Reguła kolejności obowiązująca wszystkich wywołujących: NAJPIERW dostawca,
// potem baza. Jeśli operator odmówi, wiersz w bazie nie może twierdzić, że
// subskrypcja jest anulowana/zmieniona - klient byłby dalej obciążany.
//
// JEDNA WARSTWA DLA OBU ŚCIEŻEK UI (SUB-14). Karta operatora
// (`src/utils/payments.functions.ts`) i karta lokalna
// (`src/lib/billing/checkout.functions.ts`) mają różne wejścia (lookup_key vs
// id planu), ale KAŻDA decyzja o pieniądzach zapada tutaj, na ŻYWYM stanie
// subskrypcji pobranym od operatora: kierunek zmiany, liczba miejsc, status,
// pauza, harmonogram. Lustro w bazie bywa spóźnione (webhook), a decyzja na
// spóźnionym lustrze to np. „upgrade" liczony od ceny, której już nie ma.
//
// DOPŁATA PRZED ZMIANĄ (SUB-04). Zmiana natychmiastowa (wyższy plan, więcej
// miejsc) idzie z `payment_behavior: "pending_if_incomplete"`: operator
// wystawia fakturę proporcjonalną i PODMIENIA pozycje dopiero po jej
// opłaceniu. Gdy płatność nie przejdzie (odmowa karty, 3DS), subskrypcja
// wraca z `pending_update`, a jej pozycje niosą STARĄ cenę - wynik to
// `payment_failed` / `payment_requires_action` z adresem faktury do opłacenia,
// a wywołujący nie dotyka bazy. Webhook (`mapStripeSubscription` czyta
// `items`) też widzi starą cenę, więc wyższe uprawnienie nie powstaje znikąd;
// po opłaceniu faktury operator stosuje zmianę i wysyła zwykłe
// `customer.subscription.updated` z nową ceną. Dawny komentarz obiecywał tu
// `on_payment_failure=prevent_change` - to parametr Paddle, którego kod po
// migracji na Stripe nie realizował: odrzucona dopłata zostawiała wyższą cenę
// w `past_due`, a baza od razu przepinała plan.
//
// Zmiany „od nowego okresu" (niższy plan, mniej miejsc) idą przez harmonogram
// subskrypcji: bieżąca faza do końca opłaconego okresu, następna z nową
// ceną/ilością. Opłacony okres należy się klientowi w całości.
//
// IDEMPOTENCJA. Każda mutacja ma deterministyczny `idempotencyKey` z odcisku
// ŻYWEGO stanu (pozycja, cena, ilość, początek okresu, ostatnia faktura,
// harmonogram, flagi) i parametrów operacji. Dwuklik albo ponowienie sieciowe
// trafia w ten sam klucz i dostaje zapamiętaną odpowiedź zamiast drugiej
// operacji. Operator pamięta klucz 24 h, więc sam „cel" (sub, cena docelowa)
// NIE wystarcza: cykl anuluj -> wznów -> anuluj w ciągu doby wróciłby do
// identycznego stanu i trzecie wywołanie dostałoby odpowiedź z pierwszego bez
// wykonania - klient widziałby „anulowano" przy subskrypcji, która się
// odnawia. Dlatego operacje przełączające flagi podbijają licznik
// `metadata.nes_ops_rev` (subskrypcji albo harmonogramu) w TYM SAMYM
// wywołaniu, a licznik wchodzi do odcisku - każda prawomocna nowa operacja ma
// nowy klucz, a powtórzenie tej samej - stary.
import type Stripe from "stripe";
import { BILLING_CATALOG, catalogEntryByPriceId } from "@/lib/billing/catalog";
import { catalogSwitchRefusal } from "@/lib/billing/planSwitch";
import { getStripeClient, getStripeErrorMessage, type StripeEnv } from "@/lib/stripe.server";

/**
 * Odmowa operacji. `hostedInvoiceUrl` pojawia się wyłącznie przy odmowie
 * dopłaty (`payment_failed` / `payment_requires_action`) - to strona faktury
 * operatora, na której klient płaci inną kartą albo potwierdza 3DS, a operator
 * sam dokańcza oczekującą zmianę.
 */
interface SubscriptionOpFailure {
  ok: false;
  error: string;
  hostedInvoiceUrl?: string | null;
}

// `{}` jest tu celowe: domyślny wariant NIE dokłada żadnych pól do `{ok:true}`.
// (Reguła ban-types została zastąpiona przez no-empty-object-type - stara nazwa
// w dyrektywie sama w sobie była błędem "rule not found".)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type SubscriptionOpResult<T extends object = {}> =
  ({ ok: true } & T) | SubscriptionOpFailure;

/** Dopłata odrzucona (karta, środki, brak metody) - zmiana NIE weszła. */
export const PAYMENT_FAILED = "payment_failed";
/** Dopłata czeka na potwierdzenie klienta (3DS/SCA) - zmiana NIE weszła. */
export const PAYMENT_REQUIRES_ACTION = "payment_requires_action";

/**
 * Kiedy zmiana obowiązuje: `applied` = pozycje subskrypcji niosą już nową
 * cenę/ilość (operator potwierdził dopłatę), `scheduled` = od nowego okresu
 * (harmonogram). Tylko `applied` uprawnia wywołującego do zapisu w bazie.
 */
export type ChangeEffect = "applied" | "scheduled";

/** Identyfikator subskrypcji u dostawcy (`sub_...`); inne wartości ignorujemy. */
export function isProviderSubscriptionRef(ref: string | null | undefined): ref is string {
  return typeof ref === "string" && ref.startsWith("sub_");
}

/**
 * Środowisko bramki dla operacji serwerowej bez kontekstu klienta.
 * Produkcyjny build obsługuje wyłącznie środowisko live.
 */
export function subscriptionEnvironment(): StripeEnv {
  return process.env.NODE_ENV === "production" ? "live" : "sandbox";
}

/** Czytelny identyfikator ceny (`lookup_key`) z katalogu dla pary (tier, interwał). */
export function catalogPriceFor(
  tierKey: string | null | undefined,
  interval: string,
): string | null {
  if (!tierKey) return null;
  return (
    BILLING_CATALOG.find((e) => e.tierKey === tierKey && e.interval === interval)?.priceId ?? null
  );
}

/** Identyfikator ceny Stripe (`price_...`) dla czytelnego `lookup_key` z katalogu. */
export async function resolveProviderPriceId(
  env: StripeEnv,
  lookupKey: string,
): Promise<string | null> {
  try {
    const stripe = await getStripeClient(env);
    const result = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    return result.data[0]?.id ?? null;
  } catch (e) {
    console.error("[payments] price lookup failed", lookupKey, getStripeErrorMessage(e));
    return null;
  }
}

// --- odczyt żywego stanu -----------------------------------------------------

/** Identyfikator z pola, które SDK zwraca albo jako napis, albo jako obiekt z `id`. */
function refOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

/** Czytelny identyfikator ceny pozycji - ta sama reguła co w `stripeEvents.server`. */
function readableLookupKey(price: unknown): string | null {
  if (!price || typeof price !== "object") return null;
  const p = price as { lookup_key?: unknown; metadata?: Record<string, unknown> | null };
  if (typeof p.lookup_key === "string" && p.lookup_key) return p.lookup_key;
  const external = p.metadata?.lovable_external_id;
  return typeof external === "string" && external ? external : null;
}

function isoFromUnix(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

/** Harmonogram dołączony do subskrypcji - obiekt tylko przy `expand: ["schedule"]`. */
function attachedSchedule(sub: Stripe.Subscription): Stripe.SubscriptionSchedule | null {
  return sub.schedule && typeof sub.schedule === "object" ? sub.schedule : null;
}

/**
 * Żywy stan przed mutacją. Harmonogram rozwijamy, bo jego licznik operacji
 * i bieżąca faza wchodzą do klucza idempotencji i do aktualizacji faz.
 */
function retrieveLive(stripe: Stripe, subscriptionId: string): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId, { expand: ["schedule"] });
}

/**
 * Statusy, w których subskrypcji nie zmieniamy samoobsługowo: zaległa albo
 * niedokończona płatność, pauza, koniec. Klient najpierw płaci/wznawia -
 * inaczej faktura proporcjonalna dołączyłaby do zaległej, a zmiana przy
 * wstrzymanym poborze (`void`) weszłaby bez żadnej płatności. Lista jest
 * odmową jawną (nie białą listą), bo zbiór statusów operatora jest zamknięty,
 * a brak pola w odpowiedzi nie jest statusem.
 */
const FROZEN_STATUSES = new Set([
  "incomplete",
  "incomplete_expired",
  "past_due",
  "unpaid",
  "paused",
  "canceled",
]);

function frozenStateRefusal(sub: Stripe.Subscription): string | null {
  if (sub.status && FROZEN_STATUSES.has(sub.status)) return "subscription_not_active";
  if (sub.pause_collection) return "subscription_paused";
  return null;
}

// --- idempotencja ------------------------------------------------------------

const OPS_REVISION_KEY = "nes_ops_rev";

function revisionOf(metadata: unknown): number {
  const raw =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)[OPS_REVISION_KEY]
      : undefined;
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Podbity licznik operacji - metadane operatora łączą klucze, reszta zostaje. */
function nextRevision(metadata: unknown): Record<string, string> {
  return { [OPS_REVISION_KEY]: String(revisionOf(metadata) + 1) };
}

type KeyPart = string | number | boolean | null | undefined;

/**
 * Odcisk ŻYWEGO stanu subskrypcji. Wszystko, co zmienia któraś z naszych
 * operacji (albo okres rozliczeniowy), musi tu być - inaczej prawomocna nowa
 * operacja dostałaby klucz poprzedniej.
 */
function stateFingerprint(subscriptionId: string, sub: Stripe.Subscription): KeyPart[] {
  const item = sub.items?.data?.[0];
  return [
    subscriptionId,
    sub.status,
    item?.id,
    refOf(item?.price),
    item?.quantity,
    item?.current_period_start,
    refOf(sub.latest_invoice),
    refOf(sub.schedule),
    revisionOf(attachedSchedule(sub)?.metadata),
    sub.cancel_at_period_end,
    sub.pause_collection?.behavior ?? null,
    revisionOf(sub.metadata),
  ];
}

/**
 * Klucz idempotencji operatora: skrót SHA-256 z operacji i odcisku (limit
 * operatora to 255 znaków, a odcisk z identyfikatorami bywa dłuższy).
 * WebCrypto działa i w izolacie Workera, i w Node.
 */
async function idempotencyKey(op: string, parts: readonly KeyPart[]): Promise<string> {
  const material = [op, ...parts.map((p) => (p === null || p === undefined ? "" : String(p)))];
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material.join("|")),
  );
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `nes-sub-${op}-${hex.slice(0, 48)}`;
}

// --- odmowa dopłaty ----------------------------------------------------------

/** Intencja płatności czeka na klienta (3DS/SCA), a nie została odrzucona. */
const ACTION_REQUIRED_INTENT = new Set(["requires_action", "requires_confirmation"]);

/** Kody odmowy, z którymi operator potrafi RZUCIĆ zamiast zwrócić `pending_update`. */
const DECLINE_CODES = new Set([
  "card_declined",
  "expired_card",
  "incorrect_cvc",
  "incorrect_number",
  "insufficient_funds",
  "processing_error",
  "payment_intent_payment_attempt_failed",
]);
const ACTION_CODES = new Set([
  "authentication_required",
  "invoice_payment_intent_requires_action",
  "payment_intent_authentication_failure",
]);

function declineOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { type?: string; code?: string; raw?: { type?: string; code?: string } };
  const type = e.raw?.type ?? e.type;
  const code = e.raw?.code ?? e.code;
  if (code && ACTION_CODES.has(code)) return PAYMENT_REQUIRES_ACTION;
  if (type === "card_error" || type === "StripeCardError" || (code && DECLINE_CODES.has(code))) {
    return PAYMENT_FAILED;
  }
  return null;
}

/**
 * Wynik dla subskrypcji, której dopłata nie przeszła (`pending_update` albo
 * resume, który nie aktywował subskrypcji). Rozróżnienie 3DS / odmowa czyta
 * status intencji płatności z `latest_invoice.payments` (API Basil+ nie ma już
 * `invoice.payment_intent`); brak odczytu = zwykła odmowa.
 */
async function incompletePayment(
  stripe: Stripe,
  sub: Stripe.Subscription,
): Promise<SubscriptionOpFailure> {
  const invoice =
    sub.latest_invoice && typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
  const intent = invoice?.payments?.data?.[0]?.payment?.payment_intent;
  let intentStatus: string | null = intent && typeof intent === "object" ? intent.status : null;
  if (!intentStatus && typeof intent === "string") {
    try {
      intentStatus = (await stripe.paymentIntents.retrieve(intent)).status;
    } catch (e) {
      console.error("[payments] payment intent lookup failed", intent, getStripeErrorMessage(e));
    }
  }
  return {
    ok: false,
    error:
      intentStatus && ACTION_REQUIRED_INTENT.has(intentStatus)
        ? PAYMENT_REQUIRES_ACTION
        : PAYMENT_FAILED,
    hostedInvoiceUrl: invoice?.hosted_invoice_url ?? null,
  };
}

/**
 * Odmowa RZUCONA przez operatora (np. `card_declined` przy
 * `pending_if_incomplete`). Fakturę do opłacenia doczytujemy osobno - brak
 * odczytu nie zmienia wyniku (zmiana i tak nie weszła), tylko odbiera link.
 */
async function declinedPayment(
  stripe: Stripe,
  subscriptionId: string,
  code: string,
): Promise<SubscriptionOpFailure> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice"] });
    const invoice =
      sub.pending_update && sub.latest_invoice && typeof sub.latest_invoice === "object"
        ? sub.latest_invoice
        : null;
    return { ok: false, error: code, hostedInvoiceUrl: invoice?.hosted_invoice_url ?? null };
  } catch {
    return { ok: false, error: code, hostedInvoiceUrl: null };
  }
}

/** Błąd operatora -> wynik. Odmowa płatności dostaje kod domenowy, reszta treść. */
async function failureOf(
  stripe: Stripe | null,
  subscriptionId: string,
  error: unknown,
): Promise<SubscriptionOpFailure> {
  const decline = declineOf(error);
  if (decline && stripe) return declinedPayment(stripe, subscriptionId, decline);
  return { ok: false, error: decline ?? getStripeErrorMessage(error) };
}

// --- harmonogram -------------------------------------------------------------

/**
 * Zwolnienie dołączonego harmonogramu (zaplanowany downgrade / zmniejszenie
 * miejsc), zanim zmiana natychmiastowa albo anulowanie go zastąpi: operator
 * nie pozwala ustawić `cancel_at_period_end` na subskrypcji zarządzanej
 * harmonogramem, a pozostawiona faza nadpisałaby świeżo opłacony upgrade na
 * koniec okresu. Zwolnienie jest jednorazowe per harmonogram, więc klucz
 * z samego identyfikatora jest deterministyczny i bezpieczny.
 */
async function releaseAttachedSchedule(stripe: Stripe, sub: Stripe.Subscription): Promise<void> {
  const scheduleId = refOf(sub.schedule);
  if (!scheduleId) return;
  await stripe.subscriptionSchedules.release(
    scheduleId,
    {},
    { idempotencyKey: await idempotencyKey("schedule-release", [scheduleId]) },
  );
}

/**
 * Zmiana od nowego okresu: bieżąca faza bez zmian do końca opłaconego okresu,
 * kolejna z `nextItems`. Dołączony harmonogram AKTUALIZUJEMY (drugi downgrade,
 * kolejne zmniejszenie miejsc) zamiast zakładać nowy - operator odrzuca
 * `from_subscription` dla subskrypcji, która harmonogram już ma. Fazy idą do
 * harmonogramu zwróconego przez `create` / dołączonego do TEJ subskrypcji, a
 * nie „ostatniego" z listy po kliencie: równoległy harmonogram innej
 * subskrypcji (druga karta, portal operatora) zostawiłby nasz przypięty.
 *
 * @returns koniec bieżącego okresu (sekundy) - moment wejścia zmiany.
 */
async function scheduleFromNextPeriod(
  stripe: Stripe,
  subscriptionId: string,
  sub: Stripe.Subscription,
  nextItems: { price: string; quantity: number }[],
): Promise<number> {
  const items = sub.items.data;
  const fingerprint = stateFingerprint(subscriptionId, sub);
  const currentPhase = items.map((i) => ({ price: refOf(i.price) ?? "", quantity: i.quantity }));
  const periodEnd = items[0]?.current_period_end ?? 0;

  let schedule = attachedSchedule(sub);
  let scheduleId = refOf(sub.schedule);
  if (!scheduleId) {
    schedule = await stripe.subscriptionSchedules.create(
      { from_subscription: subscriptionId },
      { idempotencyKey: await idempotencyKey("schedule-create", fingerprint) },
    );
    scheduleId = schedule.id;
  }
  // Początek bieżącej fazy należy do harmonogramu (operator odrzuca jego
  // zmianę); bez rozwiniętego obiektu bierzemy początek okresu pozycji.
  const phaseStart = schedule?.current_phase?.start_date ?? items[0]?.current_period_start ?? 0;

  await stripe.subscriptionSchedules.update(
    scheduleId,
    {
      end_behavior: "release",
      phases: [
        { items: currentPhase, start_date: phaseStart, end_date: periodEnd },
        { items: nextItems },
      ],
      metadata: nextRevision(schedule?.metadata),
    },
    {
      idempotencyKey: await idempotencyKey("schedule-update", [
        scheduleId,
        revisionOf(schedule?.metadata),
        ...fingerprint,
        ...nextItems.flatMap((i) => [i.price, i.quantity]),
      ]),
    },
  );
  return periodEnd;
}

/**
 * Zmiana natychmiastowa z dopłatą proporcjonalną. Parametry ograniczone do
 * tych, które operator przyjmuje w aktualizacji oczekującej (`items`,
 * `proration_behavior`, `payment_behavior`, `expand`) - np. `metadata` czy
 * `cancel_at_period_end` razem z `pending_if_incomplete` operator odrzuca,
 * więc cofnięcie anulowania idzie osobnym wywołaniem DOPIERO po udanej
 * dopłacie (nieudany upgrade nie może po cichu odwołać rezygnacji).
 */
async function updateWithProration(
  stripe: Stripe,
  subscriptionId: string,
  current: Stripe.Subscription,
  op: string,
  item: { id: string; price?: string; quantity: number },
): Promise<Stripe.Subscription | SubscriptionOpFailure> {
  const fingerprint = stateFingerprint(subscriptionId, current);
  await releaseAttachedSchedule(stripe, current);
  const updated = await stripe.subscriptions.update(
    subscriptionId,
    {
      items: [item],
      proration_behavior: "always_invoice",
      payment_behavior: "pending_if_incomplete",
      expand: ["latest_invoice.payments"],
    },
    {
      idempotencyKey: await idempotencyKey(op, [
        ...fingerprint,
        item.id,
        item.price,
        item.quantity,
      ]),
    },
  );
  if (updated.pending_update) return incompletePayment(stripe, updated);
  return updated;
}

function isFailure(value: unknown): value is SubscriptionOpFailure {
  return !!value && typeof value === "object" && (value as { ok?: unknown }).ok === false;
}

/**
 * Kompensacja nieudanego downgrade'u na subskrypcji, która miała zaplanowane
 * anulowanie: flaga wraca, a błąd kompensacji jest logowany głośno (stan
 * u operatora wymaga wtedy ręcznej korekty - wynik operacji i tak jest odmową).
 */
async function restoreCancellation(
  stripe: Stripe,
  subscriptionId: string,
  sub: Stripe.Subscription,
): Promise<void> {
  try {
    await stripe.subscriptions.update(
      subscriptionId,
      { cancel_at_period_end: true, metadata: nextRevision(sub.metadata) },
      // Własna nazwa operacji: operator pamięta także ODMOWY pod kluczem, więc
      // wspólny klucz z `cancel` zablokowałby późniejszą zwykłą rezygnację
      // z tego samego stanu na dobę.
      {
        idempotencyKey: await idempotencyKey(
          "cancel-restore",
          stateFingerprint(subscriptionId, sub),
        ),
      },
    );
  } catch (e) {
    console.error(
      "[payments] downgrade failed AND cancellation restore failed",
      subscriptionId,
      getStripeErrorMessage(e),
    );
  }
}

// --- operacje ----------------------------------------------------------------

/**
 * Anulowanie z zachowaniem opłaconego okresu (`cancel_at_period_end`).
 * Zaplanowana zmiana (harmonogram) traci sens przy rezygnacji i blokowałaby
 * flagę po stronie operatora, więc zwalniamy ją najpierw.
 */
export async function cancelSubscriptionAtPeriodEnd(
  env: StripeEnv,
  subscriptionId: string,
): Promise<SubscriptionOpResult> {
  let stripe: Stripe | null = null;
  try {
    stripe = await getStripeClient(env);
    const current = await retrieveLive(stripe, subscriptionId);
    // Już anulowana / już z zaplanowanym końcem: nic do zrobienia, a druga
    // mutacja podbiłaby tylko licznik i zdarzenie u operatora.
    if (current.status === "canceled" || current.cancel_at_period_end === true) return { ok: true };
    const fingerprint = stateFingerprint(subscriptionId, current);
    await releaseAttachedSchedule(stripe, current);
    await stripe.subscriptions.update(
      subscriptionId,
      { cancel_at_period_end: true, metadata: nextRevision(current.metadata) },
      { idempotencyKey: await idempotencyKey("cancel", fingerprint) },
    );
    return { ok: true };
  } catch (e) {
    return failureOf(null, subscriptionId, e);
  }
}

/**
 * Anulowanie ze skutkiem natychmiastowym.
 * Używane przy usunięciu konta: po skasowaniu użytkownika nie ma komu wysłać
 * przypomnienia ani obsłużyć końca okresu, więc cykliczne obciążenia muszą
 * ustać od razu - inaczej klient płaciłby za konto, którego już nie ma.
 * Operacja jest jednokierunkowa, więc klucz z samego identyfikatora wystarcza.
 */
export async function cancelSubscriptionImmediately(
  env: StripeEnv,
  subscriptionId: string,
): Promise<SubscriptionOpResult> {
  try {
    const stripe = await getStripeClient(env);
    await stripe.subscriptions.cancel(
      subscriptionId,
      {},
      { idempotencyKey: await idempotencyKey("cancel-now", [subscriptionId]) },
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}

/**
 * Jak wznowiono: `unpaused` - status `paused` (koniec triala bez metody
 * płatności) wznowiony przez `subscriptions.resume`; `collection_resumed` -
 * zdjęta pauza poboru (`pause_collection`, status operatora zostaje
 * `active`); `cancellation_reverted` - cofnięte zaplanowane anulowanie;
 * `already_active` - u operatora nie było czego wznawiać.
 */
export type ResumeMode =
  "unpaused" | "collection_resumed" | "cancellation_reverted" | "already_active";

/**
 * Wznowienie - JEDNA intencja użytkownika, trzy różne mechanizmy operatora.
 * Rozstrzyga ŻYWY stan, nie lustro w bazie: dawna ścieżka dla statusu
 * `paused` robiła `pause_collection: null`, co subskrypcji w statusie
 * `paused` nie wznawia (to inny mechanizm), a pauzy poboru ustawionej
 * w panelu operatora w ogóle nie widziała, bo lustro ma wtedy status `active`.
 */
export async function resumeProviderSubscription(
  env: StripeEnv,
  subscriptionId: string,
): Promise<SubscriptionOpResult<{ mode: ResumeMode }>> {
  let stripe: Stripe | null = null;
  try {
    stripe = await getStripeClient(env);
    const current = await retrieveLive(stripe, subscriptionId);
    const fingerprint = stateFingerprint(subscriptionId, current);

    // Subskrypcja zakończona nie ma czego wznawiać - potrzebny nowy zakup.
    // Bez tej odmowy pusty patch dawał „already_active" dla subskrypcji,
    // która nie istnieje już jako aktywna.
    if (current.status === "canceled" || current.status === "incomplete_expired") {
      return { ok: false, error: "subscription_not_resumable" };
    }

    if (current.status === "paused") {
      // `billing_cycle_anchor: "now"`: nowy okres od wznowienia, bez proraty -
      // klient płaci za okres, z którego faktycznie skorzysta. Operator
      // wystawia fakturę od razu; dopóki nie jest opłacona, status zostaje
      // `paused` i dostęp nie wraca.
      const resumed = await stripe.subscriptions.resume(
        subscriptionId,
        { billing_cycle_anchor: "now", expand: ["latest_invoice.payments"] },
        { idempotencyKey: await idempotencyKey("resume-paused", fingerprint) },
      );
      if (resumed.status !== "active" && resumed.status !== "trialing") {
        return incompletePayment(stripe, resumed);
      }
      return { ok: true, mode: "unpaused" };
    }

    const patch: Stripe.SubscriptionUpdateParams = {};
    // Pusty napis zdejmuje pauzę po stronie operatora (`Emptyable`); pole
    // `undefined` zostałoby pominięte i pauza trwałaby mimo „ok" u nas.
    if (current.pause_collection) patch.pause_collection = "";
    if (current.cancel_at_period_end) patch.cancel_at_period_end = false;
    if (Object.keys(patch).length === 0) return { ok: true, mode: "already_active" };

    await stripe.subscriptions.update(
      subscriptionId,
      { ...patch, metadata: nextRevision(current.metadata) },
      { idempotencyKey: await idempotencyKey("resume", fingerprint) },
    );
    return {
      ok: true,
      mode: current.pause_collection ? "collection_resumed" : "cancellation_reverted",
    };
  } catch (e) {
    return failureOf(stripe, subscriptionId, e);
  }
}

export interface PlanChangeOutcome {
  direction: "upgrade" | "downgrade";
  effect: ChangeEffect;
  /** `applied`: koniec bieżącego okresu po zmianie; `scheduled`: moment wejścia nowej ceny. */
  currentPeriodEnd: string | null;
  /**
   * Flaga `cancel_at_period_end` u operatora PO operacji. Zmiana planu
   * zdejmuje zaplanowany koniec (klient zostaje), więc `true` zostaje tylko
   * wtedy, gdy zdjęcie się nie udało. Wywołujący lustrzą TĘ wartość
   * w `canceled_at` - stan operatora, nie własne założenie.
   */
  cancelAtPeriodEnd: boolean;
}

/**
 * Zmiana planu. Kierunek liczymy z ŻYWEJ ceny subskrypcji: upgrade wchodzi od
 * razu z dopłatą proporcjonalną (dopiero po jej opłaceniu), downgrade od
 * nowego okresu przez harmonogram - zgodnie z regułą biznesową uzgodnioną dla
 * subskrypcji. Liczba miejsc zostaje taka, jaką operator ma teraz.
 *
 * Cel musi przejść tę samą regułę katalogu co UI (`catalogSwitchRefusal`):
 * żadnej pozycji jednorazowej, żadnego przejścia za miejsce <-> indywidualny.
 * Ofertę NAJEMCY (plan aktywny, ten tenant) sprawdza wcześniej
 * `planSwitch.server.ts` - tu nie ma dostępu do bazy.
 */
export async function changeSubscriptionPrice(
  env: StripeEnv,
  subscriptionId: string,
  params: { newPriceExternalId: string },
): Promise<SubscriptionOpResult<PlanChangeOutcome>> {
  const providerPriceId = await resolveProviderPriceId(env, params.newPriceExternalId);
  if (!providerPriceId) return { ok: false, error: "price_missing" };

  let stripe: Stripe | null = null;
  try {
    stripe = await getStripeClient(env);
    const current = await retrieveLive(stripe, subscriptionId);
    const item = current.items.data[0];
    if (!item?.id) return { ok: false, error: "no_subscription_item" };
    const frozen = frozenStateRefusal(current);
    if (frozen) return { ok: false, error: frozen };

    const currentEntry = catalogEntryByPriceId(readableLookupKey(item.price));
    if (!currentEntry || currentEntry.oneTime) {
      return { ok: false, error: "subscription_not_switchable" };
    }
    const target = catalogEntryByPriceId(params.newPriceExternalId);
    const refusal = catalogSwitchRefusal(currentEntry, target);
    if (refusal || !target) return { ok: false, error: refusal ?? "plan_not_switchable" };

    // Ilość 0 z odpowiedzi nie może wyzerować subskrypcji - minimum to jedno miejsce.
    const quantity = Math.max(1, item.quantity ?? 1);
    const wasCanceling = current.cancel_at_period_end === true;

    if (target.rank > currentEntry.rank) {
      const updated = await updateWithProration(stripe, subscriptionId, current, "plan-upgrade", {
        id: item.id,
        price: providerPriceId,
        quantity,
      });
      if (isFailure(updated)) return updated;

      let cancelAtPeriodEnd = wasCanceling;
      if (wasCanceling) {
        // Dopłata przeszła, więc klient zostaje. Błąd tego kroku NIE cofa
        // opłaconego upgrade'u - zgłaszamy go, a wywołujący nie czyści
        // `canceled_at`, dopóki operator naprawdę nie zdjął flagi.
        try {
          await stripe.subscriptions.update(
            subscriptionId,
            { cancel_at_period_end: false, metadata: nextRevision(updated.metadata) },
            {
              idempotencyKey: await idempotencyKey(
                "cancel-revert",
                stateFingerprint(subscriptionId, updated),
              ),
            },
          );
          cancelAtPeriodEnd = false;
        } catch (e) {
          console.error(
            "[payments] upgrade applied, cancellation revert failed",
            subscriptionId,
            getStripeErrorMessage(e),
          );
        }
      }
      return {
        ok: true,
        direction: "upgrade",
        effect: "applied",
        currentPeriodEnd: isoFromUnix(updated.items?.data?.[0]?.current_period_end),
        cancelAtPeriodEnd,
      };
    }

    // Downgrade: bez proraty, zmiana obowiązuje dopiero od nowego okresu.
    // Zaplanowane anulowanie zdejmujemy JAWNIE przed harmonogramem (operator
    // nie łączy `cancel_at_period_end` z harmonogramem, a przejęcie końca
    // subskrypcji przez fazy byłoby efektem ubocznym zamiast decyzji
    // widocznej w historii). Gdy harmonogram się nie uda, przywracamy
    // anulowanie - inaczej klient, który odchodził, zostałby przy wyższej
    // cenie bez zaplanowanej zmiany i bez zgody na odnowienie.
    let base = current;
    if (wasCanceling) {
      const reverted = await stripe.subscriptions.update(
        subscriptionId,
        { cancel_at_period_end: false, metadata: nextRevision(current.metadata) },
        {
          idempotencyKey: await idempotencyKey(
            "cancel-revert",
            stateFingerprint(subscriptionId, current),
          ),
        },
      );
      // Pozycje i okres się nie zmieniły; odpowiedź niesie nowy licznik i flagę.
      base = { ...current, ...reverted, schedule: current.schedule };
    }
    let effectiveAt: number;
    try {
      effectiveAt = await scheduleFromNextPeriod(stripe, subscriptionId, base, [
        { price: providerPriceId, quantity },
      ]);
    } catch (e) {
      if (wasCanceling) await restoreCancellation(stripe, subscriptionId, base);
      throw e;
    }
    return {
      ok: true,
      direction: "downgrade",
      effect: "scheduled",
      currentPeriodEnd: isoFromUnix(effectiveAt),
      // Zaplanowany koniec zdjęty jawnie przed harmonogramem (albo go nie było).
      cancelAtPeriodEnd: false,
    };
  } catch (e) {
    return failureOf(stripe, subscriptionId, e);
  }
}

/**
 * Zmiana LICZBY MIEJSC w planie za miejsce (plan Zespół). Cena zostaje ta sama,
 * zmienia się tylko ilość. Zwiększenie rozliczamy natychmiast proporcjonalnie
 * (klient dostaje miejsca po opłaceniu dopłaty), zmniejszenie - harmonogramem
 * od nowego okresu: opłacony okres należy się klientowi w całości. Wcześniej
 * zmniejszenie szło `proration_behavior: "none"` na pozycji, czyli działało
 * NATYCHMIAST bez zwrotu, wbrew temu, co obiecywał komentarz i ekran.
 *
 * Kierunek liczymy z ŻYWEJ ilości u operatora; `priceExternalId` jest
 * asercją, że subskrypcja wciąż jest na tej cenie za miejsce (zmiana planu
 * w międzyczasie nie może zamienić się w ciche przełączenie ceny).
 * `previousQuantity` (lustro w bazie) zostaje w sygnaturze dla wywołujących,
 * ale o niczym nie rozstrzyga - spóźniony webhook dałby zły kierunek.
 */
export async function updateSubscriptionQuantity(
  env: StripeEnv,
  subscriptionId: string,
  params: { priceExternalId: string; quantity: number; previousQuantity?: number },
): Promise<SubscriptionOpResult<{ quantity: number; effect: ChangeEffect }>> {
  const quantity = Math.max(1, Math.min(500, Math.trunc(params.quantity)));

  let stripe: Stripe | null = null;
  try {
    stripe = await getStripeClient(env);
    const current = await retrieveLive(stripe, subscriptionId);
    const item = current.items.data[0];
    if (!item?.id) return { ok: false, error: "no_subscription_item" };
    const liveKey = readableLookupKey(item.price);
    if (liveKey !== params.priceExternalId || catalogEntryByPriceId(liveKey)?.perSeat !== true) {
      return { ok: false, error: "not_per_seat_plan" };
    }
    const frozen = frozenStateRefusal(current);
    if (frozen) return { ok: false, error: frozen };

    const liveQuantity = Math.max(1, item.quantity ?? 1);
    if (quantity === liveQuantity) {
      // Powrót do bieżącej liczby = rezygnacja z zaplanowanego zmniejszenia.
      await releaseAttachedSchedule(stripe, current);
      return { ok: true, quantity, effect: "applied" };
    }

    if (quantity > liveQuantity) {
      const updated = await updateWithProration(stripe, subscriptionId, current, "seats-increase", {
        id: item.id,
        quantity,
      });
      if (isFailure(updated)) return updated;
      return { ok: true, quantity, effect: "applied" };
    }

    const priceId = refOf(item.price);
    if (!priceId) return { ok: false, error: "no_subscription_item" };
    await scheduleFromNextPeriod(stripe, subscriptionId, current, [{ price: priceId, quantity }]);
    return { ok: true, quantity, effect: "scheduled" };
  } catch (e) {
    return failureOf(stripe, subscriptionId, e);
  }
}
