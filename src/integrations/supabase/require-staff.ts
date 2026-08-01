// Serwerowa warstwa AUTORYZACJI nakladana na requireSupabaseAuth.
//
// requireSupabaseAuth potwierdza jedynie, ze token jest wazny (uwierzytelnienie).
// requireStaff dodaje drugi, niezalezny od RLS check: wywolujacy musi miec role
// staff (admin/editor/author) w swoim tenancie. Dzieki temu mutacje contentu nie
// polegaja juz wylacznie na politykach RLS - uwierzytelniony uzytkownik bez roli
// jest odrzucany zanim handler w ogole sie wykona.
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

function roleMiddleware(allowed: readonly AppRole[], label: string) {
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
