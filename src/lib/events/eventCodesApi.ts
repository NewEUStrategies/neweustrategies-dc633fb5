// Kody rejestracyjne wydarzenia (Swapcard „Registration codes").
//
// Kod żyje w `b2b_coupons` z zakresem `event_ids = [eventId]`. Dzięki temu
// ten sam licznik użyć, limit per osoba i atomowe `redeem_b2b_coupon` działają
// dla biletów, a rabat trafia do Stripe z `createCheckoutOrder`
// (validate_event_ticket_coupon -> kupon Stripe na różnicę ceny).
// Zapis bezpośredni: RLS `b2b_coupons_staff_all` wpuszcza tylko admin/editor,
// a `tenant_id` wypełnia baza.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeCouponCode } from "@/lib/billing/coupons";

export type EventCodeDiscountKind = "percent" | "fixed";

export interface EventCodeRow {
  id: string;
  code: string;
  name: string | null;
  description: string | null;
  active: boolean;
  appliesDiscount: boolean;
  revealsHidden: boolean;
  discountKind: EventCodeDiscountKind;
  discountPercent: number | null;
  discountCents: number | null;
  currency: string | null;
  maxRedemptions: number | null;
  redemptionsCount: number;
  validFrom: string | null;
  validUntil: string | null;
  ticketTypeIds: string[];
}

export interface EventCodeDraft {
  code: string;
  name: string;
  description: string;
  validFrom: string;
  validUntil: string;
  quantity: string;
  appliesDiscount: boolean;
  discountKind: EventCodeDiscountKind;
  amount: string;
  currency: string;
  revealsHidden: boolean;
  ticketScope: "all" | "specific";
  ticketTypeIds: string[];
}

export const emptyEventCodeDraft = (currency: string): EventCodeDraft => ({
  code: "",
  name: "",
  description: "",
  validFrom: "",
  validUntil: "",
  quantity: "",
  appliesDiscount: true,
  discountKind: "percent",
  amount: "",
  currency,
  revealsHidden: false,
  ticketScope: "all",
  ticketTypeIds: [],
});

export type EventCodeIssue =
  "code" | "noEffect" | "percent" | "amount" | "quantity" | "dates" | "tickets";

function parseAmount(raw: string): number {
  const n = Number(raw.replace(",", ".").trim());
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Pierwszy błąd szkicu albo `null`. Czysta funkcja - testowana osobno. */
export function eventCodeDraftIssue(d: EventCodeDraft): EventCodeIssue | null {
  if (normalizeCouponCode(d.code).length === 0) return "code";
  if (!d.appliesDiscount && !d.revealsHidden) return "noEffect";
  if (d.appliesDiscount) {
    const a = parseAmount(d.amount);
    if (d.discountKind === "percent" && !(Number.isInteger(a) && a >= 1 && a <= 100))
      return "percent";
    if (d.discountKind === "fixed" && !(a > 0)) return "amount";
  }
  if (d.quantity.trim() !== "") {
    const q = Number(d.quantity);
    if (!Number.isInteger(q) || q < 1) return "quantity";
  }
  if (d.validFrom && d.validUntil && new Date(d.validFrom) >= new Date(d.validUntil))
    return "dates";
  if (d.ticketScope === "specific" && d.ticketTypeIds.length === 0) return "tickets";
  return null;
}

export function eventCodeDraftToPayload(eventId: string, d: EventCodeDraft) {
  const a = parseAmount(d.amount);
  const percent = d.appliesDiscount && d.discountKind === "percent";
  const fixed = d.appliesDiscount && d.discountKind === "fixed";
  return {
    code: normalizeCouponCode(d.code),
    name: d.name.trim() || null,
    description: d.description.trim() || null,
    applies_discount: d.appliesDiscount,
    reveals_hidden: d.revealsHidden,
    discount_kind: d.discountKind,
    discount_percent: percent ? a : null,
    discount_cents: fixed ? Math.round(a * 100) : null,
    currency: fixed ? d.currency.toUpperCase() : null,
    max_redemptions: d.quantity.trim() ? Number(d.quantity) : null,
    valid_from: d.validFrom ? new Date(d.validFrom).toISOString() : null,
    valid_until: d.validUntil ? new Date(d.validUntil).toISOString() : null,
    event_ids: [eventId],
    ticket_type_ids: d.ticketScope === "specific" ? d.ticketTypeIds : [],
  };
}

export function eventCodeRowToDraft(r: EventCodeRow): EventCodeDraft {
  const local = (iso: string | null) => (iso ? iso.slice(0, 16) : "");
  return {
    code: r.code,
    name: r.name ?? "",
    description: r.description ?? "",
    validFrom: local(r.validFrom),
    validUntil: local(r.validUntil),
    quantity: r.maxRedemptions === null ? "" : String(r.maxRedemptions),
    appliesDiscount: r.appliesDiscount,
    discountKind: r.discountKind,
    amount:
      r.discountKind === "percent"
        ? String(r.discountPercent ?? "")
        : r.discountCents === null
          ? ""
          : (r.discountCents / 100).toFixed(2),
    currency: r.currency ?? "PLN",
    revealsHidden: r.revealsHidden,
    ticketScope: r.ticketTypeIds.length > 0 ? "specific" : "all",
    ticketTypeIds: r.ticketTypeIds,
  };
}

export type EventCodeStatus = "active" | "scheduled" | "expired" | "used_up" | "inactive";

export function eventCodeStatus(r: EventCodeRow, now: Date = new Date()): EventCodeStatus {
  if (!r.active) return "inactive";
  if (r.maxRedemptions !== null && r.redemptionsCount >= r.maxRedemptions) return "used_up";
  if (r.validUntil && new Date(r.validUntil) < now) return "expired";
  if (r.validFrom && new Date(r.validFrom) > now) return "scheduled";
  return "active";
}

/** Link rejestracyjny z kodem - formularz odsłania bilety i podstawia kod. */
export function eventCodeRegistrationUrl(origin: string, slug: string, code: string): string {
  return `${origin}/events/${slug}/register?code=${encodeURIComponent(code)}`;
}

const COLUMNS =
  "id, code, name, description, active, applies_discount, reveals_hidden, discount_kind, discount_percent, discount_cents, currency, max_redemptions, redemptions_count, valid_from, valid_until, ticket_type_ids";

export async function fetchEventCodes(eventId: string): Promise<EventCodeRow[]> {
  const { data, error } = await supabase
    .from("b2b_coupons")
    .select(COLUMNS)
    .contains("event_ids", [eventId])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    active: r.active,
    appliesDiscount: r.applies_discount,
    revealsHidden: r.reveals_hidden,
    discountKind: r.discount_kind === "fixed" ? "fixed" : "percent",
    discountPercent: r.discount_percent,
    discountCents: r.discount_cents,
    currency: r.currency,
    maxRedemptions: r.max_redemptions,
    redemptionsCount: r.redemptions_count,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    ticketTypeIds: r.ticket_type_ids,
  }));
}

const key = (eventId: string) => ["admin", "event-codes", eventId] as const;

export function useEventCodes(eventId: string) {
  return useQuery({ queryKey: key(eventId), queryFn: () => fetchEventCodes(eventId) });
}

export function useSaveEventCode(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string | null; draft: EventCodeDraft }) => {
      const payload = eventCodeDraftToPayload(eventId, args.draft);
      const { error } = args.id
        ? await supabase.from("b2b_coupons").update(payload).eq("id", args.id)
        : await supabase.from("b2b_coupons").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(eventId) }),
  });
}

export function useToggleEventCode(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from("b2b_coupons")
        .update({ active: args.active })
        .eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(eventId) }),
  });
}

export function useDeleteEventCode(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("b2b_coupons").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(eventId) }),
  });
}

/** Publiczne: identyfikatory ukrytych biletów odsłanianych przez kod. */
export async function fetchRevealedTickets(eventId: string, code: string): Promise<string[]> {
  const norm = normalizeCouponCode(code);
  if (!norm) return [];
  const { data, error } = await supabase.rpc("event_coupon_revealed_tickets", {
    p_event_id: eventId,
    p_code: norm,
  });
  if (error) return [];
  return data ?? [];
}
