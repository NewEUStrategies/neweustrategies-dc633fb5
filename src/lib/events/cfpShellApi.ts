// Odczyt NABORU PRELEGENTÓW dla CHROME'U strony wydarzenia: czy pasek zakładek
// ma pokazać pozycję „Nabór prelegentów".
//
// DLACZEGO OSOBNY MODUŁ, A NIE `cfpPublicApi.fetchCfpPublic`. Pasek zakładek
// jest w chunku POWŁOKI, czyli na KAŻDEJ stronie wydarzenia. `cfpPublicApi`
// statycznie ciągnie parsery całej powierzchni naboru (`cfpSurface`: pola
// formularza, formy, ścieżki, panel prelegenta i recenzenta) - kilka KB gzip,
// których zwiedzający bez zamiaru zgłoszenia nie potrzebuje. Pasek pyta
// wyłącznie o fazę, więc czyta z tego samego RPC jedno pole i nie importuje
// niczego poza klientem bazy (który powłoka ma i tak).
//
// FAZA LICZONA W BAZIE (`_event_cfp_phase`), nigdy z zegara przeglądarki -
// ta sama reguła, co na stronie naboru.
import { supabase } from "@/integrations/supabase/client";

/**
 * `true` wyłącznie przy fazie `open`. Brak wydarzenia (`null`), nabór
 * nieskonfigurowany (`none`), zaplanowany i zamknięty dają `false`.
 */
export async function fetchCfpTabOpen(slug: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("event_cfp_public", { p_slug: slug });
  if (error) throw new Error(error.message);
  return typeof data === "object" && data !== null && !Array.isArray(data) && data.phase === "open";
}
