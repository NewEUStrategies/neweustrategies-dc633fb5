// Client-side tenant helpers.
//
// RLS already enforces tenant isolation on the server (every policy checks
// tenant_id = current_tenant_id()). These helpers add a second, client-side
// guard so admin queries explicitly scope by tenant - defense in depth and
// also a smaller payload over the wire.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Druga kłódka izolacji obszarów roboczych - po stronie klienta.
 *
 * Autorytetem jest RLS (`tenant_id = current_tenant_id()` / `public_tenant_id()`),
 * ale zasób raz wczytany do cache przeglądarki bywa renderowany dalej po zmianie
 * kontekstu (zmiana konta, powrót z historii, współdzielony link z cudzym id).
 * Ta funkcja odpowiada na jedno pytanie: „czy WIEM, że ten zasób należy do innego
 * obszaru roboczego niż oglądający?".
 *
 * Świadomie fail-OPEN przy niewiedzy (brak któregoś identyfikatora = `false`):
 * blokowanie na podstawie nieznanego kontekstu wywracałoby legalne ścieżki
 * (np. profil bez wczytanego jeszcze tenanta), a szczelność i tak zapewnia baza.
 * Fail-CLOSED jest tam, gdzie mamy dowód: dwa znane, różne identyfikatory.
 */
export function isForeignTenantResource(
  resourceTenantId: string | null | undefined,
  viewerTenantId: string | null | undefined,
): boolean {
  if (!resourceTenantId || !viewerTenantId) return false;
  return resourceTenantId !== viewerTenantId;
}

export function useCurrentTenantId(): string | null {
  const { user } = useAuth();
  const { data } = useQuery({
    enabled: !!user?.id,
    queryKey: ["current_tenant_id", user?.id],
    queryFn: async (): Promise<string | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data?.tenant_id ?? null;
    },
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });
  return data ?? null;
}
