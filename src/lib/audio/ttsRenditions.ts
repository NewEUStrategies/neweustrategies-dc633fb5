// Odczyt rejestru kanonicznych nagrań TTS dla panelu redakcyjnego.
//
// Wiersze `post_tts_renditions` pisze WYŁĄCZNIE serwer (service_role przez
// record_post_tts_rendition), a redakcja tylko je czyta - polityka RLS
// `post_tts_renditions_staff_select` zawęża odczyt do najemcy i roli staff,
// więc hook nie potrzebuje własnej server-function.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TtsLang } from "@/lib/audio/ttsCanonical";

export interface PostTtsRendition {
  lang: TtsLang;
  voice_id: string;
  model: string;
  content_hash: string;
  byte_size: number;
  char_count: number;
  synth_count: number;
  synthesized_at: string;
}

/** Nagrania wpisu w rozbiciu na języki (brak klucza = brak nagrania). */
export type PostTtsRenditionMap = Partial<Record<TtsLang, PostTtsRendition>>;

const postTtsRenditionsQueryKey = (postId: string): readonly unknown[] => [
  "post-tts-renditions",
  postId,
];

async function fetchPostTtsRenditions(postId: string): Promise<PostTtsRenditionMap> {
  const { data, error } = await supabase
    .from("post_tts_renditions")
    .select(
      "lang, voice_id, model, content_hash, byte_size, char_count, synth_count, synthesized_at",
    )
    .eq("post_id", postId);
  if (error) throw error;
  const map: PostTtsRenditionMap = {};
  for (const row of data ?? []) {
    if (row.lang !== "pl" && row.lang !== "en") continue;
    map[row.lang] = { ...row, lang: row.lang };
  }
  return map;
}

/**
 * Stan nagrań wpisu. `enabled` odcina zapytanie dla nowego, jeszcze nie
 * zapisanego wpisu (brak id) - inaczej edytor strzelałby zapytaniem o pusty
 * identyfikator przy każdym otwarciu formularza.
 */
export function usePostTtsRenditions(postId: string | null | undefined) {
  const id = postId ?? "";
  return useQuery({
    queryKey: postTtsRenditionsQueryKey(id),
    queryFn: () => fetchPostTtsRenditions(id),
    enabled: id.length > 0,
    staleTime: 30_000,
  });
}
