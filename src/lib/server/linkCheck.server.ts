// Skaner linków wychodzących (B7). Server-only: czyta treści wpisów przez
// service role (kolumny body są odcięte dla klientów), wyciąga URL-e
// zewnętrzne ze wszystkich silników treści i sprawdza je z timeoutem.
// Rotacja: wpisy najdawniej sprawdzone najpierw (posts.outbound_links_checked_at),
// wołany małą porcją z jobs-tick (co minutę) i ręcznie z panelu.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type DbClient = SupabaseClient<Database>;

const URL_RE = /https?:\/\/[^\s"'<>\\)\]}]+/g;
/** Maks. linków sprawdzanych per wpis (ochrona przed wpisami-katalogami). */
const MAX_LINKS_PER_POST = 50;
/** Timeout pojedynczego żądania. */
const FETCH_TIMEOUT_MS = 6_000;
/** Równoległość żądań w ramach porcji. */
const CONCURRENCY = 5;
/** Ponowny skan wpisu nie częściej niż co tydzień. */
const RECHECK_AFTER_DAYS = 7;

/** Hosty pomijane (własne treści sprawdza monitor 404 od strony ruchu). */
function isExternal(url: string, ownHosts: readonly string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !ownHosts.some((own) => host === own || host.endsWith(`.${own}`));
  } catch {
    return false;
  }
}

export function extractExternalUrls(
  parts: Array<string | null | undefined>,
  ownHosts: readonly string[],
): string[] {
  const found = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const raw of part.match(URL_RE) ?? []) {
      // Utnij ogonki interpunkcji/encji typowe dla HTML/JSON.
      const url = raw.replace(/[.,;:!?]+$/, "").replace(/&(amp|quot|#39);.*$/, "");
      if (url.length <= 2048 && isExternal(url, ownHosts)) found.add(url);
      if (found.size >= MAX_LINKS_PER_POST) break;
    }
  }
  return [...found];
}

async function probe(
  url: string,
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // GET, nie HEAD: częsta blokada HEAD (403/405) dawałaby fałszywe alarmy.
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "NES-LinkMonitor/1.0 (+https://neweuropeanstrategies.com)" },
    });
    // 403/429 traktujemy jako "żywe, ale bramkowane" - nie alarmujemy.
    const gated = res.status === 403 || res.status === 429 || res.status === 999;
    return { ok: res.status < 400 || gated, status: res.status, error: null };
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export interface LinkCheckResult {
  postsScanned: number;
  linksChecked: number;
  broken: number;
}

export async function runLinkCheckBatch(admin: DbClient, postsLimit = 3): Promise<LinkCheckResult> {
  const dueBefore = new Date(Date.now() - RECHECK_AFTER_DAYS * 24 * 3_600_000).toISOString();
  const { data: due, error } = await admin
    .from("posts")
    .select("id, tenant_id, content_pl, content_en, builder_data, blocks_data")
    .eq("status", "published")
    .is("deleted_at", null)
    .or(`outbound_links_checked_at.is.null,outbound_links_checked_at.lt.${dueBefore}`)
    .order("outbound_links_checked_at", { ascending: true, nullsFirst: true })
    .limit(postsLimit);
  if (error) throw error;
  const posts = due ?? [];
  if (posts.length === 0) return { postsScanned: 0, linksChecked: 0, broken: 0 };

  const ownHosts = [
    "neweuropeanstrategies.com",
    "neweustrategies.lovable.app",
    "localhost",
  ] as const;

  let linksChecked = 0;
  let broken = 0;
  for (const post of posts) {
    const urls = extractExternalUrls(
      [
        post.content_pl,
        post.content_en,
        post.builder_data ? JSON.stringify(post.builder_data) : null,
        post.blocks_data ? JSON.stringify(post.blocks_data) : null,
      ],
      ownHosts,
    );
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const slice = urls.slice(i, i + CONCURRENCY);
      const results = await Promise.all(slice.map((url) => probe(url)));
      linksChecked += slice.length;
      const rows = slice.map((url, idx) => ({
        tenant_id: post.tenant_id,
        post_id: post.id,
        url,
        ok: results[idx].ok,
        status_code: results[idx].status,
        error: results[idx].error,
        checked_at: new Date().toISOString(),
      }));
      broken += results.filter((r) => !r.ok).length;
      const { error: upsertErr } = await admin
        .from("outbound_link_checks")
        .upsert(rows, { onConflict: "post_id,url" });
      if (upsertErr) console.warn("[link-monitor] upsert failed", upsertErr.message);
    }
    // Linki usunięte z treści znikają z raportu przy kolejnym skanie.
    if (urls.length > 0) {
      await admin
        .from("outbound_link_checks")
        .delete()
        .eq("post_id", post.id)
        .not("url", "in", `(${urls.map((u) => `"${u.replace(/"/g, "")}"`).join(",")})`);
    } else {
      await admin.from("outbound_link_checks").delete().eq("post_id", post.id);
    }
    await admin
      .from("posts")
      .update({ outbound_links_checked_at: new Date().toISOString() })
      .eq("id", post.id);
  }
  return { postsScanned: posts.length, linksChecked, broken };
}
