// Centralny odczyt tożsamości bez round-tripu do Auth API.
//
// `supabase.auth.getUser()` uderza w POST /auth/v1/user przy każdym wywołaniu
// - było to widoczne w profilerze przy każdym otwarciu buildera, listy
// materiałów, portalu członkowskiego itd. `supabase.auth.getSession()` czyta
// z tego samego lokalnego cache'u, na którym pracuje AuthProvider - bearer
// i tak jest waliduje PostgREST/RLS po stronie serwera przy każdym zapytaniu,
// więc autoryzacja nie zmienia sie ani na jotę.
//
// Reguła: kod poza React (funkcje danych, buildery, mutacje) używa tych
// helperów zamiast auth.getUser(). Komponenty czytają tożsamość z
// `useAuth()` (AuthProvider) - patrz src/hooks/useAuth.tsx.
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export async function currentUserFromSession(): Promise<User | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

export async function currentUserIdFromSession(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
