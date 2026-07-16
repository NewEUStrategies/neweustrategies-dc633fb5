// Server function do "regeneracji" og:image po zmianie danych profilu.
// Nie generujemy tu nowego pliku - avatar wgrywa użytkownik. Sedno:
// bumpujemy `profiles.updated_at`, dzięki czemu wersja doklejana do
// og:image (`?v=<epoch>`) rośnie i social scrapery pobierają świeże
// dane po ping'u w Post Debuggerze. Zwracamy też listę URL-i (PL/EN)
// oraz gotowe adresy debuggerów, żeby panel autora mógł je otworzyć.
//
// Bezpieczeństwo: `.middleware([requireSupabaseAuth])` - właściciel bumpuje
// wyłącznie SWÓJ wiersz (RLS + `auth.uid()`), żadnego payloadu.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequestUrl } from "@tanstack/react-start/server";

export interface RefreshOgResult {
  ok: boolean;
  version: number;
  urls: { pl: string; en: string } | null;
  debuggers: {
    facebook: string;
    linkedin: string;
    twitter: string;
  } | null;
}

export const refreshAuthorOgImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RefreshOgResult> => {
    const { supabase, userId } = context;

    // Bump `updated_at` - trigger `profiles_set_updated_at` może to zrobić,
    // ale wystarczy nam jawny UPDATE (RLS wymusza `id = auth.uid()`).
    // Zwracamy `updated_at` i `slug`, żeby złożyć debug URL bez drugiego zapytania.
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("profiles")
      .update({ updated_at: nowIso })
      .eq("id", userId)
      .select("slug, updated_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, version: 0, urls: null, debuggers: null };

    const row = data as { slug: string | null; updated_at: string | null };
    if (!row.slug) return { ok: true, version: 0, urls: null, debuggers: null };

    const version = row.updated_at ? Date.parse(row.updated_at) : Date.now();
    const reqUrl = getRequestUrl();
    const origin = reqUrl ? new URL(reqUrl).origin : "https://neweustrategies.lovable.app";
    const plUrl = `${origin}/author/${row.slug}`;
    const enUrl = `${origin}/en/author/${row.slug}`;

    return {
      ok: true,
      version,
      urls: { pl: plUrl, en: enUrl },
      debuggers: {
        // Facebook / LinkedIn / X Post Debugger - użytkownik jednym kliknięciem
        // wymusza rescrape po naszym bumpie `updated_at`.
        facebook: `https://developers.facebook.com/tools/debug/?q=${encodeURIComponent(plUrl)}`,
        linkedin: `https://www.linkedin.com/post-inspector/inspect/${encodeURIComponent(plUrl)}`,
        twitter: `https://cards-dev.twitter.com/validator?url=${encodeURIComponent(plUrl)}`,
      },
    };
  });
