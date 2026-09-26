// Wycena WEJŚCIÓWKI Z CENNIKA WYDARZENIA - jedna dla kasy i dla podglądu.
//
// PO CO OSOBNY MODUŁ. Do tej pory tę wycenę znał wyłącznie `createCheckoutOrder`,
// więc JEDYNYM miejscem, w którym kupujący widział „3 × 100 zł, kod −20 zł od
// każdego miejsca", była nakładka Stripe. Ekran potwierdzenia pokazywał cenę
// JEDNEGO miejsca bez kodu - i właściciel czytał to jako „kod schodzi raz".
// Podgląd (`quoteEventTicketCheckout`) i kasa liczą teraz TĄ SAMĄ funkcją, więc
// liczba na ekranie i liczba na paragonie nie mogą się rozjechać.
//
// KOLEJNOŚĆ WYWOŁAŃ JEST KONTRAKTEM: kontekst zgłoszenia (własność), wycena
// bazy, pula planu, opcje biletu (podatek), liczba miejsc, bilet z puli
// (tylko kasa), kod. Zgłoszenie sprawdzamy PRZED cennikiem, żeby błędne
// wskazanie nie dotykało wyceny.
//
// BENEFIT PLANU MA JEDNO MIEJSCE: CZŁONKA. Cena miejsca po benefitach
// (`ticketPriceForCaller`: zniżka stawki ulgowej albo bilet z puli) dotyczy
// wyłącznie miejsca, którego osobą jest wołający - goście płacą cenę
// z cennika (faza sprzedaży). Do 20260926140000 kasa mnożyła cenę członka
// przez liczbę miejsc: zniżka -50% schodziła z każdego gościa, a bilet z puli
// zerował całe zamówienie i kończył się odmową `ticket_included_in_plan` -
// członek nie mógł zapłacić za swoich gości wcale. Zgłoszenie GOŚCIA
// opłacane przez prowadzącego (`holder_is_caller = false`) benefitu nie ma.
//
// BILET Z PULI SCHODZI Z PULI. Miejsce prowadzącego pokryte biletem z planu
// kasa zajmuje w puli (`event_registration_claim_plan_seat`) PRZED
// założeniem zamówienia; gdy pula go nie odda (pusta, wyścig dwóch kas),
// prowadzący płaci jak gość. Podgląd kasy puli NIE rusza - pokazuje stan
// z `my_ticket_allowance`.
//
// LICZBA MIEJSC JEST FAIL-CLOSED. Błąd `event_registration_group_seats` dawał
// dotąd po cichu JEDNO miejsce - grupa płaciła za prowadzącego, kod schodził
// raz, a trigger płatności i tak oznaczał wszystkich gości jako opłaconych.
// Teraz to odmowa z nazwą, którą ekran mapuje na zdanie.
//
// Moduł server-only: woła RPC klientem Z SESJĄ wołającego (RLS i `auth.uid()`),
// nigdy rolą serwisową.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { groupCouponDiscount } from "@/lib/events/groupOrderPricing";
import { ticketAmountCents } from "@/lib/events/ticketAllowance";
import type { TicketTaxMode } from "@/lib/events/ticketTaxGroup";

type Client = SupabaseClient<Database>;

/** Odmowa, gdy baza nie umie policzyć miejsc zamówienia grupowego. */
export const SEATS_UNAVAILABLE = "registration_not_payable:seats_unavailable";

/** Minimalna kwota obciążenia po kodzie (50 gr) - poniżej kod jest odmową. */
export const MIN_TICKET_TOTAL_CENTS = 50;

const NO_TICKET_TYPE = "00000000-0000-0000-0000-000000000000";

export interface EventTicketPriceInput {
  eventId: string;
  ticketTypeId: string;
  /** Zgłoszenie etapu 4, za które płacimy (`null` = kasa bez zgłoszenia). */
  registrationId: string | null;
  /** Kod z zaproszenia; pusty napis znaczy „brak klucza". */
  accessCode?: string;
  /**
   * Zajmij w puli planu bilet pokrywający miejsce prowadzącego. Wyłącznie kasa
   * (`createCheckoutOrder`) - podgląd pyta bazę na sucho, niczego nie zużywa.
   */
  claimPlanSeat?: boolean;
}

/** Benefit planu na miejscu wołającego: bilet z puli albo zniżka ceny. */
export type EventTicketPlanBenefit = "included" | "discount";

export interface EventTicketPrice {
  /** Miejsca opłacane jednym zamówieniem (prowadzący + goście), co najmniej 1. */
  seats: number;
  /**
   * Cena JEDNEGO miejsca gościa: cennik po fazie sprzedaży, BEZ benefitu planu
   * (ten należy wyłącznie do członka - `leadUnitCents`).
   */
  unitCents: number;
  /**
   * Cena miejsca prowadzącego (osoby zgłoszenia): z benefitem planu, gdy tą
   * osobą jest wołający; inaczej równa `unitCents`. Przy bilecie z puli - 0.
   */
  leadUnitCents: number;
  /** Benefit na miejscu prowadzącego albo `null` (brak, miejsce nie wołającego). */
  planBenefit: EventTicketPlanBenefit | null;
  /** Cena regularna jednego miejsca (0, gdy baza jej nie podała). */
  unitListCents: number;
  /** Kwota całego zamówienia przed kodem: `leadUnitCents + unitCents × (seats − 1)`. */
  amountCents: number;
  /** Cena regularna całego zamówienia: `unitListCents × seats`. */
  listCents: number;
  currency: string;
  /** Nazwa pozycji BEZ sufiksu „× N" - dokleja go wołający. */
  label: string;
  /** Etykieta aktywnej fazy sprzedaży (pusta poza promocją). */
  phaseLabel: string;
  taxMode: TicketTaxMode | null;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
  }
  return "";
}

/**
 * Cena wejściówki dla wołającego i liczba miejsc zamówienia. RZUCA tymi samymi
 * kodami co dotąd kasa (`registration_not_payable:*`, `ticket_not_available`,
 * `ticket_included_in_plan`, komunikat błędu RPC), bo te kody mapuje ekran.
 */
export async function priceEventTicket(
  supabase: Client,
  input: EventTicketPriceInput,
): Promise<EventTicketPrice> {
  // Kasa bez zgłoszenia kupuje miejsce WOŁAJĄCEGO - benefit mu przysługuje.
  let holderIsCaller = true;
  // ZGŁOSZENIE, ZA KTÓRE PŁACIMY. Autorytetem jest baza: RLS
  // `event_registrations` jest zamknięte dla uczestnika, a rzutowanie odczytu
  // na `service_role` oddałoby serwerowi aplikacji prawo czytania CUDZYCH
  // zgłoszeń.
  if (input.registrationId !== null) {
    const { data: ctx, error: ctxErr } = await supabase.rpc("event_registration_payment_context", {
      p_registration_id: input.registrationId,
    });
    if (ctxErr) throw new Error(ctxErr.message);
    const parsedCtx = objectOf(ctx);
    if (parsedCtx === null || parsedCtx.ok !== true) {
      const reason =
        parsedCtx !== null && typeof parsedCtx.reason === "string" ? parsedCtx.reason : "not_found";
      throw new Error(`registration_not_payable:${reason}`);
    }
    // Zgłoszenie MUSI dotyczyć wydarzenia i wejściówki z żądania - inaczej
    // wpłata dowiązałaby się do wiersza, którego kupujący nie wskazał.
    if (parsedCtx.event_id !== input.eventId) {
      throw new Error("registration_not_payable:event_mismatch");
    }
    if (
      typeof parsedCtx.ticket_type_id === "string" &&
      parsedCtx.ticket_type_id !== input.ticketTypeId
    ) {
      throw new Error("registration_not_payable:ticket_mismatch");
    }
    // Tylko jawne `false` odbiera benefit: baza sprzed 20260926140000 pola nie
    // zna, a jej odpowiedź nadal dotyczy zwykle miejsca samego wołającego.
    holderIsCaller = parsedCtx.holder_is_caller !== false;
  }

  // CENNIK WYDARZENIA. Kwotę, okno sprzedaży, miejsca, rangę członkostwa i kod
  // dostępu rozstrzyga JEDNA funkcja bazy - ta sama, z której czyta publiczna
  // karta biletu.
  const { data: quote, error: quoteErr } = await supabase.rpc("event_ticket_checkout_quote", {
    p_ticket_type_id: input.ticketTypeId,
    // `undefined` = brak klucza w żądaniu; RPC ma wtedy własny default.
    p_access_code: input.accessCode === "" ? undefined : input.accessCode,
  });
  if (quoteErr) throw new Error(quoteErr.message);
  const parsed = objectOf(quote);
  if (parsed === null) throw new Error("ticket_not_available");
  // Bilet MUSI należeć do wydarzenia wskazanego przez klienta - inaczej webhook
  // potwierdziłby RSVP na innym wydarzeniu niż opłacone.
  if (typeof parsed.event_id !== "string" || parsed.event_id !== input.eventId) {
    throw new Error("ticket_not_available");
  }
  const quotedAmount =
    typeof parsed.amount_cents === "number" ? Math.trunc(parsed.amount_cents) : 0;
  // BENEFIT PLANU - tylko na miejscu wołającego (patrz nagłówek). Cena gościa
  // to cena z cennika.
  let leadUnitCents = quotedAmount;
  // Cena członka BEZ biletu z puli (sama zniżka stawki) - obowiązuje, gdy
  // pula nie pokryje miejsca prowadzącego w zamówieniu z gośćmi.
  let leadPaidCents = quotedAmount;
  // Plan z pulą biletów (przyznane > 0). O tym, czy pula pokryje miejsce
  // prowadzącego, rozstrzyga baza niżej - sam stan puli tego nie wie: po
  // pierwszej kasie bilet jest ZUŻYTY dla tego wydarzenia, a ponowna kasa
  // zobaczyłaby pustą pulę.
  let poolPlan = false;
  if (holderIsCaller) {
    const { ticketPriceForCaller } = await import("@/lib/events/ticketAllowance.server");
    const leadPrice = await ticketPriceForCaller(supabase, quotedAmount);
    leadUnitCents = leadPrice.amountCents;
    leadPaidCents = ticketAmountCents(quotedAmount, { ...leadPrice.allowance, remaining: 0 });
    poolPlan = quotedAmount > 0 && leadPrice.allowance.granted > 0;
  }
  let leadFromPool = false;

  const eventTitle = firstText(parsed.event_title_pl, parsed.event_title_en);
  const ticketName = firstText(parsed.name_pl, parsed.name_en);
  const phase = objectOf(parsed.phase);
  const phaseSource = typeof phase?.source === "string" ? phase.source : "";
  const phaseLabel =
    firstText(phase?.label_pl, phase?.label_en) ||
    (phaseSource === "early_bird"
      ? "Early bird"
      : phaseSource === "last_minute"
        ? "Last minute"
        : phaseSource === "phase"
          ? "Faza sprzedaży"
          : "");

  // PODATEK. Tryb (wliczony/doliczany) pochodzi z biletu; stawkę liczy Stripe.
  const { data: opts } = await supabase.rpc("event_ticket_public_options", {
    p_ticket_type_id: input.ticketTypeId,
  });
  const mode = objectOf(opts)?.tax_mode;
  const taxMode: TicketTaxMode | null = mode === "inclusive" || mode === "exclusive" ? mode : null;

  // GRUPA. Rejestracja grupowa płaci jednym zamówieniem za prowadzącego
  // i wszystkich nieopłaconych gości - liczbę miejsc zna tylko baza.
  let seats = 1;
  if (input.registrationId !== null) {
    const { data: seatsRaw, error: seatsErr } = await supabase.rpc(
      "event_registration_group_seats",
      { p_registration_id: input.registrationId },
    );
    if (seatsErr) {
      console.error("[checkout] group seats failed", input.registrationId, seatsErr.message);
      throw new Error(SEATS_UNAVAILABLE);
    }
    // Funkcja oddaje `1 + goście` - cokolwiek innego to nieczytelna odpowiedź,
    // a nie zgoda na jedno miejsce.
    if (typeof seatsRaw !== "number" || !Number.isInteger(seatsRaw) || seatsRaw < 1) {
      throw new Error(SEATS_UNAVAILABLE);
    }
    seats = seatsRaw;

    // BILET Z PULI dla miejsca prowadzącego w zamówieniu z gośćmi. Kasa go
    // zajmuje, podgląd pyta tę samą funkcję na sucho - obie widzą bilet już
    // zajęty dla tego wydarzenia (ponowna kasa) i bilet wolny w puli. Odmowa
    // puli (albo awaria RPC) nie przerywa zakupu gości: prowadzący płaci wtedy
    // cenę miejsca, a nie dostaje go za darmo bez zdjęcia biletu z puli.
    if (poolPlan && seats > 1) {
      const { data: claim, error: claimErr } = await supabase.rpc(
        "event_registration_claim_plan_seat",
        { p_registration_id: input.registrationId, p_dry_run: input.claimPlanSeat !== true },
      );
      if (claimErr) {
        console.error("[checkout] plan seat claim failed", input.registrationId, claimErr.message);
      }
      const claimRow = objectOf(claim);
      leadFromPool = !claimErr && claimRow !== null && claimRow.claimed === true;
      leadUnitCents = leadFromPool ? 0 : leadPaidCents;
    }
  }

  // Pojedyncze miejsce pokryte pulą (albo bilet za zero) - nie ma czego
  // obciążyć. Ścieżka „za darmo" to `rsvp_event`, więc kasa odsyła, zamiast
  // zakładać zamówienie na zero złotych.
  const amountCents = leadUnitCents + quotedAmount * (seats - 1);
  if (amountCents <= 0) throw new Error("ticket_included_in_plan");
  const planBenefit: EventTicketPlanBenefit | null = leadFromPool
    ? "included"
    : leadUnitCents < quotedAmount
      ? "discount"
      : null;

  const unitListCents =
    typeof parsed.list_price_cents === "number" ? Math.trunc(parsed.list_price_cents) : 0;
  return {
    seats,
    unitCents: quotedAmount,
    leadUnitCents,
    planBenefit,
    unitListCents,
    amountCents,
    listCents: unitListCents * seats,
    currency: typeof parsed.currency === "string" ? parsed.currency : "PLN",
    label: ticketName === "" ? eventTitle : `${eventTitle} - ${ticketName}`,
    phaseLabel,
    taxMode,
  };
}

export interface EventTicketCouponInput {
  /** Kod już znormalizowany (trim + wielkie litery). */
  code: string;
  eventId: string;
  /** `null` = bilet z wiersza wydarzenia, bez pozycji cennika. */
  ticketTypeId: string | null;
  /** Kwota CAŁEGO zamówienia przed kodem. */
  amountCents: number;
  currency: string;
  seats: number;
  /**
   * Cena miejsca prowadzącego przed kodem, gdy różni się od miejsc gości
   * (benefit planu). Brak = wszystkie miejsca po tej samej cenie.
   */
  leadCents?: number;
}

export type EventTicketCouponResult =
  | {
      ok: true;
      couponId: string;
      /** `fixed` albo `percent` - inne wartości bazy traktujemy jak procent. */
      kind: "fixed" | "percent";
      percent: number | null;
      /** Rabat na CAŁE zamówienie (dla kodu kwotowego: kwota × miejsca). */
      discountCents: number;
      /** Kwota do zapłaty po kodzie. */
      finalCents: number;
      /**
       * Rabat na jedno miejsce - tylko dla kodu kwotowego, gdy KAŻDE miejsce
       * dostało ten sam (miejsce prowadzącego tańsze od kodu - `null`).
       */
      perSeatCents: number | null;
    }
  | { ok: false; error: string };

/**
 * Kod rabatowy na bilet wydarzenia: zakres wydarzenia i biletu sprawdza baza
 * (`validate_event_ticket_coupon`), rozbicie kodu kwotowego na miejsca -
 * `groupCouponDiscount`. NIE rezerwuje użycia: robi to kasa po założeniu
 * zamówienia (`redeem_b2b_coupon`), a podgląd nie robi tego nigdy.
 */
export async function applyEventTicketCoupon(
  supabase: Client,
  input: EventTicketCouponInput,
): Promise<EventTicketCouponResult> {
  const { data: rows, error } = await supabase.rpc("validate_event_ticket_coupon", {
    _code: input.code,
    _event_id: input.eventId,
    _ticket_type_id: input.ticketTypeId ?? NO_TICKET_TYPE,
    _amount_cents: input.amountCents,
    _currency: input.currency,
  });
  if (error) throw error;
  const row = (rows ?? [])[0];
  if (!row || !row.ok) return { ok: false, error: row?.error ?? "not_found" };
  // Zamówienie grupowe: kod kwotowy zdejmuje swoją kwotę z KAŻDEGO miejsca
  // (baza policzyła ją raz, od sumy). Procentowy przechodzi bez zmian.
  const split = groupCouponDiscount({
    kind: row.discount_kind,
    discountCents: row.discount_cents,
    finalCents: row.final_cents,
    totalCents: input.amountCents,
    seats: input.seats,
    leadCents: input.leadCents,
  });
  // Bezpiecznik: rabat 100% (final=0) traktujemy jak darmowy przydział - i tak
  // nie przejdzie minimalnej kwoty transakcji, więc odrzucamy < 50 gr.
  if (split.finalCents < MIN_TICKET_TOTAL_CENTS)
    return { ok: false, error: "final_amount_too_low" };
  const kind = row.discount_kind === "fixed" ? "fixed" : "percent";
  return {
    ok: true,
    couponId: row.coupon_id,
    kind,
    percent:
      kind === "percent" && typeof row.discount_percent === "number" ? row.discount_percent : null,
    discountCents: split.discountCents,
    finalCents: split.finalCents,
    perSeatCents: split.perSeatCents,
  };
}

export interface EventTicketQuoteInput extends EventTicketPriceInput {
  couponCode?: string;
}

/** Podgląd kasy: to samo, co zobaczy nakładka Stripe, zanim się otworzy. */
export interface EventTicketQuote {
  seats: number;
  /** Cena jednego miejsca gościa przed kodem (cennik, bez benefitu planu). */
  unitCents: number;
  /** Cena miejsca prowadzącego przed kodem - z benefitem planu wołającego. */
  leadUnitCents: number;
  /** Benefit planu na miejscu prowadzącego (`null` = brak). */
  planBenefit: EventTicketPlanBenefit | null;
  /** Suma przed kodem: `leadUnitCents + unitCents × (seats − 1)`. */
  subtotalCents: number;
  currency: string;
  /** Kod przyjęty przez bazę albo `null` (brak kodu albo odmowa). */
  coupon: {
    code: string;
    kind: "fixed" | "percent";
    percent: number | null;
    perSeatCents: number | null;
  } | null;
  /** Rabat kodu na całe zamówienie (0 bez kodu). */
  discountCents: number;
  totalCents: number;
  /** Powód odmowy kodu (`validate_event_ticket_coupon`) albo `null`. */
  couponError: string | null;
  /**
   * Tryb podatku biletu. Przy `exclusive` Stripe DOLICZA podatek do kwoty
   * sesji, więc „Do zapłaty" bez dopisku byłoby mniejsze niż obciążenie -
   * ekran pokazuje wtedy „+ podatek", tak jak karta biletu w formularzu.
   */
  taxMode: TicketTaxMode | null;
}

/**
 * Wycena do pokazania PRZED kasą. Odmowa KODU nie jest błędem wyceny: ekran
 * dostaje sumę bez kodu i powód odmowy, żeby pokazać go od razu, a nie dopiero
 * po otwarciu kasy. Pozostałe odmowy (zgłoszenie, bilet, miejsca) RZUCAJĄ -
 * dokładnie tak, jak rzuciłaby kasa.
 */
export async function quoteEventTicketOrder(
  supabase: Client,
  input: EventTicketQuoteInput,
): Promise<EventTicketQuote> {
  const price = await priceEventTicket(supabase, input);
  const base: EventTicketQuote = {
    seats: price.seats,
    unitCents: price.unitCents,
    leadUnitCents: price.leadUnitCents,
    planBenefit: price.planBenefit,
    subtotalCents: price.amountCents,
    currency: price.currency,
    coupon: null,
    discountCents: 0,
    totalCents: price.amountCents,
    couponError: null,
    taxMode: price.taxMode,
  };
  const code = (input.couponCode ?? "").trim().toUpperCase();
  if (code === "") return base;
  const applied = await applyEventTicketCoupon(supabase, {
    code,
    eventId: input.eventId,
    ticketTypeId: input.ticketTypeId,
    amountCents: price.amountCents,
    currency: price.currency,
    seats: price.seats,
    leadCents: price.leadUnitCents,
  });
  if (!applied.ok) return { ...base, couponError: applied.error };
  return {
    ...base,
    coupon: {
      code,
      kind: applied.kind,
      percent: applied.percent,
      perSeatCents: applied.perSeatCents,
    },
    discountCents: applied.discountCents,
    totalCents: applied.finalCents,
  };
}
