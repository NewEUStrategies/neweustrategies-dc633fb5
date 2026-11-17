// Tenant wołającego dla funkcji serwerowych CRM, które czytają spod
// service-role (kolumny bez grantu dla `authenticated`).
//
// Z profilu wołającego pod RLS, NIE z tokenu: claimy Supabase w tym projekcie
// nie niosą `tenant_id` (brak custom access token hooka), a auth-middleware
// wkłada do kontekstu surowy wynik getClaims(). Dawny odczyt `claims.tenant_id`
// był zawsze `undefined` i schodził na gałąź bez filtru (patrz listStaffUsers).
//
// Wynik jest JEDYNĄ granicą najemcy dla zapytań spod service-role - RLS jest
// tam wyłączone, więc każde takie zapytanie stawia `.eq("tenant_id", tenantId)`
// bezwarunkowo. Brak tenanta = ODMOWA (`tenant_unresolved`), nigdy „pokaż
// wszystko".
//
// Wspólny dla crm.functions.ts (lista staffu, awatary listy i karty leada)
// i crm-companies.functions.ts (członkowie na karcie firmy).
import { looseTable } from "@/lib/supabase/looseQuery";

export async function resolveCallerTenantId(context: {
  readonly supabase: unknown;
  readonly userId: string;
}): Promise<string> {
  const { data: tenantRow, error: tenantErr } = await looseTable(context, "profiles")
    .select("tenant_id")
    .eq("id", context.userId)
    .maybeSingle();
  if (tenantErr) throw new Error(tenantErr.message);
  const tenantId = (tenantRow as { tenant_id?: string } | null)?.tenant_id;
  if (!tenantId) throw new Error("tenant_unresolved");
  return tenantId;
}
