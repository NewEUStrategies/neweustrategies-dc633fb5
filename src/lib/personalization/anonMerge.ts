// Scalanie anonimowej personalizacji z kontem po zalogowaniu.
//
// Gość gromadzi na urządzeniu dwa zbiory danych:
//   - zainteresowania (kategorie/tagi) w localStorage "nes.interests.anon.v1",
//   - zapisane artykuły w localStorage "lovable:saved-articles".
//
// Poprzednia wersja merge'u żyła w useMyInterests i miała trzy wady, które ten
// moduł usuwa:
//   1. odpalała się tylko, gdy widżet zainteresowań był akurat zamontowany -
//      teraz merge wywołuje AuthProvider przy każdym SIGNED_IN,
//   2. robiła zwykły insert (duplikat = błąd całej partii) - teraz upsert z
//      ignoreDuplicates po kluczu unikalnym,
//   3. czyściła localStorage nawet gdy zapis się nie powiódł (utrata danych) -
//      teraz czyścimy wyłącznie po potwierdzonym sukcesie.
// Zakładki gościa (tylko url+tytuł) są rozwiązywane do postów po slugu
// (ostatni segment ścieżki) i lądują w user_bookmarks; pozycje nierozwiązane
// zostają na urządzeniu.
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const ANON_INTERESTS_KEY = "nes.interests.anon.v1";
const GUEST_SAVED_KEY = "lovable:saved-articles";

interface AnonInterests {
  categoryIds: string[];
  tagIds: string[];
}

interface GuestSavedItem {
  url: string;
  title: string;
  savedAt: number;
}

export interface AnonMergeResult {
  mergedInterests: number;
  mergedBookmarks: number;
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota - dane zostają do następnej próby */
  }
}

function readAnonInterests(): AnonInterests {
  const parsed = readJson<AnonInterests>(ANON_INTERESTS_KEY);
  return {
    categoryIds: Array.isArray(parsed?.categoryIds) ? parsed.categoryIds : [],
    tagIds: Array.isArray(parsed?.tagIds) ? parsed.tagIds : [],
  };
}

// Publiczny odczyt anonimowych zainteresowań - zasila tryb gościa
// rekomendera (get_recommended_posts_v2 przyjmuje jawne tablice id).
export function readAnonInterestIds(): AnonInterests {
  return readAnonInterests();
}

function readGuestSaved(): GuestSavedItem[] {
  const parsed = readJson<GuestSavedItem[]>(GUEST_SAVED_KEY);
  return Array.isArray(parsed) ? parsed.filter((s) => typeof s?.url === "string") : [];
}

// Ostatni segment ścieżki URL - slug posta niezależnie od tego, czy link był
// kanoniczny (/sekcja/slug) czy bezpośredni (/post/slug).
function slugFromUrl(url: string): string | null {
  try {
    const path = new URL(url, "https://placeholder.local").pathname;
    const seg = path.split("/").filter(Boolean).pop() ?? "";
    return seg.length > 0 ? decodeURIComponent(seg) : null;
  } catch {
    return null;
  }
}

async function mergeInterests(userId: string): Promise<number> {
  const anon = readAnonInterests();
  const rows = [
    ...anon.categoryIds.map((id) => ({
      user_id: userId,
      target_type: "category" as const,
      target_id: id,
    })),
    ...anon.tagIds.map((id) => ({
      user_id: userId,
      target_type: "tag" as const,
      target_id: id,
    })),
  ];
  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from("user_follows")
    .upsert(rows, { onConflict: "user_id,target_type,target_id", ignoreDuplicates: true });
  if (error) {
    console.warn("[anonMerge] interests merge failed, keeping local copy", error.message);
    return 0;
  }
  writeJson(ANON_INTERESTS_KEY, { categoryIds: [], tagIds: [] } satisfies AnonInterests);
  return rows.length;
}

async function mergeGuestBookmarks(userId: string): Promise<number> {
  const saved = readGuestSaved();
  if (saved.length === 0) return 0;

  const bySlug = new Map<string, GuestSavedItem>();
  for (const item of saved) {
    const slug = slugFromUrl(item.url);
    if (slug) bySlug.set(slug, item);
  }
  if (bySlug.size === 0) return 0;

  const { data: posts, error: postsError } = await supabase
    .from("posts")
    .select("id, slug")
    .in("slug", Array.from(bySlug.keys()));
  if (postsError || !posts?.length) {
    if (postsError) {
      console.warn("[anonMerge] bookmark slug resolution failed", postsError.message);
    }
    return 0;
  }

  const rows = posts.map((p) => ({
    user_id: userId,
    entity_type: "post" as const,
    entity_id: p.id,
  }));
  const { error } = await supabase
    .from("user_bookmarks")
    .upsert(rows, { onConflict: "user_id,entity_type,entity_id", ignoreDuplicates: true });
  if (error) {
    console.warn("[anonMerge] bookmarks merge failed, keeping local copy", error.message);
    return 0;
  }

  // Usuwamy z urządzenia tylko pozycje faktycznie scalone; nierozwiązane
  // (np. z innego tenanta / usunięte posty) zostają w localStorage.
  const mergedSlugs = new Set(posts.map((p) => p.slug));
  const remaining = saved.filter((item) => {
    const slug = slugFromUrl(item.url);
    return !slug || !mergedSlugs.has(slug);
  });
  writeJson(GUEST_SAVED_KEY, remaining);
  return rows.length;
}

// Jeden merge na (użytkownik, karta) na raz + pamięć udanych scaleń w ramach
// sesji karty, żeby SIGNED_IN emitowane przy powrocie fokusa nie powtarzało
// pracy. Dane wejściowe i tak są czyszczone po sukcesie, więc powtórka jest
// jedynie zbędnym round-tripem, nie błędem.
let inFlight: Promise<AnonMergeResult> | null = null;

export function hasAnonPersonalization(): boolean {
  const interests = readAnonInterests();
  return (
    interests.categoryIds.length > 0 || interests.tagIds.length > 0 || readGuestSaved().length > 0
  );
}

export async function mergeAnonPersonalization(
  userId: string,
  queryClient?: QueryClient,
): Promise<AnonMergeResult> {
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<AnonMergeResult> => {
    const [mergedInterests, mergedBookmarks] = await Promise.all([
      mergeInterests(userId),
      mergeGuestBookmarks(userId),
    ]);

    if (queryClient && (mergedInterests > 0 || mergedBookmarks > 0)) {
      // Wszystkie widoki czytające user_follows / user_bookmarks - obie
      // rodziny kluczy (useInterests i useFollows patrzą na tę samą tabelę).
      await Promise.all(
        [
          ["my-interests"],
          ["follows"],
          ["bookmarks"],
          ["profile-counts"],
          ["recommended-posts"],
          ["followed-feed"],
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    }

    return { mergedInterests, mergedBookmarks };
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}
