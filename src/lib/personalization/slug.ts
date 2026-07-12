// Ostatni segment ścieżki URL - slug posta niezależnie od tego, czy link był
// kanoniczny (/sekcja/slug) czy bezpośredni (/post/slug). Wydzielone z
// anonMerge.ts do czystego modułu, żeby dało się je testować bez klienta
// Supabase (anonMerge importuje klienta na starcie modułu).
export function slugFromUrl(url: string): string | null {
  try {
    const path = new URL(url, "https://placeholder.local").pathname;
    const seg = path.split("/").filter(Boolean).pop() ?? "";
    return seg.length > 0 ? decodeURIComponent(seg) : null;
  } catch {
    return null;
  }
}
