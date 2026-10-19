// KUPONY B2B - odczyty panelu, unieważnianie po mutacji i jedyny pisarz
// statusu kampanii (SPEC §3.2, §3.4; S1 P04, P10).
//
// UNIEWAŻNIANIE. Kupony czytają TRZY rodziny wpisów: lista panelu z katalogami
// planów i warstw (`couponKeys.admin()` - prefiks), kampanie
// (`couponKeys.campaigns()` - wygenerowane kody zmieniają licznik kampanii)
// i analityka kuponów najemcy (`["admin-analytics", <najemca>, "b2b-coupons", …]`),
// która liczy po WSZYSTKICH kuponach najemcy - nowy, skasowany albo
// wygenerowany kod zmienia ranking od razu. Do tego dziedziny huba „Oferta"
// i „Diagnostyka". Ten sam zestaw unieważnia reguła szyny `coupon.changed.v1`
// w innych kartach.
//
// ZAKRES DAT analityki jest nieznany w miejscu mutacji (stan ekranu), więc
// unieważnienie idzie po PREFIKSIE najemcy (`analyticsCouponsPrefixKey`), który
// trafia w każdy zapamiętany zakres - i w nic poza analityką kuponów.
//
// KONWERSJA I PIENIĄDZE (P10, D-S1-08). Dawna „konwersja" liczyła kupony
// z ≥ 1 realizacją - także REZERWACJE bez płatności - a „przychód" dodawał
// grosze PLN do centów EUR. `couponAnalyticsSummaryQueryOptions` liczy
// konwersję z realizacji OPŁACONYCH (efekty kuponu zastosowane, zamówienie
// `live`, nie `mock`), kwoty wyłącznie per waluta, rezerwacje osobno.
import {
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { couponKeys } from "@/lib/admin/couponKeys";
import { analyticsCouponsPrefixKey, analyticsRootKey } from "@/lib/analytics/queryKeys";
import { invalidateKeys, revenueDomainKeys } from "@/lib/billing/planQueries";
import { newsletterKeys } from "@/lib/newsletter/keys";
import type { MoneyByCurrency } from "@/lib/revenue/money";
import type { RevenueDomain } from "@/lib/revenue/keys";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import { useCurrentTenantId } from "@/lib/tenant";

/**
 * Fabryka kluczy kuponów - JEDNA definicja (liść `couponKeys.ts`, który czyta
 * mapa szyny). Dawna stała `ADMIN_COUPONS_KEY` była drugą kopią tego samego
 * napisu; ekrany biorą klucze stąd.
 */
export { couponKeys };

/* ------------------------------------------------------- unieważnianie */

/** Domeny huba z reguły panelu `coupon.changed.v1` / `coupon_campaign.changed.v1`. */
const COUPON_REVENUE_DOMAINS = ["offer", "diagnostics"] as const satisfies readonly RevenueDomain[];

/**
 * Klucze czytelników kuponów: reguła rdzenia `coupon.changed.v1` (lista,
 * kampanie, analityka najemcy) + dziedziny huba.
 *
 * NIEUSTALONY NAJEMCA (`null` - `useCurrentTenantId` jeszcze w drodze) nie
 * jest powodem, żeby analitykę pominąć: zapis już się odbył, tylko nie wiemy,
 * pod którym najemcą leży jego analityka. Wtedy unieważnienie idzie po
 * KORZENIU analityki (i dziedzinach huba u wszystkich najemców) - nadmiarowe,
 * ale tanie (odświeżają się wyłącznie zapytania aktywne), a nigdy fałszywie świeże.
 */
export function couponInvalidationKeys(tenantId: string | null): QueryKey[] {
  return [
    couponKeys.admin(),
    couponKeys.campaigns(),
    tenantId ? analyticsCouponsPrefixKey(tenantId) : analyticsRootKey(),
    ...revenueDomainKeys(COUPON_REVENUE_DOMAINS, tenantId),
  ];
}

/**
 * Unieważnia kupony, kampanie, analitykę kuponów najemcy i dziedziny huba.
 * Obietnica rozstrzyga się po odświeżeniu aktywnych zapytań - `onSuccess`
 * mutacji może ją zwrócić, żeby `isPending` trwało do chwili, w której lista
 * już pokazuje zmianę.
 */
export function invalidateCouponQueries(
  queryClient: QueryClient,
  tenantId: string | null,
): Promise<void> {
  return invalidateKeys(queryClient, couponInvalidationKeys(tenantId));
}

/* ------------------------------------------------------------- odczyty */

type CampaignTable = Database["public"]["Tables"]["b2b_coupon_campaigns"]["Row"];

const CAMPAIGN_SELECT =
  "id, name, prefix, code_count, generated_count, discount_kind, discount_percent, discount_cents, currency, valid_until, grants_tier_key, grants_duration_days, newsletter_segment, newsletter_campaign_id, status, created_at, updated_at" as const;

/** Wiersz listy kampanii - z `updated_at` (token zmiany statusu). */
export type CouponCampaignRow = Pick<
  CampaignTable,
  | "id"
  | "name"
  | "prefix"
  | "code_count"
  | "generated_count"
  | "discount_kind"
  | "discount_percent"
  | "discount_cents"
  | "currency"
  | "valid_until"
  | "grants_tier_key"
  | "grants_duration_days"
  | "newsletter_segment"
  | "newsletter_campaign_id"
  | "status"
  | "created_at"
  | "updated_at"
>;

/** Kampanie kuponowe, najnowsze pierwsze. */
export function couponCampaignsQueryOptions() {
  return queryOptions({
    queryKey: couponKeys.campaigns(),
    staleTime: 30_000,
    queryFn: async (): Promise<CouponCampaignRow[]> => {
      const { data, error } = await supabase
        .from("b2b_coupon_campaigns")
        .select(CAMPAIGN_SELECT)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface CouponTierOption {
  key: string;
  name_pl: string;
  name_en: string;
  active: boolean;
}

/** Aktywne warstwy do formularzy kuponu i kampanii (wg rangi). */
export function couponTiersQueryOptions() {
  return queryOptions({
    queryKey: couponKeys.tiers(),
    staleTime: 60_000,
    queryFn: async (): Promise<CouponTierOption[]> => {
      const { data, error } = await supabase
        .from("membership_tiers")
        .select("key, name_pl, name_en, active")
        .eq("active", true)
        .order("rank", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Sufit odczytu list i sum - powyżej `truncated`, nigdy cicha próbka. */
export const COUPON_READ_LIMIT = 5000;
const PAGE = 1000;

export interface CouponRedemptionRow {
  id: string;
  coupon_id: string;
  user_id: string | null;
  order_id: string | null;
  applied_cents: number;
  original_cents: number;
  currency: string;
  created_at: string;
  effects_applied_at: string | null;
  b2b_coupons: { code: string; name: string | null; grants_tier_key: string | null } | null;
}

export interface CouponRedemptionsWindow {
  rows: CouponRedemptionRow[];
  /** Okno ma więcej realizacji niż `COUPON_READ_LIMIT` - sumy z części okna. */
  truncated: boolean;
}

const REDEMPTION_SELECT =
  "id, coupon_id, user_id, order_id, applied_cents, original_cents, currency, created_at, effects_applied_at, b2b_coupons(code, name, grants_tier_key)" as const;

/**
 * Realizacje z zakresu dat (ISO; `null` = bez granicy), najnowsze pierwsze,
 * stronami po `PAGE` do sufitu - dawny `limit(500)` liczył kafle z próbki,
 * nie mówiąc o tym nikomu.
 */
export function couponRedemptionsQueryOptions(fromIso: string | null, toIso: string | null) {
  return queryOptions({
    queryKey: couponKeys.redemptions(fromIso, toIso),
    staleTime: 30_000,
    queryFn: async (): Promise<CouponRedemptionsWindow> => {
      const rows: CouponRedemptionRow[] = [];
      for (let from = 0; ; from += PAGE) {
        let query = supabase.from("b2b_coupon_redemptions").select(REDEMPTION_SELECT);
        if (fromIso) query = query.gte("created_at", fromIso);
        if (toIso) query = query.lte("created_at", toIso);
        const { data, error } = await query
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as CouponRedemptionRow[];
        rows.push(...page);
        if (page.length < PAGE) return { rows, truncated: false };
        if (rows.length >= COUPON_READ_LIMIT) {
          return { rows: rows.slice(0, COUPON_READ_LIMIT), truncated: true };
        }
      }
    },
  });
}

/* ------------------------------------------- podsumowanie analityki (P10) */

/**
 * Podsumowanie analityki kuponów (D-S1-08).
 *
 * - `issued` - kupony UTWORZONE w oknie (kohorta wydanych),
 * - `issuedConverted` - ile z nich ma ≥ 1 OPŁACONE wykorzystanie (do dziś),
 * - `conversion` - `issuedConverted / issued` (ułamek 0..1); `null` przy zerze
 *   wydanych (brak próby nie jest porażką),
 * - `paidRedemptions` - wykorzystania opłacone w oknie,
 * - `reservedRedemptions` - rezerwacje w oknie (efekty kuponu jeszcze NIE
 *   zastosowane - płatność nie przyszła albo przepadła),
 * - `revenueNet`, `discount` - per waluta, wyłącznie z wykorzystań opłaconych,
 * - `truncated` - sumy z części okna (powyżej `COUPON_READ_LIMIT`).
 *
 * „Opłacone" = `effects_applied_at IS NOT NULL` i zamówienie
 * (`b2b_coupon_redemptions_order_id_fkey`) w środowisku `live`, operator inny
 * niż `mock` - piaskownica i atrapa nie są przychodem.
 *
 * UPRAWNIENIA: zamówienia (`payment_orders`) czyta wyłącznie administrator
 * (RLS `orders owner read`). Redaktor dostałby z tych samych zapytań zera
 * udające wynik, więc ekran pokazuje to podsumowanie tylko administratorowi.
 */
export interface CouponAnalyticsSummary {
  issued: number;
  issuedConverted: number;
  conversion: number | null;
  paidRedemptions: number;
  reservedRedemptions: number;
  revenueNet: MoneyByCurrency[];
  discount: MoneyByCurrency[];
  truncated: boolean;
}

/** Osadzenie zamówienia realizacji - nazwa FK jawnie (tabela ma ich kilka). */
const PAID_ORDER =
  "payment_orders!b2b_coupon_redemptions_order_id_fkey!inner(environment, provider)" as const;

/** Zawęża zapytanie do okna dat (ISO; `null` = bez granicy). */
function windowed<Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(
  query: Q,
  fromIso: string | null,
  toIso: string | null,
): Q {
  let out = query;
  if (fromIso) out = out.gte("created_at", fromIso);
  if (toIso) out = out.lte("created_at", toIso);
  return out;
}

function exactCount(res: { count: number | null; error: unknown }, what: string): number {
  if (res.error) throw res.error;
  // `null` przy `count: "exact"` to brak odpowiedzi, nie zero.
  if (res.count === null) throw new Error(`count_unavailable:${what}`);
  return res.count;
}

/** Suma per waluta; kwota poza zakresem bezpiecznych liczb = błąd, nie zaokrąglenie. */
function addTo(totals: Map<string, number>, currency: string, amount: number): void {
  const code = currency.trim().toUpperCase();
  const sum = (totals.get(code) ?? 0) + amount;
  if (!Number.isSafeInteger(sum)) throw new Error("money_overflow");
  totals.set(code, sum);
}

const asMoney = (totals: Map<string, number>): MoneyByCurrency[] =>
  [...totals].map(([currency, amountMinor]) => ({ currency, amountMinor }));

interface PaidRedemptionAmounts {
  currency: string;
  original_cents: number;
  applied_cents: number;
}

export async function fetchCouponAnalyticsSummary(
  tenantId: string,
  fromIso: string | null,
  toIso: string | null,
): Promise<CouponAnalyticsSummary> {
  // Filtry osadzenia piszemy pełną ścieżką zasobu - PostgREST zawęża nimi
  // `!inner`, więc wiersz rodzica bez opłaconej realizacji odpada z liczby.
  const [issuedRes, convertedRes, paidRes, reservedRes] = await Promise.all([
    windowed(
      supabase
        .from("b2b_coupons")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      fromIso,
      toIso,
    ),
    windowed(
      supabase
        .from("b2b_coupons")
        .select(`id, b2b_coupon_redemptions!inner(id, ${PAID_ORDER})`, {
          count: "exact",
          head: true,
        })
        .eq("tenant_id", tenantId)
        .not("b2b_coupon_redemptions.effects_applied_at", "is", null)
        .eq("b2b_coupon_redemptions.payment_orders.environment", "live")
        .neq("b2b_coupon_redemptions.payment_orders.provider", "mock"),
      fromIso,
      toIso,
    ),
    windowed(
      supabase
        .from("b2b_coupon_redemptions")
        .select(`id, ${PAID_ORDER}`, { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .not("effects_applied_at", "is", null)
        .eq("payment_orders.environment", "live")
        .neq("payment_orders.provider", "mock"),
      fromIso,
      toIso,
    ),
    windowed(
      supabase
        .from("b2b_coupon_redemptions")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .is("effects_applied_at", null),
      fromIso,
      toIso,
    ),
  ]);
  const issued = exactCount(issuedRes, "issued");
  const issuedConverted = exactCount(convertedRes, "issued_converted");
  const paidRedemptions = exactCount(paidRes, "paid");
  const reservedRedemptions = exactCount(reservedRes, "reserved");

  const net = new Map<string, number>();
  const discount = new Map<string, number>();
  let read = 0;
  let truncated = false;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await windowed(
      supabase
        .from("b2b_coupon_redemptions")
        .select(`id, currency, original_cents, applied_cents, ${PAID_ORDER}`)
        .eq("tenant_id", tenantId)
        .not("effects_applied_at", "is", null)
        .eq("payment_orders.environment", "live")
        .neq("payment_orders.provider", "mock"),
      fromIso,
      toIso,
    )
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as PaidRedemptionAmounts[];
    for (const row of rows) {
      // Kontrakt `b2b_coupons_analytics`: przychód NETTO = cena przed rabatem
      // minus rabat; rabat = `applied_cents`.
      addTo(net, row.currency, row.original_cents - row.applied_cents);
      addTo(discount, row.currency, row.applied_cents);
    }
    read += rows.length;
    if (rows.length < PAGE) break;
    if (read >= COUPON_READ_LIMIT) {
      truncated = true;
      break;
    }
  }

  return {
    issued,
    issuedConverted,
    conversion: issued > 0 ? issuedConverted / issued : null,
    paidRedemptions,
    reservedRedemptions,
    revenueNet: asMoney(net),
    discount: asMoney(discount),
    truncated,
  };
}

/**
 * Klucz pod prefiksem analityki kuponów najemcy - reguła szyny `coupon.*`
 * i `invalidateCouponQueries` trafiają w każdy zakres dat. Element
 * `"summary"` odróżnia podsumowanie od rankingu (`analyticsCouponsKey`).
 */
export function couponAnalyticsSummaryQueryOptions(
  tenantId: string | null,
  fromIso: string | null,
  toIso: string | null,
) {
  return queryOptions({
    queryKey: [...analyticsCouponsPrefixKey(tenantId ?? ""), "summary", fromIso, toIso],
    enabled: Boolean(tenantId),
    staleTime: 30_000,
    retry: 1,
    queryFn: () => fetchCouponAnalyticsSummary(tenantId as string, fromIso, toIso),
  });
}

/* ------------------------------------------------ status kampanii (P04) */

export type CouponCampaignStatus = "draft" | "generated" | "sent" | "archived";
/** `sent` ustawia wyłącznie serwer po zakończonej wysyłce (D-S1-06). */
export type CouponCampaignPanelStatus = Exclude<CouponCampaignStatus, "sent">;

export interface SetCampaignStatusInput {
  campaignId: string;
  status: CouponCampaignPanelStatus;
  /** Surowe `updated_at` kampanii z listy (token, `40001` przy nieaktualnym). */
  expectedUpdatedAt: string;
}

export interface SetCampaignStatusResult {
  id: string;
  status: CouponCampaignStatus;
  updatedAt: string;
}

function parseSetStatusResult(raw: unknown): SetCampaignStatusResult {
  const value = raw as { id?: unknown; status?: unknown; updated_at?: unknown } | null;
  if (
    !value ||
    typeof value.id !== "string" ||
    typeof value.status !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    throw new Error("invalid_rpc_shape:admin_coupon_campaign_set_status");
  }
  return {
    id: value.id,
    status: value.status as CouponCampaignStatus,
    updatedAt: value.updated_at,
  };
}

/**
 * Zmiana statusu kampanii przez RPC `admin_coupon_campaign_set_status`
 * (PLAN S1 §4.3): przejścia panelu sprawdza serwer, `sent` jest zarezerwowany
 * dla wysyłki (42501), nieaktualny token = `40001`. Dawny UPDATE z panelu
 * ustawiał `sent` PRZED wysyłką.
 */
export async function setCampaignStatus(
  input: SetCampaignStatusInput,
): Promise<SetCampaignStatusResult> {
  // Sygnatura RPC trafi do `types.ts` w I9 (N19) - do tego czasu `RpcCallable`,
  // z nazwą funkcji LITERAŁEM (bramka kontraktu TS⇄SQL czyta ją ze źródła).
  const { data, error } = await (supabase as unknown as RpcCallable).rpc(
    "admin_coupon_campaign_set_status",
    {
      p_campaign_id: input.campaignId,
      p_status: input.status,
      p_expected_updated_at: input.expectedUpdatedAt,
    },
  );
  if (error) throw error;
  return parseSetStatusResult(data);
}

/**
 * Jedyny pisarz statusu kampanii z panelu (`syncManifest.ts`). Kampania
 * kuponowa linkuje kampanię newslettera (status widać w jej szczegółach),
 * więc unieważniamy też kampanie newslettera - reguła szyny tego jeszcze nie
 * robi (zgłoszenie „Do integracji").
 */
export function useSetCampaignStatus() {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: (input: SetCampaignStatusInput) => setCampaignStatus(input),
    onSuccess: () =>
      invalidateKeys(queryClient, [
        ...couponInvalidationKeys(tenantId),
        newsletterKeys.campaignsAll(),
      ]),
  });
}
