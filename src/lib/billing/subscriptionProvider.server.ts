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
// ceną/ilością. Opłacony okres należy się klientowi w całości. Przepisanie
// faz przenosi z subskrypcji rabaty, stawki podatku i trial w toku - operator
// ZDEJMUJE każde pole fazy, którego nie podamy, więc „gołe" fazy kasowały
// kupon z checkoutu (odnowienie po pełnej cenie) i kończyły trial od razu.
//
// ZAPLANOWANA ZMIANA A ZMIANA NATYCHMIASTOWA. Upgrade / dołożenie miejsc przy
// dołączonym harmonogramie (zaplanowany downgrade, zmniejszenie miejsc)
// zwalnia harmonogram DOPIERO po udanej dopłacie. Dawniej zwolnienie szło
// przed aktualizacją: odrzucona karta kończyła się „zmiana nie weszła", ale
// zaplanowanej zmiany już nie było i odnowienie szło po starej, wyższej cenie
// albo liczbie miejsc - nadpłata, na którą klient się nie zgodził. Operator
// przyjmuje aktualizację pozycji subskrypcji zarządzanej harmonogramem (także
// oczekującą), a obie mutacje niosą wtedy NOWE pozycje: zdarzenie zwolnienia
// z tej samej sekundy nie cofnie już w lustrze opłaconej zmiany do starej
// ceny. Z tego samego powodu cofnięcie zaplanowanej rezygnacji przy upgradzie
// jedzie W TEJ SAMEJ oczekującej aktualizacji (operator przyjmuje w niej
// `cancel_at_period_end`) - jedno zdarzenie zamiast dwóch konkurujących.
//
// Odrzucona dopłata bywa opłacona PÓŹNIEJ: klient płaci fakturę ze strony
// operatora w oknie oczekującej zmiany (~23 h), a operator stosuje zmianę sam
// (`customer.subscription.pending_update_applied`) - już poza tym modułem,
// więc zachowany harmonogram zostawał i na koniec okresu cofał opłacony
// upgrade / dołożone miejsca. Tę samą decyzję co po udanej dopłacie podejmuje
// wtedy webhook (`reconcileScheduleWithAppliedUpdate`), ale tylko dla
// harmonogramu, którego następna faza zmianie przeczy.
//
// Ta sama zasada - nieudana operacja nie kasuje zaplanowanej zmiany - dotyczy
// rezygnacji i powrotu do bieżącej liczby miejsc. Rezygnacja MUSI zwolnić
// harmonogram przed flagą (operator nie łączy obu), więc gdy flaga się nie
// ustawi, odtwarzamy harmonogram z fazy odczytanej przed zwolnieniem
// (`restoreReleasedSchedule`). Powrót do bieżącej liczby miejsc odwołuje
// WYŁĄCZNIE oczekującą zmianę miejsc - zaplanowana zmiana ceny zostaje
// (`dropPendingSeatChange`); dawniej ponowny zapis tej samej liczby zwalniał
// każdy harmonogram i odnowienie szło po starym, droższym planie.
//
// ZAPLANOWANY KONIEC to `cancel_at_period_end` ALBO data `cancel_at` (panel
// operatora, portal klienta) - ta sama reguła co w lustrze
// (`stripeEvents.mapScheduledChange`). Wznowienie i zmiana planu zdejmują oba.
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
//
// Wyjątek bez licznika: zakładanie harmonogramu (`from_subscription` nie
// przyjmuje innych parametrów), a jego zwolnienie nie zmienia subskrypcji.
// Cykl zmniejsz -> cofnij -> zmniejsz w ciągu doby wracał więc do
// identycznego odcisku, `create` oddawał z pamięci harmonogram JUŻ zwolniony,
// a aktualizacja faz - zapamiętane 200: wynik „zaplanowano", a odnowienie po
// starej liczbie miejsc. Dlatego założony harmonogram potwierdzamy odczytem
// (bez mutacji i bez zdarzenia), a nieżywy zakładamy ponownie kluczem
// z jego identyfikatorem.
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
 * Pobór wstrzymał operator (panel Stripe), a bieżący okres nie jest opłacony -
 * samoobsługowe wznowienie oddałoby dostęp za darmo. Patrz
 * `resumeProviderSubscription`.
 */
export const PAUSED_BY_OPERATOR = "subscription_paused_by_operator";

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
 * `extraExpand` dokłada pola potrzebne jednej operacji (wznowienie czyta
 * status ostatniej faktury).
 */
function retrieveLive(
  stripe: Stripe,
  subscriptionId: string,
  extraExpand: readonly string[] = [],
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId, { expand: ["schedule", ...extraExpand] });
}

/**
 * Zaplanowany koniec subskrypcji u operatora. Dwa kształty, jak w lustrze
 * (`stripeEvents.mapScheduledChange`): flaga `cancel_at_period_end` (nasze
 * anulowanie) albo data `cancel_at` (panel operatora, portal klienta). Flaga
 * ma pierwszeństwo: przy niej operator i tak wypełnia `cancel_at` końcem
 * okresu, a jej zdjęcie zdejmuje oba pola. Operacje patrzyły dawniej
 * wyłącznie na flagę - wznowienie subskrypcji z samą datą meldowało
 * „wznowiono", a operator i tak ją kończył (SUB-14).
 */
type ScheduledCancellation = { kind: "period_end" } | { kind: "date"; at: number };

function scheduledCancellation(sub: Stripe.Subscription): ScheduledCancellation | null {
  if (sub.cancel_at_period_end === true) return { kind: "period_end" };
  if (typeof sub.cancel_at === "number" && sub.cancel_at > 0) {
    return { kind: "date", at: sub.cancel_at };
  }
  return null;
}

/**
 * Zdjęcie zaplanowanego końca - TYM polem, którym go ustawiono. Pusty napis
 * czyści datę (`Emptyable`); obu pól naraz nie wysyłamy, bo operator traktuje
 * je jako alternatywne sposoby zapisu jednej decyzji.
 */
function cancellationRevert(c: ScheduledCancellation): Stripe.SubscriptionUpdateParams {
  return c.kind === "period_end" ? { cancel_at_period_end: false } : { cancel_at: "" };
}

/** Przywrócenie zaplanowanego końca po nieudanej operacji - ten sam kształt. */
function cancellationRestore(c: ScheduledCancellation): Stripe.SubscriptionUpdateParams {
  return c.kind === "period_end" ? { cancel_at_period_end: true } : { cancel_at: c.at };
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
    // Data końca z panelu/portalu to osobny stan: jej zdjęcie i ponowne
    // ustawienie nie może trafić w klucz operacji sprzed zmiany.
    sub.cancel_at ?? null,
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
 * miejsc). Anulowanie zwalnia go PRZED ustawieniem flagi (operator nie
 * pozwala ustawić `cancel_at_period_end` na subskrypcji zarządzanej
 * harmonogramem) i odtwarza, gdy flaga się nie ustawi
 * (`restoreReleasedSchedule`), powrót do bieżącej liczby miejsc - tylko gdy
 * harmonogram niesie wyłącznie zmianę miejsc (`dropPendingSeatChange`), a
 * zmiana natychmiastowa - dopiero PO udanej dopłacie (`releaseSupersededSchedule`)
 * albo po dopłacie opłaconej później (`reconcileScheduleWithAppliedUpdate`).
 * Zwolnienie jest jednorazowe per harmonogram, więc klucz z samego
 * identyfikatora jest deterministyczny i bezpieczny.
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
 * Zwolnienie harmonogramu, który opłacona właśnie zmiana natychmiastowa
 * zastąpiła - jego następna faza cofnęłaby upgrade / dołożone miejsca na
 * koniec okresu. Zmiana jest już opłacona i naliczana, więc błąd tego kroku
 * NIE zmienia wyniku: odmowa kazałaby wywołującym nie zapisać planu, za który
 * klient zapłacił. Logujemy go głośno do ręcznego zwolnienia - tak jak
 * nieudaną kompensację w `restoreCancellation`.
 */
async function releaseSupersededSchedule(
  stripe: Stripe,
  subscriptionId: string,
  current: Stripe.Subscription,
): Promise<void> {
  try {
    await releaseAttachedSchedule(stripe, current);
  } catch (e) {
    console.error(
      "[payments] change applied, superseded schedule release failed - release it manually",
      subscriptionId,
      refOf(current.schedule),
      getStripeErrorMessage(e),
    );
  }
}

/** Statusy, w których harmonogram wciąż steruje subskrypcją. */
const LIVE_SCHEDULE_STATUSES = new Set(["not_started", "active"]);

/**
 * Ile razy z rzędu `create` może oddać z pamięci nieżywy harmonogram. Każdy
 * cykl zmniejsz -> cofnij z tego samego stanu w ciągu doby dokłada jedno
 * ogniwo łańcucha; granica zamienia patologiczną pętlę w jawny błąd.
 */
const MAX_SCHEDULE_CREATE_ATTEMPTS = 10;

/**
 * Nowy harmonogram z subskrypcji - z potwierdzeniem, że odpowiedź operatora
 * nie jest zapamiętanym harmonogramem już zwolnionym. Klucz `create` pochodzi
 * z odcisku subskrypcji, a ani zwolnienie, ani `from_subscription` odcisku nie
 * zmieniają: zmniejsz -> cofnij -> zmniejsz w ciągu doby trafiał w ten sam
 * klucz i dostawał z pamięci harmonogram, którego już nie ma, a aktualizacja
 * faz z identycznymi parametrami - zapamiętane 200 (wynik „zaplanowano",
 * odnowienie po starej liczbie miejsc; inny cel - błąd przez całą dobę).
 * Odczyt nie emituje zdarzenia, w przeciwieństwie do podbijania licznika
 * dodatkową mutacją subskrypcji, i łapie także zwolnienie spoza aplikacji
 * (panel operatora). Nieżywy harmonogram zakładamy ponownie kluczem z JEGO
 * identyfikatorem - deterministycznym, więc dwuklik dalej trafia w jeden
 * harmonogram.
 *
 * Zwracamy odpowiedź `create`, nie odczyt: przy prawomocnym powtórzeniu jej
 * licznik i bieżąca faza dają ten sam klucz aktualizacji faz co pierwsze
 * wywołanie, więc i aktualizacja przychodzi z pamięci, zamiast iść drugi raz.
 */
async function createOwnSchedule(
  stripe: Stripe,
  subscriptionId: string,
  fingerprint: readonly KeyPart[],
): Promise<Stripe.SubscriptionSchedule> {
  let stale: string | null = null;
  for (let attempt = 0; attempt < MAX_SCHEDULE_CREATE_ATTEMPTS; attempt += 1) {
    const created: Stripe.SubscriptionSchedule = await stripe.subscriptionSchedules.create(
      { from_subscription: subscriptionId },
      {
        idempotencyKey: await idempotencyKey(
          "schedule-create",
          stale ? [...fingerprint, stale] : fingerprint,
        ),
      },
    );
    const live = await stripe.subscriptionSchedules.retrieve(created.id);
    if (LIVE_SCHEDULE_STATUSES.has(live.status) && refOf(live.subscription) === subscriptionId) {
      return created;
    }
    stale = created.id;
  }
  throw new Error("schedule_create_replayed");
}

type PhaseParams = Stripe.SubscriptionScheduleUpdateParams.Phase;
type PhaseItemParams = Stripe.SubscriptionScheduleUpdateParams.Phase.Item;
type PhaseTerms = Pick<PhaseParams, "discounts" | "default_tax_rates" | "automatic_tax">;
/** Pozycja fazy sprowadzona do tego, co porównujemy z subskrypcją i odtwarzamy. */
type PhaseLine = { price: string; quantity: number };

/** Identyfikatory z listy pól SDK (napis albo rozwinięty obiekt z `id`). */
function idsOf(values: readonly unknown[] | null | undefined): string[] {
  return (values ?? []).map(refOf).filter((id): id is string => id !== null);
}

/**
 * Warunki rozliczenia, które przepisanie faz musi przenieść z subskrypcji.
 * Operator zdejmuje KAŻDE pole fazy, którego aktualizacja nie poda: fazy
 * z samymi pozycjami kasowały rabat z checkoutu (`allow_promotion_codes`,
 * kupon B2B) - pominięte `discounts` znaczy „dziedzicz rabat KLIENTA", zwykle
 * żaden - więc odnowienie szło po pełnej cenie. Rabat przenosimy do OBU faz
 * jako odwołanie do istniejącego obiektu rabatu (`discount`), nie kuponu:
 * kupon założyłby nowy rabat i od nowa liczył jego czas trwania, a odwołanie
 * zachowuje datę końca. Pusta lista = pole pominięte, czyli dokładnie
 * dotychczasowe zachowanie (rabat klienta, podatek z ustawień harmonogramu).
 */
function carriedPhaseTerms(sub: Stripe.Subscription): PhaseTerms {
  const terms: PhaseTerms = {};
  const discounts = idsOf(sub.discounts);
  if (discounts.length > 0) terms.discounts = discounts.map((discount) => ({ discount }));
  const taxRates = idsOf(sub.default_tax_rates);
  if (taxRates.length > 0) terms.default_tax_rates = taxRates;
  const tax = sub.automatic_tax;
  if (tax?.enabled === true) {
    const account = refOf(tax.liability?.account);
    terms.automatic_tax = {
      enabled: true,
      ...(tax.liability
        ? { liability: { type: tax.liability.type, ...(account ? { account } : {}) } }
        : {}),
    };
  }
  return terms;
}

/**
 * Pozycja fazy z warunkami pozycji subskrypcji (stawki podatku, rabat na
 * pozycji). Rabat pozycji przenosimy wyłącznie na TĘ SAMĄ cenę: na innym
 * produkcie kupon ograniczony do produktu nie pasuje, a operator odrzuciłby
 * całą aktualizację faz.
 */
function phaseItem(
  price: string,
  quantity: number | undefined,
  source: Stripe.SubscriptionItem | undefined,
): PhaseItemParams {
  const item: PhaseItemParams = { price, quantity };
  const taxRates = idsOf(source?.tax_rates);
  if (taxRates.length > 0) item.tax_rates = taxRates;
  const discounts = source && refOf(source.price) === price ? idsOf(source.discounts) : [];
  if (discounts.length > 0) item.discounts = discounts.map((discount) => ({ discount }));
  return item;
}

/**
 * Trial w toku należy do bieżącej fazy. Faza bez `trial_end` jest dla
 * operatora fazą PŁATNĄ: przepisanie jej przy zmniejszeniu miejsc albo
 * downgradzie w trialu kończyło trial od razu i wystawiało fakturę.
 */
function trialTerms(sub: Stripe.Subscription, phaseEnd: number): Pick<PhaseParams, "trial_end"> {
  if (sub.status !== "trialing" || !sub.trial_end) return {};
  return { trial_end: phaseEnd > 0 ? Math.min(sub.trial_end, phaseEnd) : sub.trial_end };
}

/**
 * Zmiana od nowego okresu: bieżąca faza bez zmian do końca opłaconego okresu,
 * kolejna z `nextItems`. Dołączony harmonogram AKTUALIZUJEMY (drugi downgrade,
 * kolejne zmniejszenie miejsc) zamiast zakładać nowy - operator odrzuca
 * `from_subscription` dla subskrypcji, która harmonogram już ma. Fazy idą do
 * harmonogramu zwróconego przez `create` / dołączonego do TEJ subskrypcji, a
 * nie „ostatniego" z listy po kliencie: równoległy harmonogram innej
 * subskrypcji (druga karta, portal operatora) zostawiłby nasz przypięty.
 * Warunki rozliczenia (rabat, podatek, trial) czytamy z ŻYWEJ subskrypcji -
 * to ją operator nalicza teraz, a obie ścieżki (nowy i dołączony
 * harmonogram) mają ją w ręku bez dodatkowego odczytu.
 *
 * @returns koniec bieżącego okresu (sekundy) - moment wejścia zmiany.
 */
async function scheduleFromNextPeriod(
  stripe: Stripe,
  subscriptionId: string,
  sub: Stripe.Subscription,
  nextItems: readonly PhaseLine[],
): Promise<number> {
  const items = sub.items.data;
  const fingerprint = stateFingerprint(subscriptionId, sub);
  const periodEnd = items[0]?.current_period_end ?? 0;
  const terms = carriedPhaseTerms(sub);

  let schedule = attachedSchedule(sub);
  let scheduleId = refOf(sub.schedule);
  if (!scheduleId) {
    schedule = await createOwnSchedule(stripe, subscriptionId, fingerprint);
    scheduleId = schedule.id;
  }
  // Początek bieżącej fazy należy do harmonogramu (operator odrzuca jego
  // zmianę); bez rozwiniętego obiektu bierzemy początek okresu pozycji.
  const phaseStart = schedule?.current_phase?.start_date ?? items[0]?.current_period_start ?? 0;
  const phases: PhaseParams[] = [
    {
      items: items.map((i) => phaseItem(refOf(i.price) ?? "", i.quantity, i)),
      start_date: phaseStart,
      end_date: periodEnd,
      ...terms,
      ...trialTerms(sub, periodEnd),
    },
    {
      items: nextItems.map((next, index) => phaseItem(next.price, next.quantity, items[index])),
      ...terms,
    },
  ];

  await stripe.subscriptionSchedules.update(
    scheduleId,
    { end_behavior: "release", phases, metadata: nextRevision(schedule?.metadata) },
    {
      // Pełne fazy w kluczu: zmiana rabatu albo podatku między próbami to
      // inna operacja, nie powtórzenie poprzedniej.
      idempotencyKey: await idempotencyKey("schedule-update", [
        scheduleId,
        revisionOf(schedule?.metadata),
        ...fingerprint,
        JSON.stringify(phases),
      ]),
    },
  );
  return periodEnd;
}

/**
 * Pozycje fazy, która wejdzie przy odnowieniu: następnej po bieżącej
 * w harmonogramie dołączonym do subskrypcji. `retrieveLive` rozwija
 * harmonogram, więc fazy mamy z tego samego odczytu co decyzję - bez
 * osobnego `retrieve`, który mógłby już widzieć inny stan. Bieżącą fazę
 * wskazuje data początku z `current_phase`: lista bywa poprzedzona fazami
 * minionymi, więc „druga z listy" nie jest regułą.
 *
 * `null` = brak harmonogramu, brak fazy po bieżącej albo kształt, którego nie
 * umiemy odczytać (cena bez identyfikatora). Wywołujący czytają to jako „nie
 * wiemy, co jest zaplanowane", nigdy jako zgodę na zwolnienie.
 */
function pendingPhaseLines(sub: Stripe.Subscription): PhaseLine[] | null {
  const schedule = attachedSchedule(sub);
  const current = schedule?.current_phase;
  const phases = schedule?.phases;
  if (!current || !Array.isArray(phases)) return null;
  const index = phases.findIndex((phase) => phase.start_date === current.start_date);
  const next = index >= 0 ? phases[index + 1] : undefined;
  if (!next?.items?.length) return null;
  const lines: PhaseLine[] = [];
  for (const item of next.items) {
    const price = refOf(item.price);
    if (!price) return null;
    // Pozycja licencjonowana bez ilości to dla operatora jedna sztuka.
    lines.push({ price, quantity: item.quantity ?? 1 });
  }
  return lines;
}

/**
 * Powrót do BIEŻĄCEJ liczby miejsc (ponowny zapis tej samej liczby albo
 * cofnięcie zaplanowanego zmniejszenia) odwołuje WYŁĄCZNIE oczekującą zmianę
 * miejsc. Dawniej zwalniał każdy dołączony harmonogram, więc administrator,
 * który tylko zapisał formularz bez zmian, kasował zaplanowaną zmianę PLANU
 * (downgrade, migracja ceny z panelu operatora) - odnowienie szło po
 * starej, droższej cenie. Rozstrzyga faza następna (`pendingPhaseLines`):
 *
 * - te same ceny, inna ilość - czysta zmiana miejsc: zwolnienie, jak dawniej
 *   (harmonogram w kształcie tego modułu nie niesie wtedy nic innego);
 * - inna cena i inna ilość: przepisanie faz tym samym budowniczym co
 *   downgrade (`scheduleFromNextPeriod` - rabat, podatek, trial z żywej
 *   subskrypcji, klucz z odcisku i licznika), nowa cena zostaje, ilość wraca
 *   do bieżącej;
 * - ta sama ilość (sama zmiana ceny albo nic), inna liczba pozycji niż na
 *   subskrypcji (bez pary pozycja-pozycja nie wiadomo, czyjej ilości dotyczy
 *   zmiana) albo kształt nieczytelny: harmonogram nietknięty - nic, czego
 *   administrator nie zmieniał, nie znika po cichu.
 */
async function dropPendingSeatChange(
  stripe: Stripe,
  subscriptionId: string,
  sub: Stripe.Subscription,
): Promise<void> {
  const pending = pendingPhaseLines(sub);
  const items = sub.items.data;
  if (!pending || pending.length !== items.length) return;
  const liveQuantity = (index: number) => Math.max(1, items[index]?.quantity ?? 1);
  if (pending.every((line, index) => line.quantity === liveQuantity(index))) return;
  if (pending.every((line, index) => line.price === refOf(items[index]?.price))) {
    await releaseAttachedSchedule(stripe, sub);
    return;
  }
  await scheduleFromNextPeriod(
    stripe,
    subscriptionId,
    sub,
    pending.map((line, index) => ({ price: line.price, quantity: liveQuantity(index) })),
  );
}

/**
 * Kompensacja nieudanej rezygnacji przy zaplanowanej zmianie. Rezygnacja
 * zwalnia harmonogram PRZED flagą (operator odrzuca flagę na subskrypcji
 * zarządzanej harmonogramem), więc błąd flagi (przejściowe 5xx, limit
 * zapytań) zostawiał subskrypcję bez rezygnacji I bez zaplanowanego
 * downgrade'u / zmniejszenia miejsc: odnowienie po starej, droższej cenie,
 * choć żadna z dwóch decyzji klienta nie weszła. Zakładamy więc równoważny
 * harmonogram tymi samymi pomocnikami co zmiana od nowego okresu
 * (`createOwnSchedule` z potwierdzeniem odczytem, warunki rozliczenia
 * z żywej subskrypcji, deterministyczne klucze z odcisku stanu PO
 * zwolnieniu - inny niż sprzed niego, więc ponowiona rezygnacja dostaje
 * świeży klucz zamiast zapamiętanego 5xx), z fazą następną odczytaną przed
 * zwolnieniem.
 *
 * Najpierw odczyt, bo błąd bywa niejednoznaczny (zwolnienie albo flaga
 * weszły, odpowiedź zginęła). Subskrypcji z zaplanowanym końcem, z wciąż
 * dołączonym albo innym harmonogramem (zwolnienie nie weszło, równoległa
 * operacja, panel) albo zakończonej NIE ruszamy: harmonogram przy
 * zaplanowanym końcu operator odrzuci albo (fazy z `end_behavior: release`)
 * odwoła nim rezygnację, która jednak weszła, a drugiego harmonogramu obok
 * żywego operator nie założy. Wynik operacji zostaje pierwotnym błędem:
 * wywołujący nie zapisuje rezygnacji, tę, która mimo błędu weszła,
 * przyniesie webhook, a ponowienie trafi w „już się kończy". Błąd samej
 * kompensacji logujemy głośno do ręcznego odtworzenia - jak
 * w `restoreCancellation`.
 */
async function restoreReleasedSchedule(
  stripe: Stripe,
  subscriptionId: string,
  releasedScheduleId: string | null,
  pending: readonly PhaseLine[],
): Promise<void> {
  try {
    const live = await retrieveLive(stripe, subscriptionId);
    if (live.status === "canceled" || refOf(live.schedule) || scheduledCancellation(live)) return;
    await scheduleFromNextPeriod(stripe, subscriptionId, live, pending);
  } catch (e) {
    console.error(
      "[payments] cancellation failed AND released schedule restore failed - recreate it manually",
      subscriptionId,
      releasedScheduleId,
      JSON.stringify(pending),
      getStripeErrorMessage(e),
    );
  }
}

/**
 * Zmiana natychmiastowa z dopłatą proporcjonalną (`pending_if_incomplete`):
 * operator podmienia pozycje dopiero po opłaceniu faktury. `alongside` to
 * pola, które mają wejść RAZEM z opłaconą zmianą - dziś cofnięcie
 * zaplanowanej rezygnacji. Operator przyjmuje `cancel_at_period_end`
 * w aktualizacji oczekującej, więc odmowa karty nie odwołuje rezygnacji, a
 * udana dopłata zdejmuje ją w TYM SAMYM zdarzeniu co nową cenę. Dawniej szło
 * to drugim wywołaniem, a dwa `customer.subscription.updated` z tej samej
 * sekundy potrafiły zostawić w lustrze „kończy się" przy odnawiającej się
 * subskrypcji (przegląd SUB-04). Daty `cancel_at` operator w oczekującej
 * zmianie nie przyjmuje - tę zdejmuje wywołujący po sukcesie.
 *
 * Dołączony harmonogram zwalniamy DOPIERO po zastosowanej zmianie (nagłówek
 * modułu): odmowa zostawia zaplanowaną wcześniej zmianę nietkniętą.
 */
async function updateWithProration(
  stripe: Stripe,
  subscriptionId: string,
  current: Stripe.Subscription,
  op: string,
  item: { id: string; price?: string; quantity: number },
  alongside: Pick<Stripe.SubscriptionUpdateParams, "cancel_at_period_end"> = {},
): Promise<Stripe.Subscription | SubscriptionOpFailure> {
  const fingerprint = stateFingerprint(subscriptionId, current);
  const updated = await stripe.subscriptions.update(
    subscriptionId,
    {
      items: [item],
      ...alongside,
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
        alongside.cancel_at_period_end,
      ]),
    },
  );
  // Odmowa / 3DS (zwrócona albo RZUCONA): nic nie weszło, a harmonogram
  // zostaje - klient zapłaci przy odnowieniu to, na co się wcześniej umówił.
  if (updated.pending_update) return incompletePayment(stripe, updated);
  await releaseSupersededSchedule(stripe, subscriptionId, current);
  return updated;
}

function isFailure(value: unknown): value is SubscriptionOpFailure {
  return !!value && typeof value === "object" && (value as { ok?: unknown }).ok === false;
}

/**
 * Kompensacja nieudanego downgrade'u na subskrypcji, która miała zaplanowany
 * koniec: wraca ten sam kształt (flaga albo data), a błąd kompensacji jest
 * logowany głośno (stan u operatora wymaga wtedy ręcznej korekty - wynik
 * operacji i tak jest odmową).
 */
async function restoreCancellation(
  stripe: Stripe,
  subscriptionId: string,
  sub: Stripe.Subscription,
  cancellation: ScheduledCancellation,
): Promise<void> {
  try {
    await stripe.subscriptions.update(
      subscriptionId,
      { ...cancellationRestore(cancellation), metadata: nextRevision(sub.metadata) },
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

/**
 * Zdjęcie daty końca (`cancel_at` z panelu/portalu) po OPŁACONYM upgradzie -
 * klient zostaje, jak przy fladze. Osobne wywołanie, bo operator nie przyjmuje
 * `cancel_at` w aktualizacji oczekującej. Błąd NIE cofa upgrade'u.
 *
 * @returns czy koniec WCIĄŻ jest zaplanowany - wywołujący lustrzą tę wartość
 */
async function clearCancelDateAfterUpgrade(
  stripe: Stripe,
  subscriptionId: string,
  updated: Stripe.Subscription,
): Promise<boolean> {
  try {
    const cleared = await stripe.subscriptions.update(
      subscriptionId,
      { cancel_at: "", metadata: nextRevision(updated.metadata) },
      {
        idempotencyKey: await idempotencyKey(
          "cancel-at-clear",
          stateFingerprint(subscriptionId, updated),
        ),
      },
    );
    return scheduledCancellation(cleared) !== null;
  } catch (e) {
    console.error(
      "[payments] upgrade applied, cancel date removal failed",
      subscriptionId,
      getStripeErrorMessage(e),
    );
    return true;
  }
}

/**
 * Czy bieżący okres jest opłacony: ostatnia faktura subskrypcji ma status
 * `paid`. Pauza poboru, w trakcie której minęło odnowienie, zostawia fakturę
 * odnowienia `void` / `uncollectible` / `draft` (zależnie od `behavior`);
 * pauza w środku opłaconego okresu - opłaconą fakturę z jego początku.
 * Faktura nierozwinięta albo brak faktury = nie wiemy = nieopłacony.
 */
function currentPeriodPaid(sub: Stripe.Subscription): boolean {
  const invoice = sub.latest_invoice;
  return !!invoice && typeof invoice === "object" && invoice.status === "paid";
}

// --- operacje ----------------------------------------------------------------

/**
 * Anulowanie z zachowaniem opłaconego okresu (`cancel_at_period_end`).
 * Zaplanowana zmiana (harmonogram) traci sens przy rezygnacji i blokowałaby
 * flagę po stronie operatora, więc zwalniamy ją najpierw - a gdy flaga się
 * nie ustawi, odtwarzamy (`restoreReleasedSchedule`): odmowa nie może
 * skasować zmiany, na którą klient się wcześniej umówił.
 *
 * DLACZEGO NIE JEDNO WYWOŁANIE. Operator nie ma mutacji, która atomowo
 * zwalnia harmonogram i ustawia flagę: `release` przyjmuje tylko
 * `preserve_cancel_date` (zachowuje koniec ustawiony PRZEZ harmonogram),
 * a flagę na subskrypcji z harmonogramem odrzuca. Rezygnację da się zapisać
 * samym harmonogramem (faza bieżąca do końca okresu, `end_behavior:
 * "cancel"`), ale wtedy koniec należy do harmonogramu, nie do subskrypcji:
 * flaga `cancel_at_period_end` zostaje `false`, a to, czy operator
 * odzwierciedli koniec w `cancel_at` (drugim polu, z którego lustro
 * `mapScheduledChange` czyta rezygnację), zależy od harmonogramu, nie od
 * nas. Wznowienie (`cancellationRevert` na subskrypcji) operator odrzuciłby
 * wtedy jako zmianę końca subskrypcji zarządzanej harmonogramem -
 * rezygnacja bez drogi powrotu z aplikacji. Zostają dwa kroki
 * z kompensacją, która nie zmienia kształtu stanu, na którym opierają się
 * webhook i wznowienie.
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
    // Zaplanowaną zmianę bierzemy z odczytu PRZED zwolnieniem (rozwinięty
    // harmonogram) - po zwolnieniu subskrypcja już go nie wskazuje.
    const pending = pendingPhaseLines(current);
    try {
      // Zwolnienie też w bloku kompensacji: jego odpowiedź może zginąć PO
      // wykonaniu. Kompensacja i tak najpierw czyta żywy stan, więc
      // harmonogram, który jednak został, nie dostaje drugiego.
      await releaseAttachedSchedule(stripe, current);
      await stripe.subscriptions.update(
        subscriptionId,
        { cancel_at_period_end: true, metadata: nextRevision(current.metadata) },
        { idempotencyKey: await idempotencyKey("cancel", fingerprint) },
      );
    } catch (e) {
      if (pending) {
        await restoreReleasedSchedule(stripe, subscriptionId, refOf(current.schedule), pending);
      }
      throw e;
    }
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
 * `active`); `cancellation_reverted` - cofnięty zaplanowany koniec (flaga
 * albo data `cancel_at`); `already_active` - u operatora nie było czego
 * wznawiać: brak pauzy, brak zaplanowanego końca w KTÓRYMKOLWIEK kształcie,
 * czyli subskrypcja naprawdę się odnawia (lustro było spóźnione).
 */
export type ResumeMode =
  "unpaused" | "collection_resumed" | "cancellation_reverted" | "already_active";

/**
 * Wznowienie - JEDNA intencja użytkownika, trzy różne mechanizmy operatora.
 * Rozstrzyga ŻYWY stan, nie lustro w bazie: dawna ścieżka dla statusu
 * `paused` robiła `pause_collection: null`, co subskrypcji w statusie
 * `paused` nie wznawia (to inny mechanizm), a pauzy poboru ustawionej
 * w panelu operatora w ogóle nie widziała, bo lustro ma wtedy status `active`.
 *
 * Zaplanowany koniec to flaga ALBO data `cancel_at` (panel, portal). Lustro
 * pokazuje obie jako „kończy się" i daje „Wznów", a wznowienie patrzyło tylko
 * na flagę: przy samej dacie patch był pusty, wynik `already_active`, UI
 * meldowało „wznowiono", a operator kończył subskrypcję w dniu `cancel_at`.
 *
 * PAUZA POBORU - REGUŁA SAMOOBSŁUGI. `pause_collection` ustawia wyłącznie
 * operator w swoim panelu (aplikacja nie ma już kodu, który by ją zakładał),
 * więc to decyzja operatora, nie klienta. Klient zdejmuje ją sam TYLKO wtedy,
 * gdy bieżący okres jest opłacony (`currentPeriodPaid`) - zdjęcie wznawia
 * wtedy wyłącznie przyszły pobór, a dostęp do końca okresu klientowi i tak
 * się należy. Gdy w czasie pauzy minęło odnowienie (faktura `void`,
 * `uncollectible` albo `draft`), samo zdjęcie pauzy oddawało dostęp do końca
 * okresu, za który nikt nie zapłacił (rok na planie rocznym) i ignorowało
 * `resumes_at` operatora - wynik to odmowa `PAUSED_BY_OPERATOR`. Celowo NIE
 * pobieramy tu opłaty sami: przy `keep_as_draft` istnieje szkic faktury za
 * ten okres, więc własne obciążenie groziłoby podwójnym rachunkiem, a o
 * losie unieważnionej faktury (dług, prezent, spór) rozstrzyga operator.
 */
export async function resumeProviderSubscription(
  env: StripeEnv,
  subscriptionId: string,
): Promise<SubscriptionOpResult<{ mode: ResumeMode }>> {
  let stripe: Stripe | null = null;
  try {
    stripe = await getStripeClient(env);
    const current = await retrieveLive(stripe, subscriptionId, ["latest_invoice"]);
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
    if (current.pause_collection) {
      // Pauza operatora przy nieopłaconym okresie: wznowienie bez płatności
      // byłoby darmowym dostępem - odmowa całości (także cofnięcia końca),
      // bo połowiczne „wznowienie" z trwającą pauzą wprowadzałoby w błąd.
      if (!currentPeriodPaid(current)) return { ok: false, error: PAUSED_BY_OPERATOR };
      // Pusty napis zdejmuje pauzę po stronie operatora (`Emptyable`); pole
      // `undefined` zostałoby pominięte i pauza trwałaby mimo „ok" u nas.
      patch.pause_collection = "";
    }
    const cancellation = scheduledCancellation(current);
    if (cancellation) Object.assign(patch, cancellationRevert(cancellation));
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
   * Czy u operatora PO operacji wciąż jest zaplanowany koniec (flaga
   * `cancel_at_period_end` albo data `cancel_at`). Zmiana planu zdejmuje go
   * (klient zostaje), więc `true` zostaje tylko wtedy, gdy zdjęcie się nie
   * udało. Wywołujący lustrzą TĘ wartość w `canceled_at` - stan operatora,
   * nie własne założenie.
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
    const cancellation = scheduledCancellation(current);

    if (target.rank > currentEntry.rank) {
      // Flagę cofamy W oczekującej aktualizacji: wejdzie razem z opłaconą
      // ceną (jedno zdarzenie), a odmowa karty zostawi rezygnację w mocy.
      const updated = await updateWithProration(
        stripe,
        subscriptionId,
        current,
        "plan-upgrade",
        { id: item.id, price: providerPriceId, quantity },
        cancellation?.kind === "period_end" ? { cancel_at_period_end: false } : {},
      );
      if (isFailure(updated)) return updated;

      // Dopłata przeszła, więc klient zostaje. Data końca nie mieści się
      // w oczekującej zmianie - schodzi osobno, a jej błąd NIE cofa
      // opłaconego upgrade'u: wywołujący nie czyści `canceled_at`, dopóki
      // operator naprawdę nie zdjął końca.
      const cancelAtPeriodEnd =
        cancellation?.kind === "date"
          ? await clearCancelDateAfterUpgrade(stripe, subscriptionId, updated)
          : scheduledCancellation(updated) !== null;
      return {
        ok: true,
        direction: "upgrade",
        effect: "applied",
        currentPeriodEnd: isoFromUnix(updated.items?.data?.[0]?.current_period_end),
        cancelAtPeriodEnd,
      };
    }

    // Downgrade: bez proraty, zmiana obowiązuje dopiero od nowego okresu.
    // Zaplanowany koniec (flagę albo datę) zdejmujemy JAWNIE przed
    // harmonogramem (operator nie łączy `cancel_at_period_end` z harmonogramem,
    // a przejęcie końca subskrypcji przez fazy byłoby efektem ubocznym zamiast
    // decyzji widocznej w historii). Gdy harmonogram się nie uda, przywracamy
    // ten sam koniec - inaczej klient, który odchodził, zostałby przy wyższej
    // cenie bez zaplanowanej zmiany i bez zgody na odnowienie.
    let base = current;
    if (cancellation) {
      const reverted = await stripe.subscriptions.update(
        subscriptionId,
        { ...cancellationRevert(cancellation), metadata: nextRevision(current.metadata) },
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
      if (cancellation) await restoreCancellation(stripe, subscriptionId, base, cancellation);
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

export interface SeatChangeOutcome {
  /** Liczba miejsc docelowa (po przycięciu do 1-500). */
  quantity: number;
  effect: ChangeEffect;
  /**
   * Tylko `scheduled`: początek nowego okresu (ISO), od którego operator
   * nalicza nową liczbę miejsc; `null`, gdy operator nie podał końca okresu.
   */
  effectiveAt?: string | null;
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
 *
 * Zmniejszenie to WYŁĄCZNIE plan u operatora: limit organizacji i miejsca
 * zespołu zmienia dopiero webhook na starcie nowego okresu (`effectiveAt`),
 * gdy pozycja subskrypcji naprawdę niesie nową ilość. Wywołujący nie mogą
 * przy `scheduled` zapisywać nowej liczby w bazie.
 */
export async function updateSubscriptionQuantity(
  env: StripeEnv,
  subscriptionId: string,
  params: { priceExternalId: string; quantity: number; previousQuantity?: number },
): Promise<SubscriptionOpResult<SeatChangeOutcome>> {
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
      // Powrót do bieżącej liczby = rezygnacja z zaplanowanej zmiany MIEJSC,
      // nie z zaplanowanej zmiany planu - ta zostaje (`dropPendingSeatChange`).
      await dropPendingSeatChange(stripe, subscriptionId, current);
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

    // Subskrypcja z zaplanowanym końcem nie ma „nowego okresu", od którego
    // mniejsza liczba miejsc miałaby obowiązywać. Harmonogram z fazą
    // otwartą i `end_behavior: release` przejąłby za to koniec subskrypcji
    // i odnowił ją klientowi, który zrezygnował - odmowa zamiast cichego
    // odwołania rezygnacji (downgrade planu cofa ją jawnie, bo zmiana planu
    // znaczy „zostaję"; mniej miejsc tego nie znaczy).
    if (scheduledCancellation(current)) return { ok: false, error: "subscription_canceling" };

    const priceId = refOf(item.price);
    if (!priceId) return { ok: false, error: "no_subscription_item" };
    const effectiveAt = await scheduleFromNextPeriod(stripe, subscriptionId, current, [
      { price: priceId, quantity },
    ]);
    return { ok: true, quantity, effect: "scheduled", effectiveAt: isoFromUnix(effectiveAt) };
  } catch (e) {
    return failureOf(stripe, subscriptionId, e);
  }
}

// --- oczekująca zmiana zastosowana po czasie ---------------------------------

/** Pozycja z migawki zdarzenia: cena operatora (`price_...`, nie `lookup_key`) i ilość. */
export interface AppliedSubscriptionLine {
  price: string;
  quantity: number;
}

/**
 * Co stało się z harmonogramem po zastosowanej oczekującej zmianie:
 * - `released`     - następna faza cofała zmianę (niższy plan albo mniej
 *                    miejsc przy tej samej cenie): harmonogram zwolniony,
 * - `rewritten`    - następna faza niosła INNĄ cenę (panel operatora,
 *                    migracja cennika) i mniej miejsc: cena zostaje, ilość
 *                    wraca do opłaconej,
 * - `kept`         - następna faza zmianie nie przeczy (albo jej kształtu nie
 *                    umiemy odczytać) - nietknięta,
 * - `not_attached` - w chwili zastosowania harmonogramu nie było, a dziś nie
 *                    ma go wcale albo steruje inny (nowsza decyzja),
 * - `superseded`   - pozycje u operatora nie są już tymi z migawki: późniejsza
 *                    operacja rozstrzygnęła harmonogram po swojemu,
 * - `missing`      - operator nie zna subskrypcji (usunięta w piaskownicy).
 */
export type AppliedUpdateScheduleOutcome =
  "released" | "rewritten" | "kept" | "not_attached" | "superseded" | "missing";

function isResourceMissing(error: unknown): boolean {
  const failure = error as { code?: unknown; raw?: { code?: unknown } } | null;
  return (failure?.code ?? failure?.raw?.code) === "resource_missing";
}

/** Ranga planu z katalogu dla ceny operatora; `null` = cena spoza katalogu. */
function catalogRankOf(price: unknown): number | null {
  return catalogEntryByPriceId(readableLookupKey(price))?.rank ?? null;
}

/**
 * Czy zaplanowana cena to NIŻSZY plan niż opłacona właśnie. Cena fazy to sam
 * identyfikator (fazy nie rozwijamy), więc `lookup_key` doczytujemy - tylko
 * dla ceny innej niż bieżąca. Cena spoza katalogu (po żadnej stronie) nie ma
 * rangi: nie wiemy, że jest niższa, więc nie zwalniamy niczego na domysł.
 */
async function isLowerPlan(
  stripe: Stripe,
  nextPrice: string,
  appliedPrice: unknown,
): Promise<boolean> {
  const appliedRank = catalogRankOf(appliedPrice);
  if (appliedRank === null) return false;
  const nextRank = catalogRankOf(await stripe.prices.retrieve(nextPrice));
  return nextRank !== null && nextRank < appliedRank;
}

/**
 * Harmonogram po oczekującej zmianie zastosowanej PÓŹNIEJ - odrzucona dopłata
 * (`updateWithProration`) opłacona w oknie operatora, zdarzenie
 * `customer.subscription.pending_update_applied`. Pozycje niosą już nową
 * cenę/ilość, ale harmonogram zachowany przy odmowie (zaplanowany downgrade,
 * zmniejszenie miejsc) wciąż zastosowałby STARĄ decyzję na koniec okresu:
 * klient płaciłby mniej, niż wybrał, a plan po cichu spadałby przy odnowieniu.
 * Po udanej dopłacie od razu zwalnia go `releaseSupersededSchedule`; tu
 * podejmujemy tę decyzję z opóźnieniem, na ŻYWYM stanie, i tylko gdy
 * następna faza zmianie przeczy (`pendingPhaseLines`, para pozycja-pozycja):
 *
 * - niższy plan (ranga katalogu) albo mniej miejsc przy tej samej cenie -
 *   zwolnienie tym samym pomocnikiem co po udanej dopłacie (klucz z
 *   identyfikatora harmonogramu, deterministyczny),
 * - inna, nie niższa cena (panel, migracja cennika) i mniej miejsc -
 *   przepisanie faz (`scheduleFromNextPeriod`): cena zostaje, ilość wraca do
 *   opłaconej - jak przy powrocie do bieżącej liczby miejsc,
 * - wszystko inne (wyższy plan, tyle samo albo więcej miejsc, kształt
 *   nieczytelny) zostaje.
 *
 * NOWSZA DECYZJA KLIENTA ZOSTAJE. Zdarzenie bywa dostarczone z opóźnieniem
 * (ponowienie po błędzie), a klient mógł w tym czasie zaplanować downgrade
 * już z nowego planu. Działamy więc tylko na harmonogramie, który był
 * dołączony W CHWILI zastosowania (`applied.scheduleId` z migawki) - bez
 * niego nie pytamy operatora wcale - i tylko gdy pozycje u operatora wciąż
 * są tymi z migawki. Przepisania faz TEGO SAMEGO harmonogramu między
 * zastosowaniem a obsługą zdarzenia nie odróżnimy (operator nie podaje,
 * kiedy zmieniono fazy) - takie okno istnieje tylko przy spóźnionej dostawie.
 *
 * W przeciwieństwie do operacji z UI ta funkcja RZUCA: błąd operatora (także
 * zgubiona odpowiedź) wraca do webhooka, który odpowiada 500 i dostaje
 * zdarzenie ponownie. Ponowienie czyta żywy stan od nowa, więc zwolnienie,
 * które jednak weszło, nie idzie drugi raz.
 */
export async function reconcileScheduleWithAppliedUpdate(
  env: StripeEnv,
  subscriptionId: string,
  applied: { scheduleId: string | null; lines: readonly AppliedSubscriptionLine[] },
): Promise<AppliedUpdateScheduleOutcome> {
  if (!applied.scheduleId) return "not_attached";
  const stripe = await getStripeClient(env);
  let live: Stripe.Subscription;
  try {
    live = await retrieveLive(stripe, subscriptionId);
  } catch (e) {
    if (isResourceMissing(e)) return "missing";
    throw e;
  }

  const schedule = attachedSchedule(live);
  if (
    live.status === "canceled" ||
    refOf(live.schedule) !== applied.scheduleId ||
    !schedule ||
    !LIVE_SCHEDULE_STATUSES.has(schedule.status)
  ) {
    return "not_attached";
  }

  const items = live.items.data;
  const liveQuantity = (index: number) => Math.max(1, items[index]?.quantity ?? 1);
  const unchanged =
    items.length === applied.lines.length &&
    applied.lines.every(
      (line, index) =>
        refOf(items[index]?.price) === line.price &&
        (items[index]?.quantity ?? 1) === line.quantity,
    );
  if (!unchanged) return "superseded";

  const pending = pendingPhaseLines(live);
  if (!pending || pending.length !== items.length) return "kept";

  let lowerPlan = false;
  let fewerSeats = false;
  let samePrices = true;
  for (const [index, next] of pending.entries()) {
    if (next.quantity < liveQuantity(index)) fewerSeats = true;
    if (next.price === refOf(items[index]?.price)) continue;
    samePrices = false;
    if (await isLowerPlan(stripe, next.price, items[index]?.price)) lowerPlan = true;
  }

  if (lowerPlan || (fewerSeats && samePrices)) {
    await releaseAttachedSchedule(stripe, live);
    return "released";
  }
  if (fewerSeats) {
    await scheduleFromNextPeriod(
      stripe,
      subscriptionId,
      live,
      pending.map((line, index) => ({
        price: line.price,
        quantity: Math.max(line.quantity, liveQuantity(index)),
      })),
    );
    return "rewritten";
  }
  return "kept";
}
