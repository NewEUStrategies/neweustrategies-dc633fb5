// Klient Supabase WOŁAJĄCEGO dla funkcji serwerowych uczestnika.
//
// DWA TRYBY W JEDNYM. Funkcje uczestnika działają albo na koncie (Bearer
// z sesji przeglądarki), albo na kluczu gościa (manage token / token
// przekazania / token follow-up) - bez konta. `requireSupabaseAuth` odrzuca
// drugi tryb w całości, a `supabaseAdmin` omija RLS i NIE niesie hosta, więc
// `public_tenant_id()` wskazałby najemcę domyślnego (uczestnik najemcy B
// operowałby na wydarzeniach najemcy A). Ten moduł daje klienta z nagłówkiem
// hosta (`fetchWithTenantHost`) i - gdy jest - z tokenem wołającego.
//
// TOKEN, KTÓRY JEST, MUSI BYĆ WAŻNY. Nieprawidłowy Bearer NIE spada do trybu
// anonimowego (`unauthorized`): inaczej wygasła sesja zamieniłaby się po
// cichu w gościa i RPC odpowiadałoby „nie znaleziono" zamiast „zaloguj się".
// Brak nagłówka (albo nagłówek innego schematu) = gość.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";

import type { Database } from "@/integrations/supabase/types";
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";

export interface CallerSupabase {
  client: SupabaseClient<Database>;
  /** `sub` z ważnego tokenu albo `null` dla gościa. */
  userId: string | null;
}

function bearerToken(): string {
  const header = getRequest()?.headers?.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

export async function callerSupabase(): Promise<CallerSupabase> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("server_misconfigured: missing Supabase environment");

  const auth = { storage: undefined, persistSession: false, autoRefreshToken: false };
  const token = bearerToken();
  if (token === "") {
    return {
      client: createClient<Database>(url, key, { auth, global: { fetch: fetchWithTenantHost } }),
      userId: null,
    };
  }

  const client = createClient<Database>(url, key, {
    auth,
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: fetchWithTenantHost },
  });
  const { data, error } = await client.auth.getClaims(token);
  const sub = data?.claims?.sub;
  if (error || typeof sub !== "string" || sub === "") throw new Error("unauthorized");
  return { client, userId: sub };
}
