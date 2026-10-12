// Serwerowa bramka CELU zmiany planu - jedna dla obu ścieżek samoobsługi
// (karta operatora: `changeStripePlan` / `previewStripePlanChange` z lookup_key,
// karta lokalna: `changeSubscriptionPlan` z id planu). Server-only.
//
// DLACZEGO TU, A NIE W UI (SUB-14). Do audytu `changeStripePlan` przyjmował
// dowolny lookup_key z katalogu: plan nieaktywny w najemcy, plan innego
// najemcy, `decision_lab_seat` - filtr istniał tylko w komponencie. Wywołanie
// server fn z pominięciem UI kończyło się płatnością bez uprawnienia albo
// przejściem na plan spoza oferty.
//
// Zakres NAJEMCY pochodzi z profilu wołającego (`resolveUserTenantId`), nigdy
// z ładunku. Plany czytamy rolą serwisową z JAWNYM filtrem najemcy - RLS
// `access_plans` wiąże się z hostem żądania, a host to nie jest granica
// subskrypcji. Reguła samego planu (aktywny, cykliczny, ścisły odpowiednik
// w katalogu, ten sam model rozliczenia) to `planSwitchRefusal` - DOKŁADNIE
// ta sama funkcja, którą UI filtruje listę celów.
//
// UWAGA (weryfikacja stawek ulgowych): kasa (`createCheckoutOrder`) nie
// weryfikuje dziś uprawnienia do planów student/educator - przyjmuje każdy
// aktywny plan najemcy. Zmiana planu odzwierciedla kasę 1:1; gdy weryfikacja
// powstanie, musi wejść do `planSwitchRefusal`, żeby obie bramki zostały
// równe (inaczej zmiana planu byłaby furtką obok kasy albo odwrotnie).
import { catalogEntryByPriceId } from "@/lib/billing/catalog";
import {
  planSwitchRefusal,
  switchEntryForPlan,
  switchTargets,
  type PlanSwitchRefusal,
} from "@/lib/billing/planSwitch";

interface OfferedSwitchTarget {
  planId: string;
  tenantId: string;
  interval: string;
  /** lookup_key ceny docelowej - ŚCISŁY odpowiednik (tier, interwał) planu. */
  lookupKey: string;
}

export type SwitchTargetRef = { planId: string } | { lookupKey: string };

export type SwitchTargetResult =
  { ok: true; target: OfferedSwitchTarget } | { ok: false; error: PlanSwitchRefusal };

const PLAN_COLUMNS = "id, tenant_id, active, interval, tier_key, sort_order";

/**
 * Rozstrzyga cel zmiany planu w ofercie najemcy WOŁAJĄCEGO.
 *
 * @param subscriptionTenantId najemca wiersza subskrypcji (z bazy, nie
 *        z ładunku). Inny niż najemca sesji = subskrypcja spoza obszaru
 *        roboczego, w którym wołający działa - odmowa bez ujawniania powodu.
 * @param currentLookupKey bieżąca cena wg lustra w bazie. Służy wyłącznie
 *        wczesnej odmowie (`same_plan`, `plan_kind_mismatch`) przed ruchem
 *        do operatora; ostateczną regułę katalogu operacja u dostawcy liczy
 *        jeszcze raz na ŻYWYM stanie.
 */
export async function resolveOfferedSwitchTarget(input: {
  userId: string;
  subscriptionTenantId: string | null;
  currentLookupKey: string | null;
  target: SwitchTargetRef;
}): Promise<SwitchTargetResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { resolveUserTenantId } = await import("@/lib/server/userTenant.server");
  const tenantId = await resolveUserTenantId(supabaseAdmin, input.userId);
  if (input.subscriptionTenantId && input.subscriptionTenantId !== tenantId) {
    return { ok: false, error: "plan_not_found" };
  }
  const current = catalogEntryByPriceId(input.currentLookupKey);

  if ("planId" in input.target) {
    const { data: plan, error } = await supabaseAdmin
      .from("access_plans")
      .select(PLAN_COLUMNS)
      .eq("id", input.target.planId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // Jawne porównanie mimo filtra: rola serwisowa omija RLS, więc to jest
    // zamek - a nie wolno go oprzeć na jednym warunku zapytania.
    if (!plan || plan.tenant_id !== tenantId) return { ok: false, error: "plan_not_found" };
    const refusal = planSwitchRefusal(plan, current);
    const entry = switchEntryForPlan(plan);
    if (refusal || !entry) return { ok: false, error: refusal ?? "plan_not_switchable" };
    return {
      ok: true,
      target: { planId: plan.id, tenantId, interval: plan.interval, lookupKey: entry.priceId },
    };
  }

  // lookup_key -> plan oferty: te same aktywne plany, w tej samej kolejności
  // (`sort_order`) i przez ten sam `switchTargets`, którym UI buduje listę.
  const lookupKey = input.target.lookupKey;
  const entry = catalogEntryByPriceId(lookupKey);
  // Pozycja jednorazowa (`decision_lab_seat`) albo spoza katalogu nie jest
  // celem zmiany subskrypcji w żadnym najemcy - bez czytania oferty.
  if (!entry || entry.oneTime) return { ok: false, error: "plan_not_switchable" };
  const { data: plans, error } = await supabaseAdmin
    .from("access_plans")
    .select(PLAN_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  const offered = (plans ?? []).filter((p) => p.tenant_id === tenantId);
  const match = switchTargets(offered, current).find((o) => o.lookupKey === lookupKey);
  if (!match) {
    // Najbardziej konkretny powód dla planu, który istnieje, ale nie przechodzi
    // reguły (np. ten sam plan) - inaczej „nie ma takiego planu w ofercie".
    const candidate = offered.find((p) => switchEntryForPlan(p)?.priceId === lookupKey);
    const refusal = candidate ? planSwitchRefusal(candidate, current) : null;
    return { ok: false, error: refusal ?? "plan_not_found" };
  }
  return {
    ok: true,
    target: {
      planId: match.plan.id,
      tenantId,
      interval: match.plan.interval,
      lookupKey: match.lookupKey,
    },
  };
}
