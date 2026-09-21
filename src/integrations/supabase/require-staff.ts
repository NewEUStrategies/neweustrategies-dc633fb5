// Serwerowa warstwa AUTORYZACJI nakladana na requireSupabaseAuth.
//
// requireSupabaseAuth potwierdza jedynie, ze token jest wazny (uwierzytelnienie).
// requireStaff dodaje drugi, niezalezny od RLS check: wywolujacy musi miec role
// staff (admin/editor/author) w swoim tenancie. Dzieki temu mutacje contentu nie
// polegaja juz wylacznie na politykach RLS - uwierzytelniony uzytkownik bez roli
// jest odrzucany zanim handler w ogole sie wykona.
//
// Osobna klasa to zasoby INSTALACJI (requirePlatformAdmin): tam sama rola nie
// wystarcza, bo role sa nadawane per najemca - musi dojsc przynaleznosc do
// najemcy domyslnego, inaczej super admin dowolnej organizacji rusza ustawienia
// wspolne dla wszystkich.
//
// Kontekst (supabase scoped na uzytkownika, userId, claims) pochodzi z
// requireSupabaseAuth. Sprawdzamy role bezposrednio przez user-scoped klienta:
// uzytkownik moze odczytac wlasny profil i wlasne role, wiec mutacje contentu
// nie zaleza od dostepnosci RPC is_staff() ani od uprawnien EXECUTE funkcji.
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "./auth-middleware";
import type { Database } from "./types";

type AppRole = Database["public"]["Enums"]["app_role"];

const STAFF_ROLES: readonly AppRole[] = ["admin", "editor", "author"];
const ADMIN_EDITOR_ROLES: readonly AppRole[] = ["admin", "editor", "super_admin"];
const ADMIN_ROLES: readonly AppRole[] = ["admin", "super_admin"];
// CRM to modul sprzedazowo-operacyjny - autorzy contentu nie powinni mieć wglądu
// w leady/firmy/pipeline. Trzymamy się tego samego zestawu co RLS na tabelach
// crm_* (admin/editor/super_admin), żeby middleware nie wpuszczał autorów do
// handlerów, które i tak odbije baza.
const CRM_STAFF_ROLES: readonly AppRole[] = ["admin", "editor", "super_admin"];
// Operator PLATFORMY, nie najemcy. `job_runner_settings` to JEDEN wiersz (id=1)
// bez kolumny tenant_id: adres, pod który pg_cron wysyła sekret operatora, i
// kill switch gaszący pocztę WSZYSTKICH najemców. Baza mówi to samo od migracji
// 20260727112330 (polityka "job_runner_settings super_admin read", komentarz
// "platform-wide singleton, not per-tenant") - tu domykamy ZAPIS, który idzie
// spod service_role i RLS omija.
const PLATFORM_ADMIN_ROLES: readonly AppRole[] = ["super_admin"];

/**
 * `requireDefaultTenant` jest opcjonalne, bo dotyczy WYŁĄCZNIE zasobów
 * wspólnych dla całej instalacji - cztery bramki najemcy zachowują się tak jak
 * dotąd i nie płacą za dodatkowe zapytanie.
 */
function roleMiddleware(allowed: readonly AppRole[], label: string, requireDefaultTenant = false) {
  return createMiddleware({ type: "function" })
    .middleware([requireSupabaseAuth])
    .server(async ({ next, context }) => {
      const { data: profile, error: profileError } = await context.supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", context.userId)
        .maybeSingle();

      if (profileError) {
        console.error(`[${label}] profile lookup failed`, {
          userId: context.userId,
          message: profileError.message,
          code: profileError.code,
        });
        throw new Error(`Forbidden: could not verify ${label} (${profileError.message})`);
      }
      if (!profile?.tenant_id) {
        throw new Error(`Forbidden: ${label} required`);
      }

      const { data: roles, error: rolesError } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("tenant_id", profile.tenant_id)
        .in("role", [...allowed]);

      if (rolesError) {
        console.error(`[${label}] role lookup failed`, {
          userId: context.userId,
          message: rolesError.message,
          code: rolesError.code,
        });
        throw new Error(`Forbidden: could not verify ${label} (${rolesError.message})`);
      }
      if (!roles?.length) {
        throw new Error(`Forbidden: ${label} required`);
      }

      // `super_admin` jest rolą PER NAJEMCA (has_role/is_super_admin filtrują po
      // current_tenant_id), więc sama rola nie wyraża „operatora instalacji".
      // Dopiero przynależność do najemcy domyślnego rozstrzyga, kto może ruszać
      // zasób wspólny dla wszystkich najemców.
      if (requireDefaultTenant) {
        const { data: tenant, error: tenantError } = await context.supabase
          .from("tenants")
          .select("is_default")
          .eq("id", profile.tenant_id)
          .maybeSingle();
        if (tenantError) {
          console.error(`[${label}] tenant lookup failed`, {
            userId: context.userId,
            message: tenantError.message,
            code: tenantError.code,
          });
          throw new Error(`Forbidden: could not verify ${label} (${tenantError.message})`);
        }
        if (tenant?.is_default !== true) {
          throw new Error(`Forbidden: ${label} required`);
        }
      }

      const aal = (context.claims as { aal?: string }).aal;
      if (aal !== "aal2") {
        const { data: hasMfa, error: mfaError } = await context.supabase.rpc("has_verified_mfa");
        if (mfaError) {
          console.error(`[${label}] mfa lookup failed`, {
            userId: context.userId,
            message: mfaError.message,
            code: mfaError.code,
          });
          throw new Error(`Forbidden: could not verify MFA status (${mfaError.message})`);
        }
        if (hasMfa === true) {
          throw new Error(
            `Forbidden: mfa_required - verify your second factor (aal2) to perform ${label} actions`,
          );
        }
      }

      return next();
    });
}

export const requireStaff = roleMiddleware(STAFF_ROLES, "staff role (admin/editor/author)");
export const requireCrmStaff = roleMiddleware(CRM_STAFF_ROLES, "CRM staff role (admin/editor)");
export const requireAdminEditor = roleMiddleware(ADMIN_EDITOR_ROLES, "admin/editor role");
export const requireAdmin = roleMiddleware(ADMIN_ROLES, "admin role");
// Bramka zasobów INSTALACJI (singleton `job_runner_settings`): rola operatora
// plus najemca domyślny. Staff dowolnego najemcy ma tu zostać odrzucony, bo
// jedna zmiana w tym wierszu dotyczy poczty i zadań tła wszystkich najemców.
export const requirePlatformAdmin = roleMiddleware(
  PLATFORM_ADMIN_ROLES,
  "platform admin role (super_admin)",
  true,
);
