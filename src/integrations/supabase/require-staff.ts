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

export const requireStaff = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data: profile, error: profileError } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();

    if (profileError) {
      console.error("[requireStaff] profile lookup failed", {
        userId: context.userId,
        message: profileError.message,
        details: profileError.details,
        hint: profileError.hint,
        code: profileError.code,
      });
      throw new Error(`Forbidden: could not verify staff role (${profileError.message})`);
    }

    if (!profile?.tenant_id) {
      throw new Error("Forbidden: staff role (admin/editor/author) required");
    }

    const { data: roles, error: rolesError } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("tenant_id", profile.tenant_id)
      .in("role", [...STAFF_ROLES]);

    if (rolesError) {
      console.error("[requireStaff] role lookup failed", {
        userId: context.userId,
        message: rolesError.message,
        details: rolesError.details,
        hint: rolesError.hint,
        code: rolesError.code,
      });
      throw new Error(`Forbidden: could not verify staff role (${rolesError.message})`);
    }

    if (!roles?.length) {
      throw new Error("Forbidden: staff role (admin/editor/author) required");
    }

    // Step-up MFA (audyt 2026-07-13, P1 #10): konto staffu z ZAREJESTROWANYM
    // drugim składnikiem nie może mutować na sesji aal1 - skradziony token
    // hasłowy przestaje wystarczac. Konta bez MFA dzialaja bez zmian (to
    // wymuszenie weryfikacji, nie enrolmentu). Claim `aal` pochodzi ze
    // zweryfikowanego JWT; liste faktorow czyta SECURITY DEFINER
    // has_verified_mfa() wylacznie o wlasnym koncie wywolujacego.
    const aal = (context.claims as { aal?: string }).aal;
    if (aal !== "aal2") {
      const { data: hasMfa, error: mfaError } = await context.supabase.rpc("has_verified_mfa");
      if (mfaError) {
        console.error("[requireStaff] mfa lookup failed", {
          userId: context.userId,
          message: mfaError.message,
          code: mfaError.code,
        });
        throw new Error(`Forbidden: could not verify MFA status (${mfaError.message})`);
      }
      if (hasMfa === true) {
        throw new Error(
          "Forbidden: mfa_required - verify your second factor (aal2) to perform staff actions",
        );
      }
    }

    return next();
  });
