// JEDNO ŹRÓDŁO NAJEMCY dla funkcji serwerowych (server-only).
//
// PO CO TO ISTNIEJE. Rola jest sprawdzana przez `has_role()` -> `current_tenant_id()`
// -> `profiles.tenant_id`. Jeśli dane czytamy po najemcy HOSTA, to są DWIE RÓŻNE
// GRANICE: admin najemcy A na domenie najemcy B przechodzi bramkę roli w A
// i czyta dane B. Host jest tu WYŁĄCZNIE kontrolą spójności; zakres zawsze
// pochodzi z profilu wołającego.
//
// ŻADNEJ GAŁĘZI WYJĄTKU DLA `super_admin`. `public.is_super_admin()` jest
// zawężone do `current_tenant_id()` (migracja
// 20260824074231_4a952090-86ab-46ed-a923-5cd9855c5d8c.sql), więc „super admin
// pomija porównanie host/profil" przywróciłoby dokładnie tę lukę, którą ten
// moduł zamyka - dla każdego, kto ma `super_admin` we WŁASNYM obszarze roboczym.
//
// GAŁĄŹ „NIE WIEM" JEST OBOWIĄZKOWA. Rozstrzygnięcie hosta idzie przez
// `resolveDomainBinding`, a NIE przez `resolveTenantIdForHost`: ten drugi ma
// fallback `?? directory.defaultTenant` dla KAŻDEGO niedopasowanego hosta
// (localhost, `*.pages.dev`, nieznana domena), więc porównanie z jego wynikiem
// odmawiałoby pracy każdemu adminowi spoza najemcy domyślnego na środowisku
// deweloperskim i podglądowym. `resolveDomainBinding` fallbacku nie ma:
// `tenant === null` znaczy „brak wskazówki" i wtedy PRZEPUSZCZAMY na najemcy
// profilowym.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { currentTenantHost } from "@/lib/http/requestHost";
import { resolveDomainBinding } from "@/lib/server/tenant.server";
import { resolveUserTenantId } from "@/lib/server/userTenant.server";

/**
 * Komunikat odmowy - JEDNAKOWY dla wszystkich funkcji i celowo milczący o tym,
 * jaki najemca siedzi pod hostem. Inaczej odmowa stałaby się wyrocznią mapy
 * domena -> obszar roboczy.
 */
export const TENANT_HOST_MISMATCH = "TENANT/HOST_MISMATCH";

/**
 * Najemca wołającego (z `profiles`), po sprawdzeniu, że host żądania go nie
 * przeczy. Zwracana wartość jest JEDYNYM legalnym zakresem dla zapytań spod
 * `service_role` w tej ścieżce.
 *
 * Kolejność jest wiążąca: najpierw profil (rzuca `No tenant for current user`,
 * gdy go nie ma - fail-closed), potem kontrola spójności z hostem.
 */
export async function assertCallerTenantMatchesHost(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const tenantId = await resolveUserTenantId(supabase, userId);

  const binding = await resolveDomainBinding(await currentTenantHost());
  // `binding.tenant === null` to „nie wiem" (host podglądowy, localhost, pusty
  // katalog domen), a nie „obcy host" - w tej gałęzi nie ma czego porównywać.
  if (binding.tenant && binding.tenant.id !== tenantId) throw new Error(TENANT_HOST_MISMATCH);
  return tenantId;
}
