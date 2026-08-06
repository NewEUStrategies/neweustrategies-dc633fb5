// Tożsamość „jeśli jest" dla funkcji serwerowych otwartych dla anonimów.
//
// `requireSupabaseAuth` rzuca przy braku tokenu - to właściwe dla operacji
// wymagających konta, ale nie dla darowizny, którą można wpłacić bez
// logowania. Globalny `attachSupabaseAuth` dokleja bearer do KAŻDEGO RPC, gdy
// tylko istnieje sesja, więc wystarczy odczytać go miękko: jest - wiążemy
// wpłatę z kontem (rejestr w profilu + nadanie statusu wspierającego przez
// trigger `tg_donations_grant_supporter`), nie ma - darowizna zostaje
// anonimowa.
//
// Kontrakt: NIGDY nie rzuca i nigdy nie ufa treści tokenu bez weryfikacji -
// `getClaims` sprawdza podpis, więc podrobiony bearer nie podszyje się pod
// cudze konto (dostałby najwyżej `null`).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

let cached: SupabaseClient<Database> | null = null;

async function anonClient(): Promise<SupabaseClient<Database> | null> {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  cached = createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Identyfikator zalogowanego użytkownika albo `null` (anonim / brak tokenu). */
export async function optionalUserIdFromRequest(): Promise<string | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const header = getRequest()?.headers?.get("authorization");
    if (!header?.startsWith("Bearer ")) return null;
    const token = header.slice(7).trim();
    if (!token) return null;

    const supabase = await anonClient();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getClaims(token);
    if (error) return null;
    const sub = data?.claims?.sub;
    return typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}
