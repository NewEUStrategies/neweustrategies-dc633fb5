// Okładka klubu - jedyna ścieżka wgrywania i zapisu.
//
// Dlaczego osobny moduł, a nie `uploadAndRegisterMedia`: tamta ścieżka
// rejestruje plik w tabeli `media`, a rejestracja wymaga roli redakcyjnej
// (admin/editor/author). Osoba prowadząca klub takiej roli mieć nie musi -
// i nie powinna jej dostawać tylko po to, żeby podmienić zdjęcie w nagłówku.
// Dlatego pliki lądują w wydzielonym prefiksie `club-covers/<clubId>/`, do
// którego polityka storage wpuszcza wyłącznie prowadzących kluby, a adres
// przechodzi jeszcze przez `club_set_cover`, które sprawdza uprawnienie do
// TEGO klubu i akceptuje wyłącznie adresy z naszego magazynu.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type SetCoverArgs = Database["public"]["Functions"]["club_set_cover"]["Args"];

/** Typy przyjmowane jako okładka - bez SVG (publiczny bucket, stored XSS). */
export const CLUB_COVER_MIME: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
];

export const CLUB_COVER_ACCEPT_ATTR = CLUB_COVER_MIME.join(",");

/** 8 MB - okładka to jeden baner, nie galeria. */
export const CLUB_COVER_MAX_BYTES = 8 * 1024 * 1024;

export type ClubCoverRejection =
  { kind: "mime"; mime: string } | { kind: "size"; sizeBytes: number; maxBytes: number };

export function checkClubCoverFile(file: {
  type: string;
  size: number;
}): ClubCoverRejection | null {
  if (!CLUB_COVER_MIME.includes(file.type)) return { kind: "mime", mime: file.type };
  if (file.size > CLUB_COVER_MAX_BYTES) {
    return { kind: "size", sizeBytes: file.size, maxBytes: CLUB_COVER_MAX_BYTES };
  }
  return null;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const raw = dot > 0 ? filename.slice(dot + 1) : "";
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 10) || "jpg"
  );
}

/** Klucz obiektu: `club-covers/<clubId>/<losowy>.<ext>` - zgodny z polityką. */
export function clubCoverObjectPath(args: {
  clubId: string;
  filename: string;
  uniqueSuffix?: string;
}): string {
  const unique = args.uniqueSuffix ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `club-covers/${args.clubId}/${unique}.${extensionOf(args.filename)}`;
}

/**
 * Wgrywa plik i zapisuje adres na klubie. Gdy zapis się nie powiedzie, obiekt
 * jest usuwany - inaczej w publicznym buckecie zostaje sierota, której nikt
 * już nie znajdzie.
 */
export async function uploadClubCover(args: { clubId: string; file: File }): Promise<string> {
  const path = clubCoverObjectPath({ clubId: args.clubId, filename: args.file.name });

  const { error: upErr } = await supabase.storage.from("media").upload(path, args.file, {
    cacheControl: "3600",
    upsert: false,
    contentType: args.file.type,
  });
  if (upErr) throw upErr;

  const { data: urlData } = supabase.storage.from("media").getPublicUrl(path);
  const publicUrl = urlData?.publicUrl ?? "";

  try {
    if (publicUrl === "") throw new Error("storage_public_url_missing");
    return await setClubCover({ clubId: args.clubId, url: publicUrl });
  } catch (error) {
    await supabase.storage
      .from("media")
      .remove([path])
      .catch(() => undefined);
    throw error;
  }
}

/** Zapis adresu okładki (`null` = zdjęcie okładki). Zwraca zapisaną wartość. */
export async function setClubCover(args: { clubId: string; url: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc("club_set_cover", {
    p_club_id: args.clubId,
    // NULL jest tu POPRAWNA wartoscia (zdjecie okladki) - wygenerowany typ jej
    // nie zna, wiec zawezamy jawnie zamiast klamac kompilatorowi `as string`.
    p_url: args.url as SetCoverArgs["p_url"],
  });
  if (error) throw error;
  return typeof data === "string" ? data : "";
}
