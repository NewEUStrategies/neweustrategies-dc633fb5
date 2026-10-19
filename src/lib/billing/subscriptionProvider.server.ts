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
// harmonogramu, którego następna faza zmianie przeczy, a fazy zaplanowano od
// pozycji sprzed niej (odcisk `nes_basis` w metadanych harmonogramu).
// Tak samo z datą końca `cancel_at` przy upgradzie planu: operator nie
// przyjmuje jej w oczekującej zmianie, więc odmowa zapisuje na fakturze tej
// zmiany datę i cenę z chwili prośby (`markUpgradeCancelDate`), a webhook
// zdejmuje datę po zapłacie wyłącznie wtedy, gdy u operatora jest wciąż ta
// sama, niezmieniona data przy cenie z prośby, w oknie ponowień operatora
// (`clearCancelDateAfterAppliedUpgrade`).
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
// (`stripeEvents.mapScheduledChange`). Wznowienie i zmiana planu zdejmują oba -
// upgrade dopiero po opłaconej dopłacie (także opłaconej później).
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
import {
  amountForQuantity,
  linePriceTarget,
  repriceDecision,
  type PriceShape,
  type RepriceDecision,
  type RepriceInput,
  type RepriceLine,
} from "@/lib/billing/subscriptionRepricing";
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
  const hex = await sha256Hex(material.join("|"));
  return `nes-sub-${op}-${hex.slice(0, 48)}`;
}

async function sha256Hex(material: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
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

/**
 * Metadane harmonogramu: odcisk pozycji subskrypcji, OD KTÓRYCH zaplanowano
 * zmianę zapisaną w fazach (`scheduleFromNextPeriod`). Rozstrzyga, czy
 * harmonogram dołączony po zastosowanej później dopłacie to ten zachowany
 * przy odmowie (zaplanowany od STARYCH pozycji), czy nowsza decyzja klienta
 * podjęta już na opłaconych pozycjach - w obu przypadkach identyfikator jest
 * ten sam, bo aplikacja przepisuje fazy dołączonego harmonogramu w miejscu
 * (`reconcileScheduleWithAppliedUpdate`).
 */
const SCHEDULE_BASIS_KEY = "nes_basis";

/**
 * Odcisk pozycji subskrypcji (cena, ilość) - skrót, bo metadane operatora
 * mieszczą 500 znaków, a subskrypcja z panelu może mieć do 20 pozycji.
 * Pozycja bez ilości to dla operatora jedna sztuka - ta sama reguła co
 * w porównaniu z migawką zdarzenia.
 */
async function scheduleBasis(items: readonly Stripe.SubscriptionItem[]): Promise<string> {
  return basisOfLines(
    items.map((item) => ({ price: refOf(item.price) ?? "", quantity: item.quantity ?? 1 })),
  );
}

/**
 * Ten sam odcisk z pozycji podanych wprost - dla zapisu faz, które ZMIENIAJĄ
 * pozycje bieżącej fazy (przeniesienie na cenę katalogu, `proration_behavior:
 * none`): po nim subskrypcja niesie już nowe ceny, więc odcisk musi opisywać
 * je, a nie pozycje sprzed zapisu.
 */
async function basisOfLines(lines: readonly PhaseLine[]): Promise<string> {
  const parts = lines.map((line) => `${line.price}*${line.quantity}`);
  return (await sha256Hex(parts.join(","))).slice(0, 40);
}

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
 * harmonogram) mają ją w ręku bez dodatkowego odczytu. Z niej też odcisk
 * pozycji, od których zaplanowano zmianę (`SCHEDULE_BASIS_KEY`).
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
    {
      end_behavior: "release",
      phases,
      // Odcisk pozycji, od których planujemy, jedzie w TYM SAMYM zapisie co
      // fazy - osobny zapis mógłby się nie udać i zostawić stary odcisk przy
      // nowych fazach (`SCHEDULE_BASIS_KEY`).
      metadata: {
        ...nextRevision(schedule?.metadata),
        [SCHEDULE_BASIS_KEY]: await scheduleBasis(items),
      },
    },
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
 * zmianie nie przyjmuje - tę zdejmuje wywołujący po sukcesie, a przy odmowie
 * (`cancelDateToMark`) zapisujemy ją na fakturze oczekującej zmiany, żeby
 * zdjął ją webhook po zapłacie opłaconej później (`markUpgradeCancelDate`).
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
  options: {
    alongside?: Pick<Stripe.SubscriptionUpdateParams, "cancel_at_period_end">;
    /** Data końca `cancel_at` z żywego stanu - do znacznika przy odrzuconej dopłacie. */
    cancelDateToMark?: number;
  } = {},
): Promise<Stripe.Subscription | SubscriptionOpFailure> {
  const alongside = options.alongside ?? {};
  const fingerprint = stateFingerprint(subscriptionId, current);
  let updated: Stripe.Subscription;
  try {
    updated = await stripe.subscriptions.update(
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
  } catch (e) {
    // Odmowa RZUCONA: oczekująca zmiana i jej faktura mogły mimo to powstać
    // (`declinedPayment`) - znacznik idzie tak samo jak przy zwróconej.
    if (options.cancelDateToMark !== undefined && item.price && declineOf(e)) {
      await markUpgradeCancelDate(stripe, subscriptionId, current, {
        price: item.price,
        cancelAt: options.cancelDateToMark,
        returned: null,
      });
    }
    throw e;
  }
  // Odmowa / 3DS (zwrócona albo RZUCONA): nic nie weszło, a harmonogram
  // zostaje - klient zapłaci przy odnowieniu to, na co się wcześniej umówił.
  if (updated.pending_update) {
    if (options.cancelDateToMark !== undefined && item.price) {
      await markUpgradeCancelDate(stripe, subscriptionId, current, {
        price: item.price,
        cancelAt: options.cancelDateToMark,
        returned: updated,
      });
    }
    return incompletePayment(stripe, updated);
  }
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
 * `cancel_at` w aktualizacji oczekującej. Błąd NIE cofa upgrade'u. Dopłatę
 * opłaconą później (odmowa, 3DS) rozstrzyga webhook -
 * `clearCancelDateAfterAppliedUpgrade`.
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
    warnIfPeriodExtended(subscriptionId, updated, cleared);
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
 * Data krótsza niż okres nowej ceny (upgrade ze zmianą interwału: okres od
 * teraz kończy się w dniu daty) po zdjęciu przedłuża bieżący okres, a operator
 * tworzy prorację przedłużenia, która czeka na NASTĘPNĄ fakturę - zwykle
 * odnowienie. Obu zdjęć nie łączymy z natychmiastowym obciążeniem (poza
 * zakresem: obciążenie poza sesją klienta i jego odmowa), więc zostawiamy
 * głośny log do ręcznego zafakturowania.
 */
function warnIfPeriodExtended(
  subscriptionId: string,
  before: Stripe.Subscription,
  after: Stripe.Subscription,
): void {
  const from = before.items?.data?.[0]?.current_period_end;
  const to = after.items?.data?.[0]?.current_period_end;
  if (typeof from === "number" && typeof to === "number" && to > from) {
    console.warn(
      "[payments] cancel date removed, current period extended - its proration waits for the next invoice",
      subscriptionId,
      from,
      to,
    );
  }
}

/**
 * Znacznik daty końca na FAKTURZE oczekującej zmiany - pola operatora pod
 * ich własnymi nazwami, odczytane z ŻYWEGO stanu, na którym klient poprosił
 * o upgrade: `cancel_at` (data) i `canceled_at` (chwila ustawienia końca -
 * „czas ostatniego żądania" wg dokumentacji operatora, więc ponowne ustawienie,
 * także tej samej daty, ją przesuwa), plus cena docelowa prośby. Webhook
 * zdejmuje datę po zapłacie tylko przy obu wartościach niezmienionych i przy
 * subskrypcji na TEJ cenie (`clearCancelDateAfterAppliedUpgrade`); gdyby
 * operator przesuwał `canceled_at` także przy innych zmianach, wynikiem jest
 * data zostawiona, nigdy zdjęta.
 *
 * DLACZEGO FAKTURA, NIE SUBSKRYPCJA. Zapis metadanych faktury nie jest
 * aktualizacją subskrypcji, więc nie dotyka oczekującej zmiany (metadane
 * subskrypcji z `pending_if_incomplete` jechałyby W niej i weszły dopiero po
 * zapłacie), a faktura wiąże znacznik z TĄ zapłatą: ponowna próba upgrade'u
 * unieważnia starą fakturę i wystawia nową. Operator blokuje po finalizacji
 * kwoty i pola rozliczenia, metadanych - nie.
 */
const UPGRADE_CANCEL_AT_KEY = "nes_upgrade_cancel_at";
const UPGRADE_CANCELED_AT_KEY = "nes_upgrade_canceled_at";
const UPGRADE_PRICE_KEY = "nes_upgrade_price";

/**
 * Upgrade przy dacie końca z odrzuconą dopłatą (odmowa, 3DS): znacznik daty
 * na fakturze oczekującej zmiany. Fakturę podaje odpowiedź (odmowa zwrócona)
 * albo żywa subskrypcja z `pending_update` (odmowa RZUCONA) - w obu wypadkach
 * tylko oczekująca zmiana z ceną z prośby. Odmowa rzucona mogła zostawić
 * wcześniejszą oczekującą zmianę (dołożenie miejsc, zmiana spoza aplikacji),
 * a jej zapłata nie znaczy „zostaję".
 *
 * Błąd zapisu logujemy głośno i NIE zmienia on wyniku operacji (zmiana i tak
 * nie weszła). Bez znacznika data po późniejszej zapłacie zostaje - jak przed
 * tą ścieżką, nigdy odwrotnie. Z tego samego powodu daty bez `canceled_at`
 * nie znakujemy: ponownego ustawienia tej samej daty po odmowie nie dałoby się
 * odróżnić od daty sprzed prośby.
 */
async function markUpgradeCancelDate(
  stripe: Stripe,
  subscriptionId: string,
  current: Stripe.Subscription,
  // Data przychodzi od wołającego (`scheduledCancellation` tego samego
  // odczytu), więc tu nie ma już gałęzi „to nie data".
  mark: { price: string; cancelAt: number; returned: Stripe.Subscription | null },
): Promise<void> {
  const { price, cancelAt, returned } = mark;
  let invoiceId: string | null = null;
  try {
    if (typeof current.canceled_at !== "number") {
      throw new Error("cancel date without canceled_at");
    }
    const attempt = returned ?? (await stripe.subscriptions.retrieve(subscriptionId));
    // Odmowa bez oczekującej zmiany: nie ma faktury, której zapłata coś zastosuje.
    if (!attempt.pending_update) return;
    const requested = attempt.pending_update.subscription_items?.some(
      (line) => refOf(line.price) === price,
    );
    if (!requested) throw new Error("pending update does not carry the requested price");
    invoiceId = refOf(attempt.latest_invoice);
    if (!invoiceId) throw new Error("pending update without invoice");
    await stripe.invoices.update(
      invoiceId,
      {
        metadata: {
          [UPGRADE_CANCEL_AT_KEY]: String(cancelAt),
          [UPGRADE_CANCELED_AT_KEY]: String(current.canceled_at),
          [UPGRADE_PRICE_KEY]: price,
        },
      },
      {
        idempotencyKey: await idempotencyKey("upgrade-cancel-mark", [
          subscriptionId,
          invoiceId,
          price,
          cancelAt,
          current.canceled_at,
        ]),
      },
    );
  } catch (e) {
    console.error(
      "[payments] upgrade payment pending, cancel date marker not written - a later payment keeps the date",
      subscriptionId,
      invoiceId,
      getStripeErrorMessage(e),
    );
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
      // Datę odmowa też zostawia, ale znakuje ją na fakturze oczekującej
      // zmiany - zdejmie ją webhook, jeśli klient zapłaci później.
      const updated = await updateWithProration(
        stripe,
        subscriptionId,
        current,
        "plan-upgrade",
        { id: item.id, price: providerPriceId, quantity },
        {
          alongside: cancellation?.kind === "period_end" ? { cancel_at_period_end: false } : {},
          cancelDateToMark: cancellation?.kind === "date" ? cancellation.at : undefined,
        },
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
      // Więcej miejsc nie znaczy „zostaję": zaplanowanego końca nie zdejmujemy
      // ani tu, ani po dopłacie opłaconej później (faktura bez znacznika).
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
 * - `superseded`   - późniejsza operacja rozstrzygnęła harmonogram po swojemu:
 *                    pozycje u operatora nie są już tymi z migawki albo fazy
 *                    zaplanowano już OD opłaconych pozycji (`nes_basis`),
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
 * NOWSZA DECYZJA KLIENTA ZOSTAJE. Zdarzenie bywa obsłużone z opóźnieniem
 * (5xx, które operator pamięta pod kluczem zwolnienia przez dobę; limit
 * zapytań; ponowienie z panelu), a klient mógł w tym czasie zaplanować
 * downgrade albo mniej miejsc już od opłaconych pozycji. Działamy więc tylko:
 * - na harmonogramie dołączonym W CHWILI zastosowania (`applied.scheduleId`
 *   z migawki) - bez niego nie pytamy operatora wcale,
 * - przy pozycjach u operatora wciąż równych migawce,
 * - gdy fazy NIE zaplanowano od tych pozycji. Nowsza decyzja z aplikacji
 *   przepisuje fazy dołączonego harmonogramu W MIEJSCU (ten sam
 *   identyfikator), więc identyfikator jej nie odróżni; robi to odcisk
 *   pozycji zapisany razem z fazami (`SCHEDULE_BASIS_KEY`): harmonogram
 *   zachowany przy odmowie zaplanowano od pozycji SPRZED zmiany. Kształt
 *   faz nie wystarcza - zmiana `items` na subskrypcji z harmonogramem potrafi
 *   podzielić bieżącą fazę u operatora i bieżąca faza harmonogramu z odmowy
 *   niesie wtedy już NOWE pozycje, jak przepisanego. Harmonogram bez odcisku
 *   (panel operatora, zapis sprzed odcisku) rozstrzygamy samymi fazami.
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
  if (schedule.metadata?.[SCHEDULE_BASIS_KEY] === (await scheduleBasis(items))) {
    return "superseded";
  }

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

/**
 * Co stało się z datą końca `cancel_at` po zastosowanej później oczekującej
 * zmianie (upgrade planu z odrzuconą dopłatą, opłacony w oknie operatora):
 * - `cleared`         - data zdjęta: ta sama i niezmieniona od prośby o upgrade,
 * - `not_scheduled`   - u operatora nie ma już zaplanowanego końca (zdjęty przy
 *                       wcześniejszej próbie albo przez klienta),
 * - `ended`           - subskrypcja już się zakończyła,
 * - `not_marked`      - faktura bez znacznika z chwili prośby: zmiana spoza
 *                       aplikacji (panel), dołożenie miejsc, nieudany zapis
 *                       znacznika albo migawka bez faktury,
 * - `kept_changed`    - koniec zmieniony po prośbie: inna data, flaga
 *                       `cancel_at_period_end` albo ponowne ustawienie (nowsze
 *                       `canceled_at`) - nowsza decyzja klienta,
 * - `kept_schedule`   - datą steruje dołączony harmonogram (`end_behavior: cancel`),
 * - `kept_unverified` - faktura nie jest opłaconą fakturą zmiany TEJ
 *                       subskrypcji, subskrypcja nie jest na cenie z prośby
 *                       albo jej stan nie pozwala tego rozstrzygnąć,
 * - `kept_stale`      - wszystko zgodne, ale od zapłaty minęło więcej niż okno
 *                       ponowień operatora: klient od dawna widzi „kończy się",
 * - `missing`         - operator nie zna subskrypcji.
 */
export type AppliedUpgradeCancelDateOutcome =
  | "cleared"
  | "not_scheduled"
  | "ended"
  | "not_marked"
  | "kept_changed"
  | "kept_schedule"
  | "kept_unverified"
  | "kept_stale"
  | "missing";

/**
 * Okno zdjęcia daty od zapłaty faktury: operator ponawia zdarzenie do 3 dni.
 * Po zapłacie lustro (`customer.subscription.updated` z datą) pokazuje
 * klientowi „kończy się" do chwili obsługi `pending_update_applied`, więc
 * dostawa spóźniona dłużej (naprawa z panelu, ręczne ponowienie) trafia na
 * klienta, który mógł ten koniec przyjąć - data zostaje do ręcznej oceny.
 */
const APPLIED_CLEAR_WINDOW_SECONDS = 72 * 3_600;

/**
 * Data zostaje - z głośnym logiem: klient zapłacił oczekującą zmianę, a
 * subskrypcja się skończy (do ręcznej oceny, gdy to był upgrade planu).
 */
function keepCancelDate(
  outcome: AppliedUpgradeCancelDateOutcome,
  subscriptionId: string,
  details: Record<string, unknown>,
): AppliedUpgradeCancelDateOutcome {
  console.warn(
    "[payments] pending update paid later, cancel date kept",
    outcome,
    subscriptionId,
    JSON.stringify(details),
  );
  return outcome;
}

/**
 * Data końca po odrzuconym upgradzie opłaconym PÓŹNIEJ
 * (`customer.subscription.pending_update_applied`). Po udanej dopłacie
 * ścieżka synchroniczna zdejmuje datę od razu (`clearCancelDateAfterUpgrade`
 * - „zmiana planu = zostaję"), ale operator nie przyjmuje `cancel_at`
 * w oczekującej zmianie: bez tego kroku subskrypcja kończyła się w dniu daty
 * mimo opłaconego upgrade'u.
 *
 * ZDJĘCIE ZŁEJ DATY JEST GORSZE NIŻ BŁĄD: obciąża klienta, który zdecydował
 * się odejść. Zdejmujemy więc WYŁĄCZNIE datę, której dotyczyła prośba
 * o upgrade, i tylko gdy od tamtej pory się nie zmieniła - na ŻYWYM stanie
 * i przy wszystkich warunkach naraz:
 * - subskrypcja `active` / `trialing`, bez flagi `cancel_at_period_end` i bez
 *   dołączonego harmonogramu (data harmonogramu należy do niego),
 * - data u operatora = data z migawki zdarzenia = data ze znacznika faktury
 *   (`markUpgradeCancelDate`),
 * - `canceled_at` u operatora = `canceled_at` ze znacznika: ponowne ustawienie
 *   końca po odmowie (także tej samej daty, np. „wznów" i „anuluj" w portalu)
 *   je przesuwa; bez tej wartości nie rozstrzygamy wcale,
 * - faktura z migawki (`latest_invoice`) jest opłaconą fakturą zmiany
 *   (`subscription_update`) tej subskrypcji, a subskrypcja jest na cenie
 *   z prośby (znacznik `nes_upgrade_price`),
 * - od zapłaty faktury nie minęło okno ponowień operatora
 *   (`APPLIED_CLEAR_WINDOW_SECONDS`).
 * Wszystko inne zostawia datę (wynik `kept_*` / `not_marked` z logiem).
 *
 * Jak `reconcileScheduleWithAppliedUpdate` ta funkcja RZUCA: błąd operatora
 * (także zgubiona odpowiedź) wraca do webhooka, który odpowiada 500 i dostaje
 * zdarzenie ponownie. Ponowienie czyta żywy stan od nowa, więc data, która
 * jednak zeszła, nie schodzi drugi raz (`not_scheduled`).
 */
export async function clearCancelDateAfterAppliedUpgrade(
  env: StripeEnv,
  subscriptionId: string,
  applied: { invoiceId: string | null; cancelAt: number },
): Promise<AppliedUpgradeCancelDateOutcome> {
  const { invoiceId, cancelAt } = applied;
  if (!invoiceId) return keepCancelDate("not_marked", subscriptionId, { cancelAt });
  const stripe = await getStripeClient(env);
  let live: Stripe.Subscription;
  try {
    live = await retrieveLive(stripe, subscriptionId);
  } catch (e) {
    if (isResourceMissing(e)) return "missing";
    throw e;
  }

  if (live.status === "canceled" || live.status === "incomplete_expired") return "ended";
  const cancellation = scheduledCancellation(live);
  if (!cancellation) return "not_scheduled";
  const seen = {
    invoiceId,
    snapshotCancelAt: cancelAt,
    cancelAtPeriodEnd: live.cancel_at_period_end,
    cancelAt: live.cancel_at,
    canceledAt: live.canceled_at,
  };
  if (cancellation.kind !== "date" || cancellation.at !== cancelAt) {
    return keepCancelDate("kept_changed", subscriptionId, seen);
  }
  if (refOf(live.schedule)) {
    return keepCancelDate("kept_schedule", subscriptionId, {
      ...seen,
      scheduleId: refOf(live.schedule),
    });
  }

  let invoice: Stripe.Invoice;
  try {
    invoice = await stripe.invoices.retrieve(invoiceId);
  } catch (e) {
    if (isResourceMissing(e)) return keepCancelDate("not_marked", subscriptionId, seen);
    throw e;
  }
  const markedCancelAt = invoice.metadata?.[UPGRADE_CANCEL_AT_KEY] ?? null;
  const markedCanceledAt = invoice.metadata?.[UPGRADE_CANCELED_AT_KEY] ?? null;
  const markedPrice = invoice.metadata?.[UPGRADE_PRICE_KEY] ?? null;
  if (markedCancelAt === null) return keepCancelDate("not_marked", subscriptionId, seen);
  const livePrice = refOf(live.items?.data?.[0]?.price);
  // Zastosowana zmiana to upgrade z prośby: cena ze znacznika, nie np.
  // wcześniejsza oczekująca zmiana, na której fakturę trafił znacznik.
  const paidUpgradeInvoice =
    invoice.status === "paid" &&
    invoice.billing_reason === "subscription_update" &&
    refOf(invoice.parent?.subscription_details?.subscription) === subscriptionId &&
    markedPrice !== null &&
    livePrice === markedPrice;
  if (!paidUpgradeInvoice || (live.status !== "active" && live.status !== "trialing")) {
    return keepCancelDate("kept_unverified", subscriptionId, {
      ...seen,
      status: live.status,
      invoiceStatus: invoice.status,
      billingReason: invoice.billing_reason,
      markedPrice,
      livePrice,
    });
  }
  if (
    markedCancelAt !== String(cancellation.at) ||
    typeof live.canceled_at !== "number" ||
    markedCanceledAt !== String(live.canceled_at)
  ) {
    return keepCancelDate("kept_changed", subscriptionId, {
      ...seen,
      markedCancelAt,
      markedCanceledAt,
    });
  }
  const paidAt = invoice.status_transitions?.paid_at;
  if (
    typeof paidAt !== "number" ||
    Math.floor(Date.now() / 1000) - paidAt > APPLIED_CLEAR_WINDOW_SECONDS
  ) {
    return keepCancelDate("kept_stale", subscriptionId, { ...seen, paidAt });
  }

  const cleared = await stripe.subscriptions.update(
    subscriptionId,
    { ...cancellationRevert(cancellation), metadata: nextRevision(live.metadata) },
    {
      // Klucz z subskrypcji, faktury, której zapłata zastosowała zmianę,
      // zdejmowanej daty, jej `canceled_at` i licznika operacji, który jedzie
      // w parametrach (`nextRevision`) - ponowienie zdarzenia trafia w tę samą
      // operację, a inna operacja w międzyczasie nie zostawia klucza
      // z innymi parametrami (odmowa operatora do wygaśnięcia klucza).
      idempotencyKey: await idempotencyKey("cancel-at-clear-applied", [
        subscriptionId,
        invoiceId,
        cancellation.at,
        live.canceled_at,
        revisionOf(live.metadata),
      ]),
    },
  );
  if (scheduledCancellation(cleared)) {
    return keepCancelDate("kept_unverified", subscriptionId, {
      ...seen,
      after: { cancelAtPeriodEnd: cleared.cancel_at_period_end, cancelAt: cleared.cancel_at },
    });
  }
  warnIfPeriodExtended(subscriptionId, live, cleared);
  return "cleared";
}

// --- przeniesienie na cenę katalogu (cennik v6.2) ----------------------------
//
// Obecni subskrybenci Członka, Członka Pro i Zespołu przechodzą na NIŻSZĄ cenę
// v6.2 od najbliższego odnowienia (decyzja właściciela 18.10.2026). Reguły
// „czy i na co" są czyste (`subscriptionRepricing.ts`); tu zapada odczyt
// żywego stanu i JEDNO wywołanie mutujące u operatora:
//
//   * bez harmonogramu - pozycja subskrypcji dostaje nową cenę z
//     `proration_behavior: "none"`: cykl ten sam, więc okres i kotwica
//     rozliczeń zostają, nie powstaje faktura ani płatność, a nowa kwota
//     wchodzi od następnej faktury (także pierwszej po trialu);
//   * z WŁASNYM harmonogramem (zaplanowany downgrade, zmniejszenie miejsc) -
//     przepisujemy jego fazy. Następna faza wskazuje STARĄ cenę (np. dawny
//     Członek za 59 zł), więc samo przepięcie pozycji nic by nie dało:
//     odnowienie poszłoby fazą harmonogramu po starej kwocie. Gdy zmiana
//     już weszła (bieżąca faza jest ostatnia), harmonogram dalej wisi do
//     końca fazy - przepisujemy wtedy samą bieżącą fazę na nową cenę,
//     bo po jej końcu subskrypcja odnowi się po cenie pozycji.
//
// Harmonogram OBCY (panel operatora, portal klienta) nie jest nasz do
// przepisywania - decyzja `schedule_foreign`, obsługa ręczna.

/** Metadane subskrypcji: kampania, która przepięła cenę (ślad u operatora). */
const REPRICED_KEY = "nes_repriced";

const PRICE_INTERVALS = new Set<PriceShape["interval"]>(["day", "week", "month", "year"]);

/**
 * Cykl ceny w słowniku reguły. Typy SDK dopuszczają dowolny napis (`OtherString`)
 * - nieznany cykl schodzi na „month" z krotnością 0, czyli na cykl, który
 * nie pasuje do żadnej ceny katalogu (`cycle_mismatch`), zamiast zgadywać.
 */
function shapeCycle(recurring: Stripe.Price.Recurring | null): {
  interval: PriceShape["interval"];
  intervalCount: number;
} {
  const interval = recurring?.interval as PriceShape["interval"] | undefined;
  if (!recurring || !interval || !PRICE_INTERVALS.has(interval)) {
    return { interval: "month", intervalCount: 0 };
  }
  return { interval, intervalCount: recurring.interval_count ?? 1 };
}

/** Cena operatora sprowadzona do kształtu, z którego reguła liczy kwotę i cykl. */
function priceShapeOf(price: Stripe.Price): PriceShape {
  const recurring = price.recurring;
  const tiered = price.billing_scheme === "tiered";
  // Literały wprost: porównanie z `OtherString` z SDK nie zawęża typu.
  const mode: PriceShape["tiersMode"] =
    price.tiers_mode === "volume"
      ? "volume"
      : price.tiers_mode === "graduated"
        ? "graduated"
        : null;
  return {
    id: price.id,
    currency: price.currency ?? "",
    ...shapeCycle(recurring),
    // Cena jednorazowa nie ma cyklu (krotność 0 w `shapeCycle`), a bez
    // `unit_amount` jej kwota i tak wychodzi jako niepoliczalna.
    unitAmount: recurring && !tiered ? (price.unit_amount ?? null) : null,
    tiersMode: tiered ? mode : null,
    tiers: tiered
      ? (price.tiers ?? []).map((tier) => ({
          upTo: tier.up_to ?? null,
          unitAmount: tier.unit_amount ?? null,
          flatAmount: tier.flat_amount ?? null,
        }))
      : null,
  };
}

/**
 * Cena z progami. `tiers` operator zwraca wyłącznie po rozwinięciu, a w fazie
 * harmonogramu nie da się go rozwinąć (limit czterech poziomów `expand`) -
 * cenę schodkową (Zespół) doczytujemy wtedy osobno, bez niej kwota byłaby
 * niepoliczalna.
 */
async function priceWithTiers(stripe: Stripe, price: unknown): Promise<Stripe.Price | null> {
  if (!price || typeof price !== "object") {
    const id = refOf(price);
    return id ? stripe.prices.retrieve(id, { expand: ["tiers"] }) : null;
  }
  const p = price as Stripe.Price;
  if (p.billing_scheme === "tiered" && !p.tiers) {
    return stripe.prices.retrieve(p.id, { expand: ["tiers"] });
  }
  return p;
}

/**
 * Aktywne ceny katalogu dla podanych `lookup_key` - nowe ceny v6.2 po
 * synchronizacji. Brak ceny = brak klucza w wyniku (`target_price_missing`).
 */
export async function loadRepricingTargets(
  env: StripeEnv,
  lookupKeys: readonly string[],
): Promise<Partial<Record<string, PriceShape>>> {
  const stripe = await getStripeClient(env);
  const out: Partial<Record<string, PriceShape>> = {};
  for (const key of lookupKeys) {
    const res = await stripe.prices.list({
      lookup_keys: [key],
      active: true,
      limit: 1,
      expand: ["data.tiers"],
    });
    const price = res.data[0];
    if (price) out[key] = priceShapeOf(price);
  }
  return out;
}

/** Linia reguły z pozycji operatora (subskrypcji albo fazy). */
function lineOf(price: Stripe.Price, quantity: number | null | undefined): RepriceLine {
  return {
    lookupKey: readableLookupKey(price),
    price: priceShapeOf(price),
    quantity: Math.max(1, quantity ?? 1),
  };
}

/** Własny harmonogram: założony i opisany przez ten moduł (odcisk albo licznik). */
function isOwnSchedule(schedule: Stripe.SubscriptionSchedule): boolean {
  const meta = schedule.metadata ?? {};
  return SCHEDULE_BASIS_KEY in meta || OPS_REVISION_KEY in meta;
}

interface RepricingLiveState {
  sub: Stripe.Subscription;
  input: Omit<RepriceInput, "targets">;
  /** Pozycje fazy wchodzącej przy odnowieniu (z cenami), gdy harmonogram ją ma. */
  nextPhaseItems: Stripe.SubscriptionSchedule.Phase.Item[] | null;
}

/**
 * Żywy stan subskrypcji w kształcie wejścia reguły. Lustro w bazie bywa
 * spóźnione (webhook), więc decyzja zawsze zapada na odczycie od operatora -
 * w podglądzie i ponownie tuż przed mutacją.
 */
async function repricingLiveState(
  stripe: Stripe,
  subscriptionId: string,
): Promise<RepricingLiveState> {
  const sub = await retrieveLive(stripe, subscriptionId, [
    "items.data.price.tiers",
    "schedule.phases.items.price",
  ]);
  const items = sub.items?.data ?? [];
  const lines: RepriceLine[] = [];
  for (const item of items) {
    const price = await priceWithTiers(stripe, item.price);
    if (price) lines.push(lineOf(price, item.quantity));
  }

  let schedule: RepriceInput["schedule"] = null;
  let nextPhaseItems: Stripe.SubscriptionSchedule.Phase.Item[] | null = null;
  const attached = attachedSchedule(sub);
  if (refOf(sub.schedule)) {
    const own = attached ? isOwnSchedule(attached) : false;
    let nextLines: RepriceLine[] | null = null;
    let extraPhases = false;
    const current = attached?.current_phase;
    const phases = attached?.phases ?? [];
    const index = current ? phases.findIndex((p) => p.start_date === current.start_date) : -1;
    const next = index >= 0 ? phases[index + 1] : undefined;
    // Bieżąca faza jest OSTATNIA: zaplanowany downgrade albo zmniejszenie
    // miejsc już weszło, a harmonogram wisi do jej końca (operator odłącza go
    // dopiero po ostatniej fazie). Odnowienie pójdzie wtedy po cenie pozycji
    // subskrypcji - regułę liczymy z niej, nie z nieistniejącej fazy następnej.
    const finalPhase = own && index >= 0 && next === undefined;
    if (own && next?.items?.length) {
      extraPhases = phases.length > index + 2;
      nextLines = [];
      for (const phaseItem of next.items) {
        const price = await priceWithTiers(stripe, phaseItem.price);
        if (!price) {
          nextLines = null;
          break;
        }
        nextLines.push(lineOf(price, phaseItem.quantity));
      }
      nextPhaseItems = nextLines ? next.items : null;
    }
    schedule = {
      own,
      nextLines,
      extraPhases,
      finalPhase,
      endBehavior: attached?.end_behavior ?? null,
    };
  }

  return {
    sub,
    nextPhaseItems,
    input: {
      status: sub.status,
      pauseCollection: !!sub.pause_collection,
      pendingUpdate: !!sub.pending_update,
      items: lines.length === items.length ? lines : [],
      schedule,
      cancelScheduled: scheduledCancellation(sub) !== null,
      trialEnd: sub.trial_end ?? null,
      periodEnd: items[0]?.current_period_end ?? null,
    },
  };
}

/**
 * Podgląd przeniesienia - odczyt żywego stanu i decyzja, BEZ mutacji.
 */
export async function inspectSubscriptionRepricing(
  env: StripeEnv,
  subscriptionId: string,
  targets: Partial<Record<string, PriceShape>>,
): Promise<SubscriptionOpResult<{ decision: RepriceDecision }>> {
  let stripe: Stripe | null = null;
  try {
    stripe = await getStripeClient(env);
    const live = await repricingLiveState(stripe, subscriptionId);
    return { ok: true, decision: repriceDecision({ ...live.input, targets }) };
  } catch (e) {
    return failureOf(null, subscriptionId, e);
  }
}

/**
 * Przeniesienie subskrypcji na aktualną cenę katalogu od najbliższej faktury.
 *
 * Decyzję liczymy JESZCZE RAZ na stanie odczytanym tuż przed mutacją - podgląd
 * mógł być sprzed minuty, a klient w międzyczasie zmienić plan albo anulować.
 * Wynik `skip` nie dotyka operatora.
 *
 * IDEMPOTENCJA: klucz z odcisku żywego stanu i ceny docelowej. Dwuklik albo
 * ponowienie sieciowe dostaje zapamiętaną odpowiedź; po udanej zmianie odcisk
 * jest inny, a reguła i tak zwraca wtedy `already_current`.
 */
export async function repriceSubscriptionToCatalog(
  env: StripeEnv,
  subscriptionId: string,
  params: { targets: Partial<Record<string, PriceShape>>; campaign: string },
): Promise<SubscriptionOpResult<{ decision: RepriceDecision }>> {
  let stripe: Stripe | null = null;
  try {
    stripe = await getStripeClient(env);
    const live = await repricingLiveState(stripe, subscriptionId);
    const decision = repriceDecision({ ...live.input, targets: params.targets });
    if (decision.action !== "apply" || !decision.toPriceId) return { ok: true, decision };
    const { sub } = live;

    if (decision.mode === "item") {
      const item = sub.items.data[0];
      if (!item?.id) return { ok: false, error: "no_subscription_item" };
      await stripe.subscriptions.update(
        subscriptionId,
        {
          items: [{ id: item.id, price: decision.toPriceId, quantity: decision.quantity }],
          proration_behavior: "none",
          metadata: { ...nextRevision(sub.metadata), [REPRICED_KEY]: params.campaign },
        },
        {
          idempotencyKey: await idempotencyKey("reprice", [
            ...stateFingerprint(subscriptionId, sub),
            decision.toPriceId,
            params.campaign,
          ]),
        },
      );
      return { ok: true, decision };
    }

    await repriceOwnSchedule(stripe, subscriptionId, live, params.targets, params.campaign);
    return { ok: true, decision };
  } catch (e) {
    return failureOf(null, subscriptionId, e);
  }
}

/**
 * Pozycja fazy po przeniesieniu. Rabat pozycji przenosimy także na NOWĄ cenę
 * tego samego produktu - to wyjątek wobec `phaseItem`, świadomy: cena katalogu
 * po synchronizacji wisi na tym samym produkcie (`lovable_external_id`), więc
 * kupon ograniczony do produktu nadal pasuje, a zgubienie go podniosłoby
 * klientowi cenę zamiast ją obniżyć.
 */
function repricedPhaseItem(
  price: string,
  quantity: number | undefined,
  source: Stripe.SubscriptionItem | undefined,
  sourcePriceAfter: string | null,
): PhaseItemParams {
  const item: PhaseItemParams = { price, quantity };
  const taxRates = idsOf(source?.tax_rates);
  if (taxRates.length > 0) item.tax_rates = taxRates;
  const discounts = source && sourcePriceAfter === price ? idsOf(source.discounts) : [];
  if (discounts.length > 0) item.discounts = discounts.map((discount) => ({ discount }));
  return item;
}

/**
 * Przepisanie faz WŁASNEGO harmonogramu: bieżąca i następna faza (albo sama
 * bieżąca, gdy jest ostatnia) dostają
 * nowe ceny tam, gdzie pozwala reguła (`linePriceTarget`); data przejścia
 * (koniec bieżącego okresu) i warunki rozliczenia (rabat, podatek, trial)
 * zostają. Fazy zapisujemy w kształcie, w jakim zakłada je
 * `scheduleFromNextPeriod`: następna faza otwarta, `end_behavior: release`.
 * To jest bezpieczne WYŁĄCZNIE dlatego, że reguła wpuszcza tu tylko
 * harmonogram z `end_behavior: release` i bez zaplanowanego końca
 * subskrypcji (`cancel_scheduled` / `schedule_foreign` w `repriceDecision`) -
 * inaczej zapis odwołałby rezygnację klienta. Bieżąca faza zmienia się
 * z `proration_behavior: "none"`, więc subskrypcja od razu wskazuje aktualny
 * obiekt ceny bez faktury proporcjonalnej. Odcisk `nes_basis` opisuje pozycje
 * PO zapisie - od nich webhook rozpozna później nasz harmonogram; znacznik
 * kampanii (`nes_repriced`) zostaje na harmonogramie jak na subskrypcji
 * w trybie pozycji.
 */
async function repriceOwnSchedule(
  stripe: Stripe,
  subscriptionId: string,
  live: RepricingLiveState,
  targets: Partial<Record<string, PriceShape>>,
  campaign: string,
): Promise<void> {
  const { sub, input, nextPhaseItems } = live;
  const schedule = attachedSchedule(sub);
  const scheduleId = refOf(sub.schedule);
  const nextLines = input.schedule?.nextLines;
  const finalPhase = input.schedule?.finalPhase === true;
  if (!schedule || !scheduleId || (!finalPhase && (!nextPhaseItems || !nextLines))) {
    throw new Error("schedule_unreadable");
  }
  const items = sub.items.data;
  const fingerprint = stateFingerprint(subscriptionId, sub);
  const periodEnd = items[0]?.current_period_end ?? 0;
  const terms = carriedPhaseTerms(sub);
  const phaseStart = schedule.current_phase?.start_date ?? items[0]?.current_period_start ?? 0;

  const currentAfter = items.map(
    (item, index) => linePriceTarget(input.items[index], targets)?.id ?? refOf(item.price) ?? "",
  );
  const currentLines: PhaseLine[] = items.map((item, index) => ({
    price: currentAfter[index],
    quantity: Math.max(1, item.quantity ?? 1),
  }));

  // Ostatnia faza kończy się tam, gdzie zapisał ją operator (domyślnie jedna
  // iteracja ceny - koniec bieżącego okresu); tej daty nie przesuwamy.
  const currentEnd = finalPhase ? (schedule.current_phase?.end_date ?? periodEnd) : periodEnd;
  const phases: PhaseParams[] = [
    {
      items: items.map((item, index) =>
        repricedPhaseItem(currentAfter[index], item.quantity, item, currentAfter[index]),
      ),
      start_date: phaseStart,
      end_date: currentEnd,
      ...terms,
      ...trialTerms(sub, currentEnd),
    },
  ];
  // Bez fazy następnej (bieżąca jest ostatnia) zapisujemy WYŁĄCZNIE bieżącą
  // fazę: nowa cena wchodzi na pozycję od razu (`proration_behavior: none`),
  // a po końcu fazy harmonogram się zwalnia i subskrypcja odnawia się po
  // nowej cenie pozycji - nie po starej, zarchiwizowanej.
  if (!finalPhase && nextPhaseItems && nextLines) {
    phases.push({
      items: nextPhaseItems.map((phaseItem, index) => {
        const price =
          linePriceTarget(nextLines[index], targets)?.id ?? refOf(phaseItem.price) ?? "";
        return repricedPhaseItem(
          price,
          phaseItem.quantity ?? 1,
          items[index],
          currentAfter[index] ?? null,
        );
      }),
      ...terms,
    });
  }

  await stripe.subscriptionSchedules.update(
    scheduleId,
    {
      end_behavior: "release",
      phases,
      proration_behavior: "none",
      metadata: {
        ...nextRevision(schedule.metadata),
        [SCHEDULE_BASIS_KEY]: await basisOfLines(currentLines),
        [REPRICED_KEY]: campaign,
      },
    },
    {
      idempotencyKey: await idempotencyKey("reprice-schedule", [
        scheduleId,
        revisionOf(schedule.metadata),
        ...fingerprint,
        JSON.stringify(phases),
      ]),
    },
  );
}

// --- kwota, którą operator FAKTYCZNIE pobierze (maile, profil) ---------------
//
// Cennik w `access_plans` to cena NOWEGO zakupu. Trwająca subskrypcja odnawia
// się po obiekcie ceny, na którym jest u operatora - po v6.2 do akcji admina
// (a u pominiętych na stałe) to stara, zarchiwizowana cena 59/590, 129/1290
// albo 99 zł. Kwota w przypomnieniu o odnowieniu (cron) i na karcie w profilu
// pochodzi więc z ŻYWEJ subskrypcji, a gdy jej nie da się ustalić
// jednoznacznie - nie ma jej wcale. Zła kwota w komunikacji z konsumentem
// jest gorsza niż brak kwoty. (Maile z webhooka biorą kwotę z ładunku
// zdarzenia - `stripeEvents.server`, bez dodatkowego odczytu.)

/** Kwota w groszach z walutą ISO (wielkie litery). */
export interface ProviderCharge {
  amountCents: number;
  currency: string;
}

/**
 * Kwota pozycji, po której subskrypcja odnowi się przy najbliższej fakturze:
 * cena pozycji × ilość (z progiem wolumenowym), przed rabatem i podatkiem -
 * ta sama konwencja co „Cena" w mailach i cena planu na karcie.
 *
 * `null`, gdy kwoty nie da się podać uczciwie: harmonogram (odnowienie może
 * pójść inną pozycją - zaplanowany downgrade, zmniejszenie miejsc), więcej
 * niż jedna pozycja, cena bez cyklu albo niepoliczalna, błąd odczytu.
 * Nigdy nie rzuca - wołają ją maile i karta profilu, dla których brak kwoty
 * jest bezpiecznym zachowaniem.
 */
export async function renewalListCharge(
  env: StripeEnv,
  subscriptionId: string,
): Promise<ProviderCharge | null> {
  // Identyfikator spoza operatora (atrapa, import) - nie ma czego pytać.
  if (!isProviderSubscriptionRef(subscriptionId)) return null;
  try {
    const stripe = await getStripeClient(env);
    const sub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price.tiers"],
    });
    if (refOf(sub.schedule)) return null;
    const items = sub.items?.data ?? [];
    if (items.length !== 1) return null;
    const price = await priceWithTiers(stripe, items[0].price);
    if (!price?.recurring) return null;
    const amount = amountForQuantity(priceShapeOf(price), items[0].quantity ?? 1);
    if (amount === null) return null;
    return { amountCents: amount, currency: (price.currency ?? "").toUpperCase() };
  } catch (e) {
    console.warn("[billing] renewal charge unavailable", subscriptionId, getStripeErrorMessage(e));
    return null;
  }
}
