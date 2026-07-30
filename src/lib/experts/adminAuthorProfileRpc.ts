// Typowany dostęp do RPC `admin_get_author_profile` (SECURITY DEFINER: rola
// admin/super_admin + tenant admina). Funkcja pochodzi z późniejszej migracji
// niż ostatnia regeneracja typów Supabase, więc `supabase.rpc()` nie zna jej
// nazwy. Zamiast rozsiewać `as unknown as` po komponentach trzymamy JEDEN
// wrapper, który zwraca dokładnie ten sam kształt wiersza co bliźniacze
// `get_own_author_profile` - dzięki temu wywołania obu ścieżek (właściciel vs
// staff) są przypisywalne do wspólnego typu i nie potrzebują rzutowań u góry.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AuthorProfileRpcRow = Database["public"]["Functions"]["get_own_author_profile"]["Returns"];

interface MaybeSingleResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

interface RpcThenable<T> {
  maybeSingle: () => Promise<MaybeSingleResult<T>>;
}

/** Pełny wiersz author_profiles wskazanego użytkownika - wyłącznie dla staffu. */
export function adminGetAuthorProfile(userId: string): RpcThenable<AuthorProfileRpcRow> {
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => RpcThenable<AuthorProfileRpcRow>;
  return rpc("admin_get_author_profile", { _user_id: userId });
}
