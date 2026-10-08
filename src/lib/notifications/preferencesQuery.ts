// Odczyt preferencji powiadomień - LEKKI moduł zapytania.
//
// JEDNO ŹRÓDŁO klucza cache, zapytania i kształtu danych. `useNotifications`
// re-eksportuje stąd hak i bierze klucz do unieważnień, więc dzwonek, centrum
// powiadomień, okno rozmowy i pasek doku dzielą jeden wpis cache i jedno
// żądanie.
//
// DLACZEGO OSOBNY MODUŁ. Pasek przestrzeni roboczej (`WorkspaceDock`) potrzebuje
// tylko dwóch flag (`enabled_message`, `allow_messages_from`), żeby zdecydować,
// czy otworzyć kanał toastów czatu. Import z `useNotifications` dokładał do
// domknięcia leniwego chunku paska trzy chunki (`useNotifications` →
// `kindInvalidation` → klucze klubów → zdarzenia domenowe), ok. 5 kB gzip, na
// które czekało pierwsze malowanie paska członka. Ten moduł importuje wyłącznie
// czysty model `./preferences`, klienta Supabase i `useAuth`.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_SELECT,
  type NotificationPreferences,
} from "./preferences";

/** Klucz cache preferencji: `["notifications", "preferences", <uid>]`. */
export const notificationPreferencesKey = (uid: string | undefined) =>
  ["notifications", "preferences", uid ?? "anon"] as const;

/** Per-user notification preferences (upserted on first save). */
export function useNotificationPreferences(): UseQueryResult<NotificationPreferences> {
  const { user } = useAuth();
  return useQuery({
    queryKey: notificationPreferencesKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<NotificationPreferences> => {
      // Lista kolumn wyprowadzona z DEFAULT_NOTIFICATION_PREFERENCES - ręczna
      // gubiła nowe flagi (enabled_saved_search, enabled_crm_task), przez co
      // zapisane "wyłączone" wracało do UI jako "włączone".
      const { data, error } = await supabase
        .from("notification_preferences")
        .select(NOTIFICATION_PREFERENCE_SELECT)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...((data ?? {}) as Partial<NotificationPreferences>),
      };
    },
    staleTime: 60_000,
  });
}
