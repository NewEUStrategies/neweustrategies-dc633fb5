// Skaner linków wychodzących (B7). Server-only: czyta treści wpisów przez
// service role (kolumny body są odcięte dla klientów), wyciąga URL-e
// zewnętrzne ze wszystkich silników treści i sprawdza je z timeoutem.
// Rotacja: wpisy najdawniej sprawdzone najpierw (posts.outbound_links_checked_at),
// wołany małą porcją z jobs-tick (co minutę) i ręcznie z panelu.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  BROKEN_LINK_ALERT_THRESHOLD,
  parseWaybackAvailability,
  shouldAlertBrokenLinks,
  waybackAvailabilityUrl,
  type WaybackSnapshot,
} from "@/lib/content/brokenLinkPolicy";

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
/**
 * Maks. odpytań Wayback na jedną porcję. Migawki szukamy WYŁĄCZNIE dla linków,
 * które padły (a takich w zdrowym serwisie jest garść), ale wpis-katalog z
 * pięćdziesięcioma martwymi przypisami nie może zamienić ticku w odpytywanie
 * archive.org - resztę dobierze kolejny skan.
 */
const MAX_ARCHIVE_LOOKUPS_PER_BATCH = 15;
/** Timeout odpytania Wayback - krótszy niż sondy linku; to praca opcjonalna. */
const ARCHIVE_TIMEOUT_MS = 4_000;

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
): Promise<{ ok: boolean; status: number | null; error: string | null; refused: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let permitted = false;
  try {
    // SSRF guard: refuse private/loopback/link-local/cloud-metadata targets
    // before we make the request. `redirect: "manual"` prevents a 30x from
    // bouncing to an internal host after the pre-check.
    const { assertPublicHttpUrl } = await import("@/lib/http/egressGuard.server");
    await assertPublicHttpUrl(url);
    permitted = true;
    // GET, nie HEAD: częsta blokada HEAD (403/405) dawałaby fałszywe alarmy.
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "NES-LinkMonitor/1.0 (+https://neweuropeanstrategies.com)" },
    });
    // 403/429 traktujemy jako "żywe, ale bramkowane" - nie alarmujemy.
    // 3xx bez follow: link istnieje, zostawiamy jako ok.
    const gated = res.status === 403 || res.status === 429 || res.status === 999;
    const redirected = res.status >= 300 && res.status < 400;
    return {
      ok: res.status < 400 || gated || redirected,
      status: res.status,
      error: null,
      refused: false,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : String(err),
      refused: !permitted,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Migawka w Internet Archive dla martwego linku. Best-effort: brak migawki,
 * timeout albo błąd archive.org NIE może wywrócić skanu - panel i tak pokazuje
 * wtedy uniwersalny adres "znajdź najbliższą migawkę" (waybackSearchUrl).
 */
async function lookupArchiveSnapshot(url: string): Promise<WaybackSnapshot | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARCHIVE_TIMEOUT_MS);
  try {
    const res = await fetch(waybackAvailabilityUrl(url), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "NES-LinkMonitor/1.0 (+https://neweuropeanstrategies.com)",
      },
    });
    if (!res.ok) return null;
    return parseWaybackAvailability(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Alert progowy dla redakcji. Odzywa się do adminów tenanta, gdy liczba
 * zepsutych linków przekroczy próg - z histerezą po stronie `shouldAlertBrokenLinks`,
 * żeby nie zamienić alertu w szum. Best-effort: awaria powiadomienia nie może
 * unieważnić skanu, który już się wykonał.
 */
async function maybeAlertBrokenLinks(admin: DbClient, tenantId: string): Promise<boolean> {
  try {
    const [{ count }, { data: state }] = await Promise.all([
      admin
        .from("outbound_link_checks")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("ok", false),
      admin
        .from("outbound_link_alerts")
        .select("broken_count, notified_at")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);
    const brokenTotal = count ?? 0;
    if (
      !shouldAlertBrokenLinks({
        brokenTotal,
        lastNotifiedCount: state?.broken_count ?? null,
        lastNotifiedAt: state?.notified_at ?? null,
      })
    ) {
      // Stan i tak odświeżamy przy SPADKU liczby, żeby kolejny wzrost liczył
      // przyrost od świeżej bazy, a nie od historycznego szczytu.
      if (state && brokenTotal < state.broken_count) {
        await admin
          .from("outbound_link_alerts")
          .update({ broken_count: brokenTotal })
          .eq("tenant_id", tenantId);
      }
      return false;
    }

    const { data: admins } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .in("role", ["admin", "super_admin"]);
    const ids = [...new Set((admins ?? []).map((r) => r.user_id))];
    if (ids.length > 0) {
      await admin.from("notifications").insert(
        ids.map((userId) => ({
          user_id: userId,
          tenant_id: tenantId,
          kind: "seo",
          title_pl: "Zepsute linki w opublikowanych analizach",
          title_en: "Broken links in published analyses",
          body_pl: `Monitor linków wykrył ${brokenTotal} martwych odnośników zewnętrznych (próg: ${BROKEN_LINK_ALERT_THRESHOLD}). Otwórz monitor i podmień je na migawki Internet Archive.`,
          body_en: `The link monitor found ${brokenTotal} dead external links (threshold: ${BROKEN_LINK_ALERT_THRESHOLD}). Open the monitor and replace them with Internet Archive snapshots.`,
          href: "/admin/link-monitor",
          icon: "link-2-off",
        })),
      );
    }
    await admin
      .from("outbound_link_alerts")
      .upsert(
        { tenant_id: tenantId, broken_count: brokenTotal, notified_at: new Date().toISOString() },
        { onConflict: "tenant_id" },
      );
    return ids.length > 0;
  } catch (err) {
    console.warn("[link-monitor] threshold alert failed", err);
    return false;
  }
}

export interface LinkCheckResult {
  postsScanned: number;
  linksChecked: number;
  broken: number;
  /** Ile martwych linków dostało w tej porcji adres migawki archiwum. */
  archived: number;
  /** Tenanci, którym poszedł alert progowy. */
  alerted: number;
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
  if (posts.length === 0)
    return { postsScanned: 0, linksChecked: 0, broken: 0, archived: 0, alerted: 0 };

  const ownHosts = [
    "neweuropeanstrategies.com",
    "www.neweuropeanstrategies.com",
    "neweuropeanstrategies.com",
    "localhost",
  ] as const;

  let linksChecked = 0;
  let broken = 0;
  let archived = 0;
  let archiveLookups = 0;
  const tenantsTouched = new Set<string>();
  for (const post of posts) {
    tenantsTouched.add(post.tenant_id);
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

      // POLITYKA DZIAŁANIA: martwy przypis w analizie sprzed lat prawie nigdy
      // nie ma być usunięty - ma być podmieniony na migawkę. Szukamy jej tu, w
      // tle, żeby redakcja dostała gotowy adres, a nie zadanie "wklej URL do
      // Wayback Machine". Odpytujemy WYŁĄCZNIE dla linków, które padły.
      const snapshots = new Map<number, WaybackSnapshot | null>();
      const brokenIdx = slice
        .map((_, idx) => idx)
        .filter((idx) => !results[idx].ok && !results[idx].refused)
        .slice(0, Math.max(0, MAX_ARCHIVE_LOOKUPS_PER_BATCH - archiveLookups));
      if (brokenIdx.length > 0) {
        archiveLookups += brokenIdx.length;
        const found = await Promise.all(brokenIdx.map((idx) => lookupArchiveSnapshot(slice[idx])));
        brokenIdx.forEach((idx, i) => snapshots.set(idx, found[i]));
        archived += found.filter(Boolean).length;
      }

      const rows = slice.map((url, idx) => {
        const snapshot = snapshots.get(idx);
        return {
          tenant_id: post.tenant_id,
          post_id: post.id,
          url,
          ok: results[idx].ok,
          status_code: results[idx].status,
          error: results[idx].error,
          checked_at: new Date().toISOString(),
          // Link, który wrócił do życia, traci wpis o archiwum - inaczej panel
          // sugerowałby migawkę dla działającego odnośnika.
          archive_url: results[idx].ok ? null : (snapshot?.url ?? null),
          archive_timestamp: results[idx].ok ? null : snapshot?.timestamp || null,
          archive_checked_at:
            results[idx].ok || !snapshots.has(idx) ? null : new Date().toISOString(),
        };
      });
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

  // ALERT PROGOWY: liczymy stan CAŁEGO tenanta (nie tylko tej porcji) - rotacja
  // dotyka 6 wpisów na raz, więc "ile zepsutych linków ma serwis" można ocenić
  // wyłącznie globalnie. Po alercie zapisujemy watermark, żeby kolejne ticki
  // nie powtarzały tego samego powiadomienia.
  let alerted = 0;
  for (const tenantId of tenantsTouched) {
    if (await maybeAlertBrokenLinks(admin, tenantId)) alerted += 1;
  }

  return { postsScanned: posts.length, linksChecked, broken, archived, alerted };
}
