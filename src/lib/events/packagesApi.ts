// Dostep panelu organizatora do PAKIETOW GRUPOWYCH wydarzenia.
//
// PAKIET NIE JEST BILETEM. Bilet kupuje uczestnik dla siebie; pakiet kupuje
// JEDEN platnik (firma, uczelnia, delegacja) i dopiero potem rozdaje miejsca
// imiennie. Dlatego lancuch ma trzy poziomy - pakiet (oferta), zamowienie
// (platnik i pula miejsc), miejsce (zaproszenie albo gotowy zapis) - i kazdy
// z nich ma wlasne RPC.
//
// TOKEN ZAPROSZENIA WRACA RAZ. `admin_event_package_seat_invite` oddaje kod
// jawny wylacznie w odpowiedzi; w bazie zostaje sam skrot SHA-256. Kto go nie
// skopiuje w tej chwili, musi wystawic zaproszenie ponownie - i tak ma byc,
// bo token jest kluczem do zapisu na cudze nazwisko.
//
// TYPY WIERSZY WYPROWADZAMY Z `Database`, payloady sa jsonb - dokladnie te same
// zasady, co w `registrationsApi.ts`.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];

export type EventPackageRow = Fns["admin_event_packages_list"]["Returns"][number];
export type EventPackageOrderRow = Fns["admin_event_package_orders_list"]["Returns"][number];
export type EventPackageSeatRow = Fns["admin_event_package_seats_list"]["Returns"][number];

/** Odbiorca pakietu - odwzorowanie CHECK-a `audience` jeden do jednego. */
export const PACKAGE_AUDIENCES = ["company", "university", "delegation", "partner"] as const;
export type PackageAudience = (typeof PACKAGE_AUDIENCES)[number];

/** Stany zamowienia pakietu - CHECK `event_package_orders_status_values`. */
export const PACKAGE_ORDER_STATUSES = ["pending", "paid", "cancelled"] as const;
export type PackageOrderStatus = (typeof PACKAGE_ORDER_STATUSES)[number];

/** Stany miejsca w zamowieniu - wyliczane przez `admin_event_package_seats_list`. */
export const PACKAGE_SEAT_STATES = ["free", "invited", "assigned", "revoked"] as const;
export type PackageSeatState = (typeof PACKAGE_SEAT_STATES)[number];

function payload(input: Record<string, Json | undefined>): Json {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// PAKIETY
// ---------------------------------------------------------------------------

export async function fetchEventPackages(eventId: string): Promise<EventPackageRow[]> {
  const { data, error } = await supabase.rpc("admin_event_packages_list", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return data ?? [];
}

export interface EventPackageInput {
  /** `null` = nowy pakiet; wtedy `key` i `ticketTypeId` sa obowiazkowe. */
  id: string | null;
  eventId: string;
  key: string;
  ticketTypeId: string;
  namePl: string;
  nameEn: string;
  descriptionPl: string;
  descriptionEn: string;
  audience: PackageAudience;
  /** Liczba miejsc, ktore daje JEDEN zakup pakietu. */
  seats: number;
  priceCents: number;
  currency: string;
  /** `null` = bez limitu sprzedanych pakietow. */
  quota: number | null;
  salesFrom: string | null;
  salesTo: string | null;
  minTierRank: number;
  requiresVerification: boolean;
  isActive: boolean;
  sortOrder: number;
}

export async function saveEventPackage(input: EventPackageInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_package_upsert", {
    p_payload: payload({
      id: input.id,
      // Klucz i wydarzenie sa niezmienne po zapisie - patrz `saveEventTicket`.
      event_id: input.id === null ? input.eventId : undefined,
      key: input.id === null ? input.key : undefined,
      ticket_type_id: input.ticketTypeId,
      name_pl: input.namePl,
      name_en: input.nameEn,
      description_pl: input.descriptionPl,
      description_en: input.descriptionEn,
      audience: input.audience,
      seats: input.seats,
      price_cents: input.priceCents,
      currency: input.currency,
      quota: input.quota,
      sales_from: input.salesFrom,
      sales_to: input.salesTo,
      min_tier_rank: input.minTierRank,
      requires_verification: input.requiresVerification,
      is_active: input.isActive,
      sort_order: input.sortOrder,
    }),
  });
  if (error) throw error;
  return String(data);
}

export async function deleteEventPackage(id: string): Promise<boolean> {
  const { error } = await supabase.rpc("admin_event_package_delete", { _id: id });
  if (error) throw error;
  return true;
}

// ---------------------------------------------------------------------------
// ZAMOWIENIA
// ---------------------------------------------------------------------------

export async function fetchPackageOrders(
  eventId: string,
  packageId: string | null,
): Promise<EventPackageOrderRow[]> {
  const { data, error } = await supabase.rpc("admin_event_package_orders_list", {
    p_event_id: eventId,
    ...(packageId === null ? {} : { p_package_id: packageId }),
  });
  if (error) throw error;
  return data ?? [];
}

export interface PackageOrderInput {
  packageId: string;
  buyerEmail: string;
  buyerName: string;
  /** `null` = tyle miejsc, ile daje pakiet. */
  seatsTotal: number | null;
  /** `null` = cena pakietu bez zmian. */
  amountCents: number | null;
  invoiceNote: string;
}

export async function createPackageOrder(input: PackageOrderInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_package_order_create", {
    p_payload: payload({
      package_id: input.packageId,
      buyer_email: input.buyerEmail,
      buyer_name: input.buyerName,
      seats_total: input.seatsTotal,
      amount_cents: input.amountCents,
      invoice_note: input.invoiceNote,
    }),
  });
  if (error) throw error;
  return String(data);
}

export async function setPackageOrderStatus(
  id: string,
  status: PackageOrderStatus,
): Promise<boolean> {
  const { error } = await supabase.rpc("admin_event_package_order_set_status", {
    p_payload: payload({ id, status }),
  });
  if (error) throw error;
  return true;
}

// ---------------------------------------------------------------------------
// MIEJSCA I ZAPROSZENIA
// ---------------------------------------------------------------------------

export async function fetchPackageSeats(orderId: string): Promise<EventPackageSeatRow[]> {
  const { data, error } = await supabase.rpc("admin_event_package_seats_list", {
    p_order_id: orderId,
  });
  if (error) throw error;
  return data ?? [];
}

export interface PackageSeatInviteInput {
  seatId: string;
  inviteEmail: string;
  inviteName: string;
  validDays: number;
}

export interface PackageSeatInvite {
  seatId: string;
  /** Token jawny - jedyny moment, w ktorym istnieje poza glowa zapraszanego. */
  inviteToken: string;
}

export async function invitePackageSeat(
  input: PackageSeatInviteInput,
): Promise<PackageSeatInvite> {
  const { data, error } = await supabase.rpc("admin_event_package_seat_invite", {
    p_payload: payload({
      id: input.seatId,
      invite_email: input.inviteEmail,
      invite_name: input.inviteName,
      valid_days: input.validDays,
    }),
  });
  if (error) throw error;
  const record = (data ?? {}) as Record<string, unknown>;
  return {
    seatId: String(record.seat_id ?? input.seatId),
    inviteToken: String(record.invite_token ?? ""),
  };
}

export async function revokePackageSeat(seatId: string): Promise<boolean> {
  const { error } = await supabase.rpc("admin_event_package_seat_revoke", { _id: seatId });
  if (error) throw error;
  return true;
}

/** Adres, pod ktorym zapraszany domyka swoj zapis. */
export function packageInviteUrl(origin: string, token: string): string {
  return `${origin}/events/invite/${encodeURIComponent(token)}`;
}
