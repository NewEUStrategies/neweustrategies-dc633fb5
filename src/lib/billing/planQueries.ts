// PLANY DOSTĘPU (`access_plans`) - JEDEN odczyt i JEDEN pisarz dla paywalla,
// członkostwa i huba „Przychód i lejek" (SPEC §3.2, §3.4; S1 def. 3 i 4).
//
// CO NAPRAWIA. `/admin/paywall` czytał plany pod własnym literałem
// `["admin-access-plans"]` (szyna go nie znała, więc zmiana planu w innej
// karcie nie docierała do edytora) i zapisywał CAŁY wiersz z formularza
// (`update(draft)` z `id`, `tenant_id`, `updated_at`, `tier_key`). Członkostwo
// przypinało w tym czasie plan do warstwy (`tier_key`), a zapis ceny z paywalla
// po cichu cofał to przypięcie: klasyczny „lost update". Teraz:
//
//   * odczyt `adminPlansAllQueryOptions()` pod kluczem `billingKeys.admin.plansAll()`
//     - tym, który unieważnia reguła `access_plan.changed.v1`;
//   * zapis `useSaveAccessPlanPatch(owner)` - patch WYŁĄCZNIE kolumn
//     właściciela (paywall: cena, cykl, opis…, członkostwo: `tier_key`), kolumna
//     spoza listy to błąd PRZED zapytaniem, a współbieżność optymistyczna przez
//     `.eq("updated_at", <token>)` zamienia cichy lost update w jawny konflikt;
//   * usuwanie `useDeleteAccessPlan()` tylko dla planu bez subskrypcji (def. 4:
//     FK `user_subscriptions.plan_id` kasuje historię klientów kaskadą).
//
// TOKEN WSPÓŁBIEŻNOŚCI = SUROWY NAPIS `updated_at` Z POSTGREST. Nigdy przez
// `new Date(...)`: `timestamptz` ma mikrosekundy, a `Date` milisekundy -
// „2026-10-19T10:00:00.123456+00:00" po przejściu przez `Date` nie równa się
// już wartości w bazie i KAŻDY zapis byłby konfliktem.
//
// NARZĘDZIA ZAPISU S1 (`STALE_WRITE_CODE`, `isStaleWriteError`, `staleWriteError`,
// `assertPatchColumns`, `invalidateKeys`, `revenueDomainKeys`) mieszkają tu
// tymczasowo: neutralny dom (`src/lib/admin/staleWrite.ts`) leży poza
// manifestem wycinka S1 (zgłoszenie Z-S1-P1) - przeniesienie w I9.
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
import { billingKeys } from "@/lib/billing/keys";
import { revenueKeys, type RevenueDomain } from "@/lib/revenue/keys";
import { useCurrentTenantId } from "@/lib/tenant";

// ---------------------------------------------------------------------------
// Konflikt zapisu (D-S1-02) - wspólny kontrakt wszystkich mutatorów S1.
// ---------------------------------------------------------------------------

/**
 * SQLSTATE `serialization_failure`. Ten sam kod rzucają RPC S1
 * (`RAISE … USING ERRCODE = '40001'`) i mutatory TS przy 0 wierszach z
 * `.eq("updated_at", token)` - UI rozpoznaje konflikt jednym predykatem,
 * niezależnie od tego, czy zapis szedł tabelą, czy funkcją.
 */
export const STALE_WRITE_CODE = "40001";

export type StaleWriteError = Error & { code: typeof STALE_WRITE_CODE };

/** Błąd „ktoś zapisał wcześniej" - komunikat jest kodem maszynowym (UI tłumaczy). */
export function staleWriteError(): StaleWriteError {
  return Object.assign(new Error("stale_write"), {
    code: STALE_WRITE_CODE as typeof STALE_WRITE_CODE,
  });
}

/**
 * Klucze komunikatów synchronizacji (`i18n-admin-paywall-sync.ts`). Mutatory
 * NIE tłumaczą - rzucają kod - ale para „kod → zdanie" ma jedno miejsce obok
 * predykatu: ekran woła `t(SYNC_MESSAGE_KEYS.staleWrite)`, zamiast przepisywać
 * klucz w każdym edytorze (paywall, cennik, członkostwo, newsletter, popupy).
 */
export const SYNC_MESSAGE_KEYS = {
  /** Konflikt `40001` - ktoś zapisał wcześniej. */
  staleWrite: "adminPaywall.sync.staleWrite",
  staleWriteHint: "adminPaywall.sync.staleWriteHint",
  /** Akcja: wczytaj stan serwera (szkic zostaje do porównania). */
  reload: "adminPaywall.sync.reload",
  keepDraft: "adminPaywall.sync.keepDraft",
  /** Zapis przeszedł po scaleniu z cudzą zmianą innych kolumn (D-S1-03). */
  merged: "adminPaywall.sync.merged",
  /** Serwer nie ma wiersza ustawień - funkcja wyłączona (def. 13, def. 14). */
  serverMissing: "adminPaywall.sync.serverMissing",
} as const;

/** Konflikt współbieżności: błąd mutatora albo błąd PostgREST z RPC (`code` = 40001). */
export function isStaleWriteError(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: unknown }).code === STALE_WRITE_CODE
  );
}

/**
 * Patch zawiera wyłącznie kolumny właściciela. Sprawdzane PRZED zapytaniem:
 * kolumna spoza listy (`id`, `tenant_id`, `updated_at`, kolumna drugiego
 * ekranu) to błąd programisty, który inaczej nadpisałby cudzą decyzję.
 */
export function assertPatchColumns(patch: object, allowed: readonly string[]): void {
  const allow = new Set(allowed);
  for (const column of Object.keys(patch)) {
    if (!allow.has(column)) throw new Error(`column_not_owned:${column}`);
  }
  if (Object.keys(patch).length === 0) throw new Error("empty_patch");
}

/**
 * Unieważnia zestaw prefiksów. Obietnica rozstrzyga się po odświeżeniu
 * zapytań AKTYWNYCH - `onSuccess` mutacji ją zwraca, więc `isPending` trwa do
 * chwili, w której ekran już pokazuje zapisany stan.
 */
export async function invalidateKeys(
  queryClient: QueryClient,
  keys: readonly QueryKey[],
): Promise<void> {
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

/**
 * Prefiksy dziedzin huba po zapisie w module (read-your-own-writes bez szyny,
 * scenariusz S-F): przy znanym najemcy - jego dziedzina, przy nieustalonym
 * (`useCurrentTenantId` w drodze) - dziedzina u wszystkich najemców.
 * Nadmiarowe, ale tanie (odświeżają się tylko zapytania aktywne), a nigdy
 * fałszywie świeże.
 */
export function revenueDomainKeys(
  domains: readonly RevenueDomain[],
  tenantId: string | null,
): QueryKey[] {
  return domains.map((domain) =>
    tenantId ? revenueKeys.domainTenant(domain, tenantId) : revenueKeys.domain(domain),
  );
}

// ---------------------------------------------------------------------------
// Plany
// ---------------------------------------------------------------------------

export type AccessPlanRow = Database["public"]["Tables"]["access_plans"]["Row"];
type AccessPlanWrite = Database["public"]["Tables"]["access_plans"]["Update"];

/**
 * Kolumny edytora paywalla: wszystko, co edytor planu pokazuje, poza
 * `tier_key` (przypięcie planu do warstwy należy do członkostwa - tam admin
 * widzi, CO plan sprzedaje). `for_sale` (cennik v6.2) jest tu świadomie:
 * „wycofaj ze sprzedaży" to akcja zastępcza dla planu z subskrypcjami.
 */
export const ACCESS_PLAN_PAYWALL_COLUMNS = [
  "name_pl",
  "name_en",
  "description_pl",
  "description_en",
  "features_pl",
  "features_en",
  "badge_pl",
  "badge_en",
  "highlighted",
  "sort_order",
  "price_cents",
  "currency",
  "interval",
  "trial_days",
  "active",
  "for_sale",
  "volume_price_cents",
  "volume_threshold_seats",
] as const satisfies readonly (keyof AccessPlanRow)[];

/** Kolumny członkostwa: wyłącznie przypięcie planu do warstwy. */
export const ACCESS_PLAN_MEMBERSHIP_COLUMNS = [
  "tier_key",
] as const satisfies readonly (keyof AccessPlanRow)[];

export type AccessPlanOwner = "paywall" | "membership";

type OwnedColumn<O extends AccessPlanOwner> = O extends "paywall"
  ? (typeof ACCESS_PLAN_PAYWALL_COLUMNS)[number]
  : (typeof ACCESS_PLAN_MEMBERSHIP_COLUMNS)[number];

/** Patch planu - typ zawęża kolumny do właściciela, runtime sprawdza to samo. */
export type AccessPlanPatch<O extends AccessPlanOwner = AccessPlanOwner> = Partial<
  Pick<AccessPlanWrite, OwnedColumn<O>>
>;

export interface SaveAccessPlanInput<O extends AccessPlanOwner = AccessPlanOwner> {
  /** `null` = nowy plan (tylko paywall). */
  id: string | null;
  /** Surowe `updated_at` wiersza, na którym admin zaczął edycję; `null` przy INSERT. */
  expectedUpdatedAt: string | null;
  patch: AccessPlanPatch<O>;
}

const OWNER_COLUMNS: Record<AccessPlanOwner, readonly string[]> = {
  paywall: ACCESS_PLAN_PAYWALL_COLUMNS,
  membership: ACCESS_PLAN_MEMBERSHIP_COLUMNS,
};

/** Domeny huba, które liczą się z planów (reguła panelu `access_plan.changed.v1`). */
const PLAN_REVENUE_DOMAINS = [
  "mrr",
  "churn",
  "cohorts",
  "dunning",
  "snapshot",
  "offer",
  "access",
  "diagnostics",
] as const satisfies readonly RevenueDomain[];

/**
 * Wszystkie plany najemcy, także nieaktywne i wycofane ze sprzedaży - wspólny
 * odczyt paywalla, członkostwa i huba. Wiersz niesie `updated_at` (token
 * zapisu), `for_sale`, `tier_key` i `volume_*`.
 */
export function adminPlansAllQueryOptions() {
  return queryOptions({
    queryKey: billingKeys.admin.plansAll(),
    staleTime: 30_000,
    queryFn: async (): Promise<AccessPlanRow[]> => {
      const { data, error } = await supabase
        .from("access_plans")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Zapis planu (bez haka - do testów i napraw huba). INSERT wyłącznie dla
 * paywalla; najemca z domyślnej kolumny (`current_tenant_id()`), nigdy
 * z formularza. UPDATE z tokenem: 0 wierszy = ktoś zapisał wcześniej (albo
 * plan zniknął) → `40001`.
 */
export async function saveAccessPlanPatch<O extends AccessPlanOwner>(
  owner: O,
  input: SaveAccessPlanInput<O>,
): Promise<AccessPlanRow> {
  const patch: AccessPlanWrite = { ...input.patch };
  assertPatchColumns(patch, OWNER_COLUMNS[owner]);

  if (input.id === null) {
    if (owner !== "paywall") throw new Error("insert_not_owned");
    const { data, error } = await supabase.from("access_plans").insert(patch).select("*").single();
    if (error) throw error;
    return data;
  }

  if (input.expectedUpdatedAt === null) throw new Error("expected_updated_at_required");
  const { data, error } = await supabase
    .from("access_plans")
    .update(patch)
    .eq("id", input.id)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("*");
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw staleWriteError();
  return row;
}

/**
 * Jedyny pisarz `access_plans` z panelu (`syncManifest.ts`). Mutator nie
 * pokazuje toastów - rzuca; ekran tłumaczy `40001` przez
 * `adminPaywall.sync.*`, resztę przez `toastError`.
 */
export function useSaveAccessPlanPatch<O extends AccessPlanOwner>(owner: O) {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: (input: SaveAccessPlanInput<O>) => saveAccessPlanPatch(owner, input),
    onSuccess: () => invalidatePlanQueries(queryClient, tenantId),
  });
}

/**
 * Liczba wierszy `user_subscriptions` planu w KAŻDYM statusie - usunięcie
 * planu kasuje je kaskadą razem z historią (def. 4). Wiarygodna dla admina:
 * RLS `subs owner read` pokazuje redaktorowi tylko jego własne subskrypcje
 * (redaktor i tak nie usuwa planów - polityka `plans staff delete`).
 */
export async function countPlanSubscriptions(planId: string): Promise<number> {
  const { count, error } = await supabase
    .from("user_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId);
  if (error) throw error;
  // `null` przy `count: "exact"` to brak odpowiedzi, nie zero - usunięcie
  // na tej podstawie byłoby zgadywaniem.
  if (count === null) throw new Error("count_unavailable");
  return count;
}

/**
 * Klucz pod prefiksem `allUserSubscriptions()`: każde zdarzenie subskrypcji
 * (`subscriptionKeys()` szyny) odświeża licznik, który decyduje o tym, czy
 * plan wolno usunąć.
 */
export function planSubscriptionCountQueryOptions(planId: string | null) {
  return queryOptions({
    queryKey: [
      ...billingKeys.admin.allUserSubscriptions(),
      "plan-count",
      planId ?? "none",
    ] as const,
    enabled: Boolean(planId),
    staleTime: 30_000,
    queryFn: () => countPlanSubscriptions(planId as string),
  });
}

/** Plan ma subskrypcje - usunięcie zablokowane, akcja zastępcza: `for_sale = false`. */
export type PlanHasSubscriptionsError = Error & {
  code: "plan_has_subscriptions";
  subscriptionCount: number;
};

export function isPlanHasSubscriptionsError(err: unknown): err is PlanHasSubscriptionsError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "plan_has_subscriptions"
  );
}

/**
 * Usunięcie planu WYŁĄCZNIE bez subskrypcji (D-S1-05). Licznik jest
 * sprawdzany ponownie tuż przed zapytaniem: dialog mógł stać otwarty, gdy
 * ktoś w tym czasie kupił plan. Nigdy `active = false` jako „dezaktywacja":
 * webhook mapuje cenę wyłącznie na plany aktywne, więc obecni klienci
 * straciliby odnowienia (PLAN S1 V3).
 */
export async function deleteAccessPlan(planId: string): Promise<void> {
  const subscriptionCount = await countPlanSubscriptions(planId);
  if (subscriptionCount > 0) {
    throw Object.assign(new Error(`plan_has_subscriptions:${subscriptionCount}`), {
      code: "plan_has_subscriptions" as const,
      subscriptionCount,
    });
  }
  const { data, error } = await supabase
    .from("access_plans")
    .delete()
    .eq("id", planId)
    .select("id");
  if (error) throw error;
  // 0 wierszy: plan już usunięty w innej karcie albo rola bez prawa usuwania
  // (RLS nie zgłasza błędu, tylko nie usuwa) - nie wolno udawać sukcesu.
  if (!data?.length) throw Object.assign(new Error("not_found"), { code: "P0002" });
}

export function useDeleteAccessPlan() {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => deleteAccessPlan(id),
    onSuccess: () => invalidatePlanQueries(queryClient, tenantId),
  });
}

/**
 * Klucze WSZYSTKICH konsumentów planu: reguła rdzenia `access_plan.changed.v1`
 * (paywall, członkostwo, cennik publiczny, kasa, kupony, diagnostyka płatności)
 * + dziedziny huba z rozszerzenia panelu. Szyna dostarczy to samo innym
 * kartom; ta karta nie czeka na nią (działa też bez realtime).
 */
export function planInvalidationKeys(tenantId: string | null): QueryKey[] {
  return [
    billingKeys.plansActive(),
    billingKeys.admin.plans(),
    billingKeys.admin.monetization(),
    billingKeys.mySubscriptionAll(),
    billingKeys.admin.plansAll(),
    couponKeys.plans(),
    billingKeys.admin.testPlans(),
    ...revenueDomainKeys(PLAN_REVENUE_DOMAINS, tenantId),
  ];
}

export function invalidatePlanQueries(
  queryClient: QueryClient,
  tenantId: string | null,
): Promise<void> {
  return invalidateKeys(queryClient, planInvalidationKeys(tenantId));
}
