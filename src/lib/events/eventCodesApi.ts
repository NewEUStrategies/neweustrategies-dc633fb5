// Kody rejestracyjne wydarzenia (Swapcard „Registration codes").
//
// Kod żyje w `b2b_coupons` z zakresem `event_ids = [eventId]`. Dzięki temu
// ten sam licznik użyć, limit per osoba i atomowe `redeem_b2b_coupon` działają
// dla biletów, a rabat trafia do Stripe z `createCheckoutOrder`
// (validate_event_ticket_coupon -> kupon Stripe na różnicę ceny).
// Zapis bezpośredni: RLS `b2b_coupons_staff_all` wpuszcza tylko admin/editor,
// a `tenant_id` wypełnia baza.
//
// Moduł jest PANELEM ORGANIZATORA. Publiczne odsłonięcie biletów kodem stoi
// osobno (`eventCodeReveal.functions.ts`): idzie przez serwer z limitem prób,
// a import funkcji serwerowej stąd wciągałby ją do paczki panelu.
//
// OKNO WAŻNOŚCI W CZASIE LOKALNYM (TIX-10). Pole `datetime-local` mówi czasem
// przeglądarki, a baza trzyma chwilę w UTC. Szkic dostawał dotąd pierwsze 16
// znaków napisu UTC, a zapis czytał je jako czas lokalny - w Polsce latem
// każda edycja przesuwała `valid_from` i `valid_until` o 2 godziny wstecz.
// Konwersja idzie teraz przez `toLocalInput` / `fromLocalInput` - tę samą
// parę, której używa okno biletu.
//
// KUMULACJA RABATÓW (TIX-13a, migracja 20261012130000). Kod niesie dwie
// reguły: `stacks_with_promotions` (czy łączy się z fazą sprzedaży i benefitem
// planu) i `max_total_discount_percent` (górny limit ŁĄCZNEGO rabatu). Baza
// bez tych kolumn (kod przed migracją) oddaje listę bez reguł - wtedy panel
// ich nie pokazuje i NIE wysyła, żeby zapis nie padł na nieznanej kolumnie.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeCouponCode } from "@/lib/billing/coupons";
import { fromLocalInput, toLocalInput } from "@/lib/events/ticketDraft";

/** „Baza nie zna jeszcze tej kolumny" - okno wdrożenia kodu przed migracją. */
const COLUMN_PENDING_CODES: ReadonlySet<string> = new Set(["42703", "PGRST204"]);

export type EventCodeDiscountKind = "percent" | "fixed";

/** Reguła kumulacji kodu z innymi promocjami biletu (TIX-13a). */
export interface EventCodeStacking {
  /** `false` - przy aktywnej fazie sprzedaży albo beneficie planu kasa odmawia kodu. */
  stacksWithPromotions: boolean;
  /** Górny limit łącznego rabatu w % ceny regularnej; `null` = bez limitu. */
  maxTotalDiscountPercent: number | null;
}

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
  /** `null` = baza bez kolumn reguły (migracja w drodze). */
  stacking: EventCodeStacking | null;
}

/** Lista kodów i to, czy baza zna już reguły kumulacji. */
export interface EventCodeList {
  rows: EventCodeRow[];
  stackingAvailable: boolean;
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
  /** `null` = baza bez kolumn reguły - pola nie ma w oknie ani w zapisie. */
  stacking: { stacksWithPromotions: boolean; maxTotalDiscountPercent: string } | null;
}

/** Domyślna reguła kodu = zachowanie sprzed TIX-13a: łączy się, bez limitu. */
const DEFAULT_STACKING_DRAFT = { stacksWithPromotions: true, maxTotalDiscountPercent: "" };

export const emptyEventCodeDraft = (
  currency: string,
  stackingAvailable = true,
): EventCodeDraft => ({
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
  stacking: stackingAvailable ? DEFAULT_STACKING_DRAFT : null,
});

export type EventCodeIssue =
  "code" | "noEffect" | "percent" | "amount" | "quantity" | "dates" | "tickets" | "maxTotal";

/** Limit łącznego rabatu: puste (bez limitu) albo liczba całkowita 1-100. */
function parseMaxTotal(raw: string): number | null | "invalid" {
  const text = raw.trim();
  if (text === "") return null;
  if (!/^\d{1,3}$/.test(text)) return "invalid";
  const value = Number(text);
  return value >= 1 && value <= 100 ? value : "invalid";
}

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
  const from = fromLocalInput(d.validFrom);
  const until = fromLocalInput(d.validUntil);
  if (from !== null && until !== null && new Date(from) >= new Date(until)) return "dates";
  if (d.ticketScope === "specific" && d.ticketTypeIds.length === 0) return "tickets";
  if (d.stacking !== null && parseMaxTotal(d.stacking.maxTotalDiscountPercent) === "invalid")
    return "maxTotal";
  return null;
}

export function eventCodeDraftToPayload(eventId: string, d: EventCodeDraft) {
  const a = parseAmount(d.amount);
  const percent = d.appliesDiscount && d.discountKind === "percent";
  const fixed = d.appliesDiscount && d.discountKind === "fixed";
  const maxTotal = d.stacking === null ? null : parseMaxTotal(d.stacking.maxTotalDiscountPercent);
  // Reguła kumulacji jedzie tylko do bazy, która ją zna - i wtedy ZAWSZE w
  // całości, także z wartościami domyślnymi: powrót do „łączy się, bez
  // limitu" na edytowanym kodzie musi nadpisać poprzednią regułę.
  const stacking: { stacks_with_promotions?: boolean; max_total_discount_percent?: number | null } =
    d.stacking === null
      ? {}
      : {
          stacks_with_promotions: d.stacking.stacksWithPromotions,
          max_total_discount_percent: maxTotal === "invalid" ? null : maxTotal,
        };
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
    valid_from: fromLocalInput(d.validFrom),
    valid_until: fromLocalInput(d.validUntil),
    event_ids: [eventId],
    ticket_type_ids: d.ticketScope === "specific" ? d.ticketTypeIds : [],
    ...stacking,
  };
}

export function eventCodeRowToDraft(r: EventCodeRow): EventCodeDraft {
  return {
    code: r.code,
    name: r.name ?? "",
    description: r.description ?? "",
    validFrom: toLocalInput(r.validFrom),
    validUntil: toLocalInput(r.validUntil),
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
    stacking:
      r.stacking === null
        ? null
        : {
            stacksWithPromotions: r.stacking.stacksWithPromotions,
            maxTotalDiscountPercent:
              r.stacking.maxTotalDiscountPercent === null
                ? ""
                : String(r.stacking.maxTotalDiscountPercent),
          },
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

/** Lista z kolumnami reguły kumulacji (20261012130000) - patrz nagłówek. */
const COLUMNS_WITH_STACKING =
  `${COLUMNS}, stacks_with_promotions, max_total_discount_percent` as const;

type CodeListRow = {
  id: string;
  code: string;
  name: string | null;
  description: string | null;
  active: boolean;
  applies_discount: boolean;
  reveals_hidden: boolean;
  discount_kind: string;
  discount_percent: number | null;
  discount_cents: number | null;
  currency: string | null;
  max_redemptions: number | null;
  redemptions_count: number;
  valid_from: string | null;
  valid_until: string | null;
  ticket_type_ids: string[];
  stacks_with_promotions?: boolean | null;
  max_total_discount_percent?: number | null;
};

function stackingOf(r: CodeListRow): EventCodeStacking {
  const cap = r.max_total_discount_percent;
  return {
    stacksWithPromotions: r.stacks_with_promotions !== false,
    maxTotalDiscountPercent:
      typeof cap === "number" && Number.isInteger(cap) && cap >= 1 && cap <= 100 ? cap : null,
  };
}

/**
 * Jedno zapytanie z regułami kumulacji. Baza bez tych kolumn (kod przed
 * migracją) odpowiada 42703 - wtedy drugie zapytanie bez nich, a lista mówi
 * `stackingAvailable: false`. Każdy inny błąd RZUCA.
 */
async function selectCodes(
  eventId: string,
  withStacking: boolean,
): Promise<{ data: CodeListRow[] | null; error: { code?: string } | null }> {
  if (withStacking) {
    const { data, error } = await supabase
      .from("b2b_coupons")
      .select(COLUMNS_WITH_STACKING)
      .contains("event_ids", [eventId])
      .order("created_at", { ascending: false });
    return { data, error };
  }
  const { data, error } = await supabase
    .from("b2b_coupons")
    .select(COLUMNS)
    .contains("event_ids", [eventId])
    .order("created_at", { ascending: false });
  return { data, error };
}

export async function fetchEventCodes(eventId: string): Promise<EventCodeList> {
  let stackingAvailable = true;
  let result = await selectCodes(eventId, true);
  if (result.error !== null && COLUMN_PENDING_CODES.has(String(result.error.code ?? ""))) {
    stackingAvailable = false;
    result = await selectCodes(eventId, false);
  }
  if (result.error !== null) throw result.error;
  const rows = (result.data ?? []).map((r): EventCodeRow => ({
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
    stacking: stackingAvailable ? stackingOf(r) : null,
  }));
  return { rows, stackingAvailable };
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
