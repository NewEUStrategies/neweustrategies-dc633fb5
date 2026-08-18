// Publiczny odczyt klubu po slug - JEDYNA funkcja warstwy danych klubów,
// której potrzebuje loader trasy /club/$clubSlug (a loadery są EAGER w
// drzewie tras). Wydzielona z api.ts, bo tamten moduł to ~40 funkcji RPC
// współdzielonych przez dziesiątki leniwych chunków klubowych: Rollup
// przypisywał go do chunku wejściowego z UNIĄ eksportów wszystkich
// konsumentów (~22 kB źródeł na każdej stronie publicznej). api.ts
// re-eksportuje tę funkcję, więc dotychczasowi konsumenci działają bez zmian.
import { supabase } from "@/integrations/supabase/client";
import type { ClubViewRow } from "./types";

export async function fetchClubBySlug(slug: string): Promise<ClubViewRow | null> {
  const { data, error } = await supabase.rpc("club_view", { p_slug: slug });
  if (error) throw error;
  return data?.[0] ?? null;
}
