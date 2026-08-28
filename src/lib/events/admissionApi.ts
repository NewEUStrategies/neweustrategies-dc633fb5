// ZAKUP PAKIETU GRUPOWEGO OCZAMI KUPUJACEGO.
//
// DWIE WYCENY MAJA DWA ZADANIA. `event_ticket_checkout_quote` liczy KOSZYK
// (wiele pozycji, jedna platnosc); `event_admission_quote` odpowiada na cztery
// pytania JEDNEGO ekranu zakupu: czy wolno kupic, po ile, ile miejsc zostalo i
// czy kod rabatowy w ogole tu dziala. Ta druga jest tez zrodlem prawdy dla
// `event_package_purchase`, ktora przelicza cene po swojemu - klient nie
// dyktuje kwoty.
//
// POWOD ODMOWY NIE JEST WYJATKIEM. Wycena zwraca `{ ok: false, reason }`, bo
// „jeszcze nie w sprzedazy" albo „stawka wymaga potwierdzenia" to normalny stan
// ekranu, a nie awaria - zdanie dla czlowieka sklada `admissionQuoteMessageKey`.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];

export type EventPackageOfferRow = Fns["event_packages_offer"]["Returns"][number];
export type MyPackageOrderRow = Fns["event_my_package_orders"]["Returns"][number];
export type MyPackageSeatRow = Fns["event_my_package_seats"]["Returns"][number];

/** Powody odmowy, ktore `event_admission_quote` zna po nazwie. */
export const ADMISSION_QUOTE_REASONS = [
  "sign_in_required",
  "not_found",
  "inactive",
  "sales_not_open",
  "sales_closed",
  "sold_out",
  "tier_required",
  "audience_not_verified",
  "per_person_limit",
  "coupon_unknown",
  "coupon_not_yet_valid",
  "coupon_expired",
  "coupon_exhausted",
  "coupon_used_by_you",
  "coupon_other_event",
  "coupon_other_ticket_type",
  "coupon_other_package",
  "coupon_other_currency",
] as const;
export type AdmissionQuoteReason = (typeof ADMISSION_QUOTE_REASONS)[number];

export interface AdmissionQuoteOk {
  ok: true;
  kind: "ticket" | "package";
  eventId: string;
  audience: string;
  seats: number;
  currency: string;
  priceCents: number;
  discountCents: number;
  totalCents: number;
  couponCode: string | null;
  /** `null` = bez limitu zestawow. */
  seatsLeft: number | null;
}

export interface AdmissionQuoteRefused {
  ok: false;
  reason: AdmissionQuoteReason | "unknown";
  /** Liczby z odmowy, ktore wchodza do zdania (limit, wymagany poziom). */
  detail: Record<string, number | string>;
}

export type AdmissionQuote = AdmissionQuoteOk | AdmissionQuoteRefused;

export interface AdmissionQuoteInput {
  /** Dokladnie jedno z dwoch - baza odrzuca oba naraz. */
  ticketTypeId?: string;
  packageId?: string;
  couponCode?: string;
}

function record(value: Json | null): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function reasonOf(value: unknown): AdmissionQuoteReason | "unknown" {
  const raw = text(value);
  return ADMISSION_QUOTE_REASONS.find((known) => known === raw) ?? "unknown";
}

export function parseAdmissionQuote(value: Json | null): AdmissionQuote {
  const row = record(value);
  if (row.ok !== true) {
    const detail: Record<string, number | string> = {};
    for (const key of ["min_tier_rank", "max_per_person", "owned", "audience", "sales_from"]) {
      const item = row[key];
      if (typeof item === "number" || typeof item === "string") detail[key] = item;
    }
    return { ok: false, reason: reasonOf(row.reason), detail };
  }
  const seatsLeft = row.seats_left;
  return {
    ok: true,
    kind: text(row.kind) === "package" ? "package" : "ticket",
    eventId: text(row.event_id),
    audience: text(row.audience),
    seats: num(row.seats, 1),
    currency: text(row.currency) || "PLN",
    priceCents: num(row.price_cents),
    discountCents: num(row.discount_cents),
    totalCents: num(row.total_cents),
    couponCode: typeof row.coupon_code === "string" ? row.coupon_code : null,
    seatsLeft: seatsLeft === null || seatsLeft === undefined ? null : num(seatsLeft),
  };
}

/** Klucz i18n zdania dla odmowy - jeden zbior nazw po obu stronach. */
export function admissionQuoteMessageKey(reason: AdmissionQuoteReason | "unknown"): string {
  return `eventPackages.quoteReasons.${reason}`;
}

export async function quoteAdmission(input: AdmissionQuoteInput): Promise<AdmissionQuote> {
  const payload: Record<string, Json> = {};
  if (input.ticketTypeId !== undefined) payload.ticket_type_id = input.ticketTypeId;
  if (input.packageId !== undefined) payload.package_id = input.packageId;
  const code = (input.couponCode ?? "").trim();
  if (code !== "") payload.coupon_code = code;

  const { data, error } = await supabase.rpc("event_admission_quote", { p_payload: payload });
  if (error) throw error;
  return parseAdmissionQuote(data);
}

/** Czy WOLAJACY kwalifikuje sie do stawki danej grupy odbiorcow. */
export async function audienceQualifies(audience: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("event_audience_qualifies", { p_audience: audience });
  if (error) throw error;
  return data === true;
}

export async function fetchPackagesOffer(slug: string): Promise<EventPackageOfferRow[]> {
  const { data, error } = await supabase.rpc("event_packages_offer", { p_slug: slug });
  if (error) throw error;
  return data ?? [];
}

export interface PackagePurchaseInput {
  packageId: string;
  buyerName: string;
  buyerEmail: string;
  companyId: string | null;
  invoiceNote: string;
  couponCode: string;
}

export interface PackagePurchaseResult {
  orderId: string;
  seats: number;
  currency: string;
  totalCents: number;
  discountCents: number;
  status: string;
}

export async function purchasePackage(
  input: PackagePurchaseInput,
): Promise<PackagePurchaseResult> {
  const payload: Record<string, Json> = { package_id: input.packageId };
  if (input.buyerName.trim() !== "") payload.buyer_name = input.buyerName.trim();
  if (input.buyerEmail.trim() !== "") payload.buyer_email = input.buyerEmail.trim();
  if (input.companyId !== null) payload.company_id = input.companyId;
  if (input.invoiceNote.trim() !== "") payload.invoice_note = input.invoiceNote.trim();
  if (input.couponCode.trim() !== "") payload.coupon_code = input.couponCode.trim();

  const { data, error } = await supabase.rpc("event_package_purchase", { p_payload: payload });
  if (error) throw error;
  const row = record(data);
  return {
    orderId: text(row.order_id),
    seats: num(row.seats),
    currency: text(row.currency) || "PLN",
    totalCents: num(row.total_cents),
    discountCents: num(row.discount_cents),
    status: text(row.status) || "pending",
  };
}

export async function fetchMyPackageOrders(): Promise<MyPackageOrderRow[]> {
  const { data, error } = await supabase.rpc("event_my_package_orders");
  if (error) throw error;
  return data ?? [];
}

export async function fetchMyPackageSeats(orderId: string): Promise<MyPackageSeatRow[]> {
  const { data, error } = await supabase.rpc("event_my_package_seats", { p_order_id: orderId });
  if (error) throw error;
  return data ?? [];
}

export interface BuyerSeatInviteInput {
  orderId: string;
  email: string;
  name: string;
  expiresInDays: number;
}

export interface BuyerSeatInvite {
  seatId: string;
  /** Token JAWNY - wraca RAZ, w bazie zostaje sam skrot. */
  inviteToken: string;
  expiresAt: string | null;
}

/**
 * Zaproszenie wystawia KUPUJACY, nie organizator - dlatego
 * `event_package_seat_invite`, a nie `admin_event_package_seat_invite`.
 */
export async function inviteMyPackageSeat(
  input: BuyerSeatInviteInput,
): Promise<BuyerSeatInvite> {
  const { data, error } = await supabase.rpc("event_package_seat_invite", {
    p_payload: {
      package_order_id: input.orderId,
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      expires_in_days: input.expiresInDays,
    },
  });
  if (error) throw error;
  const row = record(data);
  return {
    seatId: text(row.seat_id),
    inviteToken: text(row.token),
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
  };
}
