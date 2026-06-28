// Serwerowa warstwa AUTORYZACJI nakladana na requireSupabaseAuth.
//
// requireSupabaseAuth potwierdza jedynie, ze token jest wazny (uwierzytelnienie).
// requireStaff dodaje drugi, niezalezny od RLS check: wywolujacy musi miec role
// staff (admin/editor/author) w swoim tenancie. Dzieki temu mutacje contentu nie
// polegaja juz wylacznie na politykach RLS - uwierzytelniony uzytkownik bez roli
// jest odrzucany zanim handler w ogole sie wykona.
//
// Kontekst (supabase scoped na uzytkownika, userId, claims) pochodzi z
// requireSupabaseAuth. is_staff() to SECURITY DEFINER RPC po stronie bazy.
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "./auth-middleware";

export const requireStaff = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data: isStaff, error } = await context.supabase.rpc("is_staff");
    if (error) {
      throw new Error("Forbidden: could not verify staff role");
    }
    if (!isStaff) {
      throw new Error("Forbidden: staff role (admin/editor/author) required");
    }
    return next();
  });
