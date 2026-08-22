// Bilet wliczony w plan - kontrakty i CZYSTE reguły (moduł bezpieczny dla
// przeglądarki, bez importów serwerowych).
//
// Katalog członkostw v6.1 sprzedaje od progu Członek „1 wliczony bilet rocznie
// na wydarzenie biletowane", a stawkom ulgowym daje w zamian zniżkę 50%.
// Autorytetem jest baza (`my_ticket_allowance`, `claim_included_event_ticket`);
// ten moduł tłumaczy jej odpowiedź na decyzję interfejsu i liczy kwotę, którą
// pokaże kasa - te same reguły po obu stronach, jeden test.
//
// GRANICA: nic tutaj nie DECYDUJE o dostępie. Bramkę trzyma `rsvp_event`
// (migracja 20260822091000): wydarzenie z ceną wymaga opłaconego zamówienia
// albo biletu z puli, a pulę konsumuje wyłącznie RPC SECURITY DEFINER.

/** Skąd pochodzi pula: własna, wspólna organizacji, albo jej brak. */
export type TicketAllowanceScope = "personal" | "organisation" | "none";

/** Odpowiedź RPC `my_ticket_allowance`, po zawężeniu z `Json`. */
export interface TicketAllowance {
  /** Ile biletów przysługuje w bieżącym roku członkowskim. */
  granted: number;
  used: number;
  remaining: number;
  /** Zniżka procentowa zamiast biletu (stawki studencka i akademicka: 50). */
  discountPct: number;
  scope: TicketAllowanceScope;
  /** Organizacja, z której puli liczy się bilet (`scope === "organisation"`). */
  orgId: string | null;
  /** Rok członkowski - okno rocznicowe, nie kalendarzowe. */
  periodStart: string | null;
  periodEnd: string | null;
}

export const EMPTY_TICKET_ALLOWANCE: TicketAllowance = {
  granted: 0,
  used: 0,
  remaining: 0,
  discountPct: 0,
  scope: "none",
  orgId: null,
  periodStart: null,
  periodEnd: null,
};

function int(source: Record<string, unknown>, key: string): number {
  const raw = source[key];
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function text(source: Record<string, unknown>, key: string): string | null {
  const raw = source[key];
  return typeof raw === "string" && raw.trim() ? raw : null;
}

/**
 * Zawężenie `Json` z RPC. Kształt nietypowy (tablica, liczba, null) degraduje
 * się do pustej puli zamiast wywalać widok wydarzenia - bilet jest benefitem,
 * a nie warunkiem wyświetlenia strony.
 */
export function parseTicketAllowance(payload: unknown): TicketAllowance {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return EMPTY_TICKET_ALLOWANCE;
  }
  const row = payload as Record<string, unknown>;
  const scopeRaw = text(row, "scope");
  const scope: TicketAllowanceScope =
    scopeRaw === "personal" || scopeRaw === "organisation" ? scopeRaw : "none";
  const granted = int(row, "granted");
  const used = int(row, "used");
  return {
    granted,
    used,
    remaining: Math.max(0, granted - used),
    discountPct: Math.min(100, int(row, "discount_pct")),
    scope,
    orgId: text(row, "org_id"),
    periodStart: text(row, "period_start"),
    periodEnd: text(row, "period_end"),
  };
}

/** Czy członek może wejść na wydarzenie biletowane bez płacenia. */
export function coversTicket(allowance: TicketAllowance): boolean {
  return allowance.remaining > 0;
}

/**
 * Cena biletu po uwzględnieniu benefitów planu.
 *
 * Kolejność jest regułą, nie przypadkiem: bilet wliczony BIJE zniżkę. Gdyby
 * ktoś miał oba (członek, który dokupił stawkę akademicką), naliczenie zniżki
 * od zera dawałoby zero, ale spalałoby bilet - a bilet jest wart więcej.
 *
 * Zaokrąglenie w DÓŁ do pełnego grosza na korzyść kupującego: 50% z 29 999
 * groszy to 14 999, nie 15 000. Różnica jest groszowa, kierunek nie jest.
 */
export function ticketAmountCents(faceValueCents: number, allowance: TicketAllowance): number {
  if (!Number.isFinite(faceValueCents) || faceValueCents <= 0) return 0;
  const face = Math.round(faceValueCents);
  if (coversTicket(allowance)) return 0;
  const pct = Math.min(100, Math.max(0, allowance.discountPct));
  if (pct <= 0) return face;
  return Math.max(0, Math.floor((face * (100 - pct)) / 100));
}

/** Co pokazać przy przycisku zakupu biletu. */
export type TicketOffer =
  /** Wydarzenie bezpłatne - kasa nie jest potrzebna. */
  | { kind: "free" }
  /** Bilet pokryty pulą planu; `remaining` po tej rejestracji. */
  | { kind: "included"; remainingAfter: number; scope: TicketAllowanceScope }
  /** Zniżka planu; kwoty w groszach. */
  | { kind: "discounted"; amountCents: number; faceValueCents: number; discountPct: number }
  /** Pełna cena katalogowa. */
  | { kind: "full"; amountCents: number };

/**
 * Jedna decyzja o tym, co widzi kupujący - żeby karta wydarzenia, kasa
 * i podsumowanie zamówienia nie rozjechały się co do grosza ani co do słowa.
 */
export function ticketOffer(
  faceValueCents: number | null | undefined,
  allowance: TicketAllowance,
): TicketOffer {
  const face = Number(faceValueCents ?? 0);
  if (!Number.isFinite(face) || face <= 0) return { kind: "free" };
  if (coversTicket(allowance)) {
    return {
      kind: "included",
      remainingAfter: Math.max(0, allowance.remaining - 1),
      scope: allowance.scope,
    };
  }
  const amountCents = ticketAmountCents(face, allowance);
  if (amountCents < face) {
    return {
      kind: "discounted",
      amountCents,
      faceValueCents: Math.round(face),
      discountPct: Math.min(100, Math.max(0, allowance.discountPct)),
    };
  }
  return { kind: "full", amountCents: Math.round(face) };
}
