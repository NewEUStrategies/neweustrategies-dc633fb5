// Opublikowane MATERIAŁY PRELEGENTÓW na stronie wydarzenia
// (`event_speaker_materials_public`).
//
// PO CO TEN MODUŁ. Organizator publikuje materiał w panelu, prelegent wybiera,
// kto go zobaczy („publiczny" / „dla zapisanych") - a do tej pory nic tego nie
// czytało, więc „Opublikuj" niczego nie zmieniało. Ten odczyt zamyka obieg:
// dialog profilu prelegenta pokazuje materiały tej osoby.
//
// LEKKI, BO JEDZIE W CHUNKU PUBLICZNYM. Bez `cfpSurface`/`cfpPublicApi`
// (panel prelegenta i recenzenta) - tylko klient RPC i zamknięte zbiory z
// `cfpEnums`.
//
// ODPOWIEDŹ ZALEŻY OD ZALOGOWANIA (materiały „dla zapisanych" widzi tylko osoba
// z zatwierdzonym zapisem), więc klucz niesie identyfikator widza: po
// zalogowaniu dialog nie może pokazać migawki gościa. Zapytanie rusza wyłącznie
// po otwarciu dialogu - odpowiedź nigdy nie trafia do SSR ani do pamięci
// krawędzi.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { asOneOf, SPEAKER_MATERIAL_KINDS, type SpeakerMaterialKind } from "@/lib/events/cfpEnums";

type PublicMaterialRow =
  Database["public"]["Functions"]["event_speaker_materials_public"]["Returns"][number];

export interface PublicSpeakerMaterial {
  id: string;
  speakerProfileId: string;
  sessionId: string | null;
  kind: SpeakerMaterialKind;
  titlePl: string;
  titleEn: string;
  url: string;
  /** `true` = materiał „dla zapisanych" (widz ma zatwierdzony zapis). */
  registeredOnly: boolean;
}

/** Wiersze RPC -> model ekranu. Baza porządkuje (prelegent, kolejność dodania). */
export function parsePublicSpeakerMaterials(
  rows: readonly PublicMaterialRow[] | null,
): PublicSpeakerMaterial[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    speakerProfileId: row.speaker_profile_id,
    sessionId: row.session_id ?? null,
    kind: asOneOf(SPEAKER_MATERIAL_KINDS, row.kind, "link"),
    titlePl: row.title_pl ?? "",
    titleEn: row.title_en ?? "",
    url: row.url,
    registeredOnly: row.visibility === "registered",
  }));
}

export async function fetchPublicSpeakerMaterials(
  eventId: string,
): Promise<PublicSpeakerMaterial[]> {
  const { data, error } = await supabase.rpc("event_speaker_materials_public", {
    p_event_id: eventId,
  });
  if (error) throw new Error(error.message);
  return parsePublicSpeakerMaterials(data);
}

/** Jeden korzeń klucza: `["event-speaker-materials", eventId, widz]`. */
export const speakerMaterialsKeys = {
  all: ["event-speaker-materials"] as const,
  event: (eventId: string) => ["event-speaker-materials", eventId] as const,
  forViewer: (eventId: string, viewerId: string | null) =>
    ["event-speaker-materials", eventId, viewerId ?? "anon"] as const,
};

export function publicSpeakerMaterialsQueryOptions(eventId: string, viewerId: string | null) {
  return queryOptions({
    queryKey: speakerMaterialsKeys.forViewer(eventId, viewerId),
    queryFn: () => fetchPublicSpeakerMaterials(eventId),
    staleTime: 60_000,
  });
}
