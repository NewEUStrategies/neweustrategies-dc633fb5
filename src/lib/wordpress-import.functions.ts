// WordPress.com importer via the platform connector gateway.
// Per-tenant, RLS-protected, lossless Gutenberg parsing.
//
// Public exports:
//   - listWpComSites: returns the WP.com sites accessible to the connected account
//   - previewWpComPosts: lists posts on a given site without writing anything
//   - createWpImportJob: creates a tracked job row and returns its id immediately
//   - runWpImportJob: executes a previously created job, streaming progress to DB
//   - getWpImportJob: polls a job (progress, log, final report)
//
// Background pattern:
//   client calls createWpImportJob (fast) -> gets jobId
//   client calls runWpImportJob (long-running, no need to await result)
//   client polls getWpImportJob during processing to render progress + log
//
// Sync mode (`sync_existing = true`) updates posts that were already imported
// instead of skipping them. "Already imported" is decided by the WordPress
// identity stored in `posts.custom_meta` (`wp_id` + `wp_site`); a slug match
// only counts for rows that carry no identity or the same one. Media import
// (`import_media = true`) downloads the featured image and every same-host
// <img> referenced in content, uploads to the `media` bucket and rewrites URLs
// in the imported HTML before parsing.
//
// CATEGORIES: WordPress categories are mapped to the session tenant's
// `categories` (created when missing, WordPress' "Uncategorized" skipped) and
// linked through `post_categories`. Sync only ADDS missing links - categories
// chosen by editors after the import are never removed.
//
// LANGUAGE CONTRACT: a job carries exactly ONE language (`data.language`). The
// imported side wins, the OTHER side is preserved verbatim - title, excerpt and
// blocks alike (see lib/wp-import/localizedMerge). Until this was wired in, a
// PL re-import blanked `title_en`/`excerpt_en` and replaced `blocks_data.en`
// with an empty document, silently destroying hand-written English versions;
// the pages stack (lib/wp-import.functions.ts) had merged correctly all along.

import { toJson } from "@/lib/builder/types";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { parseGutenberg } from "@/lib/blocks/gutenberg";
import {
  mergeLocalizedImport,
  serializeLocalizedBlocks,
  type ExistingLocalized,
  type LocalizedImport,
} from "@/lib/wp-import/localizedMerge";
import { recordAudit } from "./server/audit.server";
import { rateLimit } from "./server/rate-limit.server";
import { normalizeSourcePath, normalizeTargetPath } from "./seo/redirects";
import { brandedMediaUrl } from "@/lib/media/publicUrl";

/**
 * Redirect capture for the WP migration: map the ORIGINAL WordPress permalink
 * (wp.URL, e.g. "/2023/05/moj-wpis/") onto the new canonical path. Without
 * this every imported post loses its inbound links and search equity the
 * moment DNS flips. Upserts into the redirect manager; best-effort - an entry
 * failure must never fail the import job.
 */
async function captureWpRedirect(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
  wpUrl: string | undefined,
  newPath: string,
): Promise<boolean> {
  try {
    if (!wpUrl) return false;
    const source = normalizeSourcePath(wpUrl);
    // Internal path target only - the WP permalink maps onto our own URL.
    const target = normalizeTargetPath(newPath);
    if (!source || !target || source === target || source === "/") return false;
    const { error } = await supabase.from("redirects").upsert(
      {
        tenant_id: tenantId,
        source_path: source,
        target_path: target,
        status_code: 301,
        source: "wp_import",
        created_by: userId,
        is_enabled: true,
      },
      { onConflict: "tenant_id,source_path" },
    );
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.warn("[wp-import] redirect capture failed:", e);
    return false;
  }
}

const GATEWAY_URL = "https://connector-gateway.lovable.dev/wordpress_com";
const MAX_LOG_ENTRIES = 500;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const ALLOWED_MEDIA_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
]);

function authHeaders(): HeadersInit {
  const platformApiKey = process.env.LOVABLE_API_KEY;
  const wpKey = process.env.WORDPRESS_COM_API_KEY;
  if (!platformApiKey) throw new Error("LOVABLE_API_KEY is not configured");
  if (!wpKey)
    throw new Error(
      "WORDPRESS_COM_API_KEY is not configured - connect WordPress.com in Connectors",
    );
  return {
    Authorization: `Bearer ${platformApiKey}`,
    "X-Connection-Api-Key": wpKey,
    Accept: "application/json",
  };
}

async function wpFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${GATEWAY_URL}${path}`, { headers: authHeaders() });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WordPress.com API ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`WordPress.com API returned non-JSON: ${text.slice(0, 200)}`);
  }
}

// ---------- shared helpers ----------

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function resolveTenant(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data?.tenant_id) throw new Error("No tenant for current user");
  return data.tenant_id as string;
}

async function resolveBlogPage(
  supabase: SupabaseClient,
  tenantId: string,
  authorId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("pages")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("slug", "blog")
    .is("parent_id", null)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: created, error } = await supabase
    .from("pages")
    .insert({
      tenant_id: tenantId,
      author_id: authorId,
      slug: "blog",
      title_pl: "Blog",
      title_en: "Blog",
      status: "published",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message || "Cannot create default blog page");
  return created.id as string;
}

/**
 * Wolny slug dla NOWEGO wpisu z WordPressa. Sufiks kolizji niesie identyfikator
 * WordPressa (`-wp<ID>`), a nie kolejny numer: `-2`, `-3` to własna numeracja
 * WordPressa, więc nasz `moj-wpis-2` (drugi lokator `moj-wpis`) trafiał potem
 * w JEGO `moj-wpis-2` - i import dopasowywał po slugu cudzy artykuł. Sufiks
 * jest deterministyczny: ten sam wpis WP przy kolejnym biegu celuje w ten sam adres.
 */
async function ensureUniqueSlug(
  supabase: SupabaseClient,
  tenantId: string,
  desired: string,
  wpId: number,
): Promise<string> {
  const base = slugify(desired) || `wp-${Date.now().toString(36)}`;
  const tag = `-wp${wpId}`;
  const stem = base.slice(0, 120 - tag.length - 3).replace(/-+$/, "") || "wp";
  let candidate = base;
  for (let i = 0; i < 50; i += 1) {
    const { data, error } = await supabase
      .from("posts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("slug", candidate)
      .limit(1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return candidate;
    candidate = i === 0 ? `${stem}${tag}` : `${stem}${tag}-${i + 1}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// ---------- tożsamość wpisu WordPressa ----------

/**
 * Tożsamość wpisu WP zapisywana w `posts.custom_meta` (jsonb klucz -> STRING:
 * walidator `updatePost` przyjmuje wyłącznie wartości tekstowe do 200 znaków,
 * więc liczba zablokowałaby zapis wpisu w edytorze). To ona, a nie slug,
 * rozstrzyga przy kolejnym imporcie, czy wiersz jest „tym samym wpisem".
 */
type WpIdentity = {
  wp_id: string;
  wp_site: string;
};

function wpIdentityFor(siteHost: string, wpId: number): WpIdentity {
  return {
    wp_id: String(wpId),
    wp_site: siteHost
      .trim()
      .toLowerCase()
      .replace(/^www\./, "")
      .slice(0, 200),
  };
}

/** Tożsamość zapisana w wierszu; `null`, gdy wiersz nie pochodzi z importu z tożsamością. */
function readWpIdentity(meta: unknown): { wp_id: string; wp_site: string | null } | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const rec = meta as Record<string, unknown>;
  if (typeof rec.wp_id !== "string" || !rec.wp_id) return null;
  return { wp_id: rec.wp_id, wp_site: typeof rec.wp_site === "string" ? rec.wp_site : null };
}

/** `custom_meta` z dopisaną tożsamością - pozostałe klucze redakcji zostają. */
function withWpIdentity(meta: unknown, identity: WpIdentity): Record<string, string> {
  const base =
    meta && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, string>)
      : {};
  return { ...base, ...identity };
}

/** Istniejący wiersz w kształcie, jaki import czyta przed scaleniem. */
type ExistingWpRow = ExistingLocalized & {
  id: string;
  slug: string;
  cover_image_url: string | null;
  custom_meta: unknown;
};

interface ExistingWpLookup {
  row: ExistingWpRow | null;
  /** Wiersz ma zapisaną TĘ SAMĄ tożsamość WP - zgodność potwierdzona, nie zgadywana. */
  sameWpPost: boolean;
  /** Slug zajęty przez INNY wpis WordPressa (opis do logu); wtedy `row` jest null. */
  slugOwner: string | null;
}

/**
 * Czy ten wpis WP już jest w bazie? Najpierw tożsamość z `custom_meta`
 * (odporna na zmianę sluga po obu stronach), dopiero potem slug - i to tylko
 * wtedy, gdy wiersz NIE nosi tożsamości innego wpisu WP. Wiersze z koszem
 * (`deleted_at`) nie są „tym samym wpisem": nowy import nie wskrzesza ani nie
 * nadpisuje treści, którą redakcja usunęła.
 *
 * Wiersz bez tożsamości (import sprzed jej zapisywania albo wpis pisany ręcznie)
 * dopasowany po slugu zostaje uznany za ten sam wpis, ale `sameWpPost = false`:
 * scalenie nie zostawia wtedy jego zajawki przy pustej zapowiedzi z WordPressa.
 */
async function findExistingWpPost(
  supabase: SupabaseClient,
  tenantId: string,
  identity: WpIdentity,
  slug: string,
): Promise<ExistingWpLookup> {
  // Czytamy TAKŻE kolumny drugiego języka - import wchodzi zawsze
  // jednojęzycznie, a payload budowany „jakby drugiej wersji nie było" kasował
  // ją przy sync_existing (patrz lib/wp-import/localizedMerge).
  const { data: byIdentity, error: identityErr } = await supabase
    .from("posts")
    .select(
      "id, slug, custom_meta, cover_image_url, editor, title_pl, title_en, excerpt_pl, excerpt_en, blocks_data, builder_data",
    )
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .contains("custom_meta", identity)
    // Duplikat wpisu kopiuje custom_meta - wygrywa oryginał, nie kopia.
    .order("created_at", { ascending: true })
    .limit(1);
  if (identityErr) throw new Error(identityErr.message);
  const sameIdentityRow = (byIdentity as ExistingWpRow[] | null)?.[0];
  if (sameIdentityRow) return { row: sameIdentityRow, sameWpPost: true, slugOwner: null };

  const { data: bySlug, error: slugErr } = await supabase
    .from("posts")
    .select(
      "id, slug, custom_meta, cover_image_url, editor, title_pl, title_en, excerpt_pl, excerpt_en, blocks_data, builder_data",
    )
    .eq("tenant_id", tenantId)
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  // Błąd odczytu NIE jest „brakiem wpisu" - wstawienie obok istniejącego dałoby duplikat.
  if (slugErr) throw new Error(slugErr.message);
  const row = bySlug as ExistingWpRow | null;
  if (!row) return { row: null, sameWpPost: false, slugOwner: null };

  const stored = readWpIdentity(row.custom_meta);
  if (!stored) return { row, sameWpPost: false, slugOwner: null };
  if (stored.wp_id === identity.wp_id && stored.wp_site === identity.wp_site) {
    return { row, sameWpPost: true, slugOwner: null };
  }
  return { row: null, sameWpPost: false, slugOwner: `${stored.wp_site ?? "?"} #${stored.wp_id}` };
}

// ---------- WP.com response shapes ----------

interface WpSite {
  ID: number;
  name: string;
  description: string;
  URL: string;
  jetpack: boolean;
}
interface WpSitesResponse {
  sites: WpSite[];
}

/** Termin taksonomii WP.com (kategoria) - pola, z których korzysta import. */
interface WpTerm {
  ID?: number;
  name?: string;
  slug?: string;
  parent?: number;
}

interface WpPost {
  ID: number;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  status: string;
  date: string;
  modified: string;
  URL: string;
  featured_image: string | null;
  // REST v1.1 zwraca kategorie jako OBIEKT kluczowany nazwą
  // (`{ "Polityka": { ID, name, slug, ... } }`), a pusty zbiór bywa `[]`.
  categories?: Record<string, WpTerm> | WpTerm[] | null;
}
interface WpPostsResponse {
  found: number;
  posts: WpPost[];
}

// ---------- text helpers ----------

function decodeEntities(s: string): string {
  // `&amp;` OSTATNIE: tytuł z dosłownym tekstem „&lt;b&gt;" przychodzi z WP
  // jako `&amp;lt;b&amp;gt;` i nie może się rozwinąć dwa razy do znacznika.
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
    .replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}
function mapStatus(wp: string): "draft" | "published" | "archived" {
  if (wp === "publish") return "published";
  if (wp === "trash") return "archived";
  return "draft";
}

// ---------- kategorie ----------

// Domyślna kategoria WordPressa („Uncategorized" / „Bez kategorii") to brak
// decyzji redakcji, nie temat - przeniesiona tworzyłaby śmieciową kategorię.
const WP_DEFAULT_CATEGORY_SLUGS: ReadonlySet<string> = new Set(["uncategorized", "bez-kategorii"]);

function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Nazwa terminu z WP.com przychodzi z encjami HTML (`Polityka &amp; prawo`). */
function decodeTermName(s: string): string {
  return stripTags(s)
    .replace(/&#(\d+);/g, (_m, dec: string) => safeFromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .trim();
}

interface WpCategoryRef {
  slug: string;
  name: string;
}

/**
 * Kategorie wpisu WP w postaci lokalnej: slug po zdekodowaniu (`%c5%bc...`)
 * i tym samym `slugify`, którego używa reszta importu; bez kategorii domyślnej
 * i bez duplikatów (dwa terminy mogą się znormalizować do jednego sluga).
 */
function wpCategoryRefs(wp: WpPost): WpCategoryRef[] {
  const terms: unknown[] =
    wp.categories && typeof wp.categories === "object" ? Object.values(wp.categories) : [];
  const out = new Map<string, string>();
  for (const raw of terms) {
    if (!raw || typeof raw !== "object") continue;
    const term = raw as WpTerm;
    const name = decodeTermName(typeof term.name === "string" ? term.name : "");
    const slug =
      slugify(safeDecodeURIComponent(typeof term.slug === "string" ? term.slug : "")) ||
      slugify(name);
    if (!slug || WP_DEFAULT_CATEGORY_SLUGS.has(slug) || out.has(slug)) continue;
    out.set(slug, (name || slug).slice(0, 200));
  }
  return [...out].map(([slug, name]) => ({ slug, name }));
}

interface CategoryResolution {
  ids: string[];
  created: number;
  errors: string[];
}

/**
 * Mapowanie kategorii WP na lokalne `categories.id` najemcy z SESJI, z pamięcią
 * na cały bieg zadania: import 500 wpisów z dziesięcioma kategoriami robi kilka
 * zapytań, a nie 500 × 10. Na wpis co najwyżej jeden odczyt (`in("slug", ...)`)
 * i jeden zapis - wyłącznie dla slugów, których bieg jeszcze nie widział.
 *
 * Szukamy po (tenant_id, slug) BEZ filtra `kind`: unikalny indeks obejmuje
 * wszystkie wymiary taksonomii, więc istniejący region czy temat o tym slugu
 * i tak zablokowałby założenie duplikatu.
 *
 * Klient użytkownika, nie service_role: zakładanie kategorii to prawo
 * admina/redaktora (RLS). Autor importuje wpisy, ale brakujących kategorii nie
 * założy - wtedy podpinamy istniejące, a resztę raportujemy w logu zadania.
 */
function createCategoryResolver(supabase: SupabaseClient, tenantId: string) {
  const known = new Map<string, string>(); // slug -> categories.id
  // Kategorie, których nie udało się założyć - błąd raportujemy raz, zamiast
  // ponawiać (i logować) go przy każdym kolejnym wpisie.
  const unavailable = new Set<string>();

  const lookup = async (slugs: string[]): Promise<string | null> => {
    const { data, error } = await supabase
      .from("categories")
      .select("id, slug")
      .eq("tenant_id", tenantId)
      .in("slug", slugs);
    if (error) return error.message;
    for (const row of (data ?? []) as Array<{ id: string; slug: string }>) {
      known.set(row.slug, row.id);
    }
    return null;
  };

  return async function resolve(refs: WpCategoryRef[]): Promise<CategoryResolution> {
    const errors: string[] = [];
    let created = 0;
    const pending = refs.filter((r) => !known.has(r.slug) && !unavailable.has(r.slug));
    if (pending.length > 0) {
      const lookupErr = await lookup(pending.map((r) => r.slug));
      if (lookupErr) {
        // Przejściowy błąd odczytu nie blokuje kategorii na resztę biegu.
        errors.push(`lookup failed: ${lookupErr}`);
      } else {
        const missing = pending.filter((r) => !known.has(r.slug));
        if (missing.length > 0) {
          // ignoreDuplicates: kategoria założona równolegle (unikat tenant_id+slug)
          // nie wywraca całej paczki - dociągamy ją ponownym odczytem niżej.
          const { data: inserted, error: insErr } = await supabase
            .from("categories")
            .upsert(
              missing.map((r) => ({
                tenant_id: tenantId,
                slug: r.slug,
                name_pl: r.name,
                name_en: r.name,
                kind: "category",
              })),
              { onConflict: "tenant_id,slug", ignoreDuplicates: true },
            )
            .select("id, slug");
          if (insErr) {
            for (const r of missing) unavailable.add(r.slug);
            errors.push(
              `not created (${missing.map((r) => r.slug).join(", ")}): ${insErr.message}`,
            );
          } else {
            for (const row of (inserted ?? []) as Array<{ id: string; slug: string }>) {
              known.set(row.slug, row.id);
              created += 1;
            }
            const raced = missing.filter((r) => !known.has(r.slug));
            if (raced.length > 0) {
              const raceErr = await lookup(raced.map((r) => r.slug));
              const still = raced.filter((r) => !known.has(r.slug));
              for (const r of still) unavailable.add(r.slug);
              if (still.length > 0) {
                errors.push(
                  `not created (${still.map((r) => r.slug).join(", ")}): ${raceErr ?? "not visible after insert"}`,
                );
              }
            }
          }
        }
      }
    }
    const ids = refs.flatMap((r) => {
      const id = known.get(r.slug);
      return id ? [id] : [];
    });
    return { ids, created, errors };
  };
}

// ---------- media import ----------

const WP_HOST_RE = /(wp\.com|wordpress\.com|files\.wordpress\.com)$/i;

function isLikelyWpMediaUrl(url: string, siteHost: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return (
      u.host === siteHost || WP_HOST_RE.test(u.host) || /\.files\.wordpress\.com$/i.test(u.host)
    );
  } catch {
    return false;
  }
}

function extName(url: string, mime: string): string {
  const m = url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  if (m) return m[1].toLowerCase();
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  if (mime === "image/avif") return "avif";
  return "bin";
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface MediaImporter {
  importUrl(url: string): Promise<string>;
  count: number;
}

function createMediaImporter(opts: {
  tenantId: string;
  userId: string;
  siteHost: string;
}): MediaImporter {
  const cache = new Map<string, string>(); // sourceUrl -> publicUrl
  let count = 0;
  return {
    get count() {
      return count;
    },
    async importUrl(sourceUrl: string): Promise<string> {
      if (cache.has(sourceUrl)) return cache.get(sourceUrl)!;
      if (!isLikelyWpMediaUrl(sourceUrl, opts.siteHost)) return sourceUrl;
      // Lazy import of admin client (server-only).
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // SSRF guard: only fetch public https URLs. `redirect: "manual"` blocks
      // 30x hops to internal hosts after the pre-check.
      const { assertPublicHttpUrl } = await import("@/lib/http/egressGuard.server");
      await assertPublicHttpUrl(sourceUrl);
      const res = await fetch(sourceUrl, { redirect: "manual" });
      if (!res.ok) throw new Error(`fetch ${res.status} ${sourceUrl}`);
      const ct = (res.headers.get("content-type") || "application/octet-stream")
        .split(";")[0]
        .trim();
      if (!ALLOWED_MEDIA_MIME.has(ct)) throw new Error(`mime not allowed: ${ct}`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_MEDIA_BYTES)
        throw new Error(`file too large (${buf.byteLength} bytes)`);

      const hash = (await sha256Hex(buf)).slice(0, 32);
      const ext = extName(sourceUrl, ct);
      const path = `${opts.tenantId}/wp-import/${hash}.${ext}`;

      const { error: upErr } = await supabaseAdmin.storage
        .from("media")
        .upload(path, new Uint8Array(buf), { contentType: ct, upsert: true });
      if (upErr) throw new Error(`storage upload: ${upErr.message}`);

      const { data: pub } = supabaseAdmin.storage.from("media").getPublicUrl(path);
      const publicUrl = brandedMediaUrl(pub.publicUrl);

      // Best-effort row in `media`. Idempotent on path (unique not enforced, so we check).
      const { data: existing } = await supabaseAdmin
        .from("media")
        .select("id")
        .eq("storage_path", path)
        .maybeSingle();
      if (!existing?.id) {
        const filename =
          sourceUrl.split("/").pop()?.split("?")[0]?.slice(0, 200) || `${hash}.${ext}`;
        await supabaseAdmin.from("media").insert({
          tenant_id: opts.tenantId,
          uploader_id: opts.userId,
          storage_path: path,
          public_url: publicUrl,
          filename,
          mime_type: ct,
          size_bytes: buf.byteLength,
        });
      }

      cache.set(sourceUrl, publicUrl);
      count += 1;
      return publicUrl;
    },
  };
}

// Find all <img src="..."> and srcset entries that look like WP media for the site,
// import them, then rewrite URLs in-place. Returns the rewritten HTML.
async function rewriteHtmlMedia(
  html: string,
  importer: MediaImporter,
  siteHost: string,
  onError: (sourceUrl: string, err: unknown) => void,
): Promise<string> {
  const urls = new Set<string>();
  const re =
    /(src|href|data-src|data-large-file|data-medium-file|data-orig-file|poster)\s*=\s*"([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (isLikelyWpMediaUrl(m[2], siteHost)) urls.add(m[2]);
  }
  const reSrcset = /srcset\s*=\s*"([^"]+)"/gi;
  while ((m = reSrcset.exec(html)) !== null) {
    for (const part of m[1].split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url && isLikelyWpMediaUrl(url, siteHost)) urls.add(url);
    }
  }

  const map = new Map<string, string>();
  for (const u of urls) {
    try {
      const next = await importer.importUrl(u);
      if (next !== u) map.set(u, next);
    } catch (e) {
      onError(u, e);
    }
  }
  if (map.size === 0) return html;
  let out = html;
  for (const [from, to] of map) {
    // Global plain-string replace (avoid regex special chars).
    out = out.split(from).join(to);
  }
  return out;
}

// ---------- job log helpers ----------

type LogLevel = "info" | "warn" | "error";
interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  wp_id?: number;
}

interface JobPatch {
  log?: LogEntry[];
  processed?: number;
  imported?: number;
  updated_count?: number;
  skipped?: number;
  failed?: number;
  media_imported?: number;
  status?: "running" | "completed" | "failed" | "canceled";
  error?: string | null;
  total?: number;
  finished_at?: string | null;
}

async function readJobStatus(supabase: SupabaseClient, jobId: string): Promise<string | null> {
  const { data } = await supabase
    .from("wp_import_jobs")
    .select("status")
    .eq("id", jobId)
    .maybeSingle();
  return (data?.status as string | undefined) ?? null;
}

function firstContentImage(html: string): string | null {
  const m = html.match(/<img[^>]+src\s*=\s*"([^"]+)"/i);
  return m ? m[1] : null;
}

async function patchJob(supabase: SupabaseClient, jobId: string, patch: JobPatch): Promise<void> {
  const { error } = await supabase.from("wp_import_jobs").update(patch).eq("id", jobId);
  if (error) console.warn("[wp-import] job patch failed:", error.message);
}

class JobLogger {
  private buffer: LogEntry[] = [];
  constructor(
    private supabase: SupabaseClient,
    private jobId: string,
  ) {}
  async load(): Promise<void> {
    const { data } = await this.supabase
      .from("wp_import_jobs")
      .select("log")
      .eq("id", this.jobId)
      .maybeSingle();
    if (data?.log && Array.isArray(data.log)) {
      this.buffer = (data.log as unknown as LogEntry[]).slice(-MAX_LOG_ENTRIES);
    }
  }
  async push(level: LogLevel, msg: string, wp_id?: number): Promise<void> {
    this.buffer.push({ ts: new Date().toISOString(), level, msg, wp_id });
    if (this.buffer.length > MAX_LOG_ENTRIES) {
      this.buffer = this.buffer.slice(-MAX_LOG_ENTRIES);
    }
    await patchJob(this.supabase, this.jobId, { log: this.buffer });
  }
}

// ---------- public server functions ----------

export const listWpComSites = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async () => {
    try {
      const res = await wpFetch<WpSitesResponse>(
        "/rest/v1.1/me/sites?fields=ID,name,description,URL,jetpack",
      );
      return {
        sites: (res.sites ?? []).map((s) => ({
          id: s.ID,
          name: s.name,
          url: s.URL,
          description: s.description,
        })),
        warning: null as string | null,
      };
    } catch (e) {
      // Site-scoped OAuth tokens (the common case when the connector was authorized
      // for a single blog) cannot call /me/sites - WP.com returns 400
      // "authorization_required". Degrade gracefully so the UI still works.
      const msg = e instanceof Error ? e.message : String(e);
      return {
        sites: [] as Array<{ id: number; name: string; url: string; description: string }>,
        warning: msg,
      };
    }
  });

const ListInput = z.object({
  site: z.string().min(1).max(255),
  number: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).max(10_000).default(0),
  status: z.enum(["publish", "draft", "any"]).default("publish"),
  // Content type filter - default to "post" so pages/attachments are never imported by accident.
  type: z.enum(["post", "page", "any"]).default("post"),
});

export const previewWpComPosts = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data }) => {
    const site = encodeURIComponent(data.site);
    const qs = new URLSearchParams({
      number: String(data.number),
      offset: String(data.offset),
      status: data.status,
      type: data.type,
      fields: "ID,slug,title,excerpt,date,modified,URL,featured_image,status",
    });
    const res = await wpFetch<WpPostsResponse>(`/rest/v1.1/sites/${site}/posts?${qs.toString()}`);
    return {
      found: res.found,
      posts: (res.posts ?? []).map((p) => ({
        id: p.ID,
        slug: p.slug,
        title: stripTags(p.title),
        excerpt: stripTags(p.excerpt).slice(0, 240),
        date: p.date,
        status: p.status,
        url: p.URL,
        featured_image: p.featured_image,
      })),
    };
  });

// ---- jobs ----

const JobInput = ListInput.extend({
  language: z.enum(["pl", "en"]).default("pl"),
  only_ids: z.array(z.number().int()).max(100).optional(),
  sync_existing: z.boolean().default(false),
  import_media: z.boolean().default(false),
});

export const createWpImportJob = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((i: unknown) => JobInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!(await rateLimit({ scope: "wp.import", subjectId: userId, max: 10 }))) {
      throw new Error("Rate limit exceeded - please wait a minute before importing again");
    }
    const tenantId = await resolveTenant(supabase, userId);
    const { data: row, error } = await supabase
      .from("wp_import_jobs")
      .insert({
        tenant_id: tenantId,
        actor_id: userId,
        site: data.site,
        language: data.language,
        status: "running",
        options: toJson({
          number: data.number,
          offset: data.offset,
          status: data.status,
          type: data.type,
          sync_existing: data.sync_existing,
          import_media: data.import_media,
          only_ids: data.only_ids ?? null,
        }),
        log: toJson([
          {
            ts: new Date().toISOString(),
            level: "info",
            msg: `Job queued for ${data.site}`,
          },
        ]),
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message || "cannot create job");
    return { jobId: row.id as string };
  });

const RunInput = JobInput.extend({ jobId: z.string().uuid() });

export const runWpImportJob = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((i: unknown) => RunInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const tenantId = await resolveTenant(supabase, userId);

    // Verify job ownership (RLS already blocks cross-tenant reads, but be explicit).
    const { data: job } = await supabase
      .from("wp_import_jobs")
      .select("id, status, tenant_id")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job || job.tenant_id !== tenantId) throw new Error("Job not found");
    if (job.status !== "running") throw new Error(`Job already ${job.status}`);

    const logger = new JobLogger(supabase, data.jobId);
    await logger.load();

    let processed = 0;
    let imported = 0;
    let updated_count = 0;
    let skipped = 0;
    let failed = 0;

    try {
      const parentPageId = await resolveBlogPage(supabase, tenantId, userId);
      // Base path of imported posts (usually "blog") - the target side of the
      // old-permalink -> new-URL redirects captured per post below.
      const { data: parentPathRaw } = await supabase.rpc("page_full_path", {
        _page_id: parentPageId,
      });
      const parentPath = typeof parentPathRaw === "string" && parentPathRaw ? parentPathRaw : null;
      let redirects_created = 0;
      // Ile wpisów zachowało wersję w drugim języku - raportowane w podsumowaniu,
      // żeby „nie zgubiliśmy EN" było widoczne, a nie domniemane.
      let preserved_counterparts = 0;
      // Kategorie: nowo założone, podpięcia do wpisów i błędy (wpis wchodzi
      // mimo błędu kategorii - ale podsumowanie nie może udawać, że ich nie było).
      let categories_created = 0;
      let category_links = 0;
      let category_errors = 0;

      const site = encodeURIComponent(data.site);
      const qs = new URLSearchParams({
        number: String(data.number),
        offset: String(data.offset),
        status: data.status,
        type: data.type,
        fields: "ID,slug,title,excerpt,content,date,modified,URL,featured_image,status,categories",
      });
      await logger.push("info", `Fetching posts from ${data.site}…`);
      const res = await wpFetch<WpPostsResponse>(`/rest/v1.1/sites/${site}/posts?${qs.toString()}`);
      const filtered = data.only_ids
        ? res.posts.filter((p) => data.only_ids!.includes(p.ID))
        : res.posts;

      await patchJob(supabase, data.jobId, { total: filtered.length });
      await logger.push(
        "info",
        `Got ${filtered.length} posts to process (sync=${data.sync_existing}, media=${data.import_media}).`,
      );

      let siteHost = data.site;
      try {
        siteHost = new URL(data.site.startsWith("http") ? data.site : `https://${data.site}`).host;
      } catch {
        /* keep */
      }

      const importer = data.import_media
        ? createMediaImporter({ tenantId, userId, siteHost })
        : null;
      const resolveCategories = createCategoryResolver(supabase, tenantId);

      /**
       * Podpina kategorie WP do wpisu. Wyłącznie DOPISUJE brakujące powiązania
       * (ON CONFLICT DO NOTHING) - przy synchronizacji nigdy nie zdejmuje
       * kategorii, które redakcja nadała już po imporcie. Błąd nie przewraca
       * wpisu (treść jest już zapisana), ale trafia do logu i podsumowania.
       */
      const linkWpCategories = async (wp: WpPost, postId: string): Promise<void> => {
        const refs = wpCategoryRefs(wp);
        if (refs.length === 0) return;
        try {
          const resolved = await resolveCategories(refs);
          categories_created += resolved.created;
          for (const msg of resolved.errors) {
            category_errors += 1;
            await logger.push("warn", `Categories ${msg}`, wp.ID);
          }
          if (resolved.ids.length === 0) return;
          const { error } = await supabase.from("post_categories").upsert(
            resolved.ids.map((category_id) => ({ post_id: postId, category_id })),
            { onConflict: "post_id,category_id", ignoreDuplicates: true },
          );
          if (error) throw new Error(error.message);
          category_links += resolved.ids.length;
        } catch (e) {
          category_errors += 1;
          await logger.push(
            "error",
            `Categories not linked: ${e instanceof Error ? e.message : "unknown error"}`,
            wp.ID,
          );
        }
      };

      for (const wp of filtered) {
        // Cooperative cancellation: re-check status each iteration.
        const liveStatus = await readJobStatus(supabase, data.jobId);
        if (liveStatus === "canceled") {
          await logger.push("warn", "Import canceled by user.");
          await patchJob(supabase, data.jobId, {
            status: "canceled",
            finished_at: new Date().toISOString(),
          });
          return {
            jobId: data.jobId,
            status: "canceled" as const,
            processed,
            imported,
            updated_count,
            skipped,
            failed,
            media_imported: importer?.count ?? 0,
          };
        }

        try {
          // Slug w tej samej postaci, w jakiej trafia do bazy: porównanie SUROWEGO
          // sluga WP z zapisanym po `slugify` nie trafiało w wiersze, które
          // `slugify` zmienił, i każdy kolejny bieg dokładał duplikat.
          const desiredSlug =
            slugify(wp.slug || "") || slugify(stripTags(wp.title)) || `wp-${wp.ID}`;
          const identity = wpIdentityFor(siteHost, wp.ID);

          // Inline media (optional) - rewrite first so we can pick a cover from content if needed.
          let html = wp.content || "";
          if (importer && html) {
            html = await rewriteHtmlMedia(html, importer, siteHost, (u, err) => {
              void logger.push(
                "warn",
                `Media skipped ${u}: ${err instanceof Error ? err.message : "unknown"}`,
                wp.ID,
              );
            });
          }

          // Cover: normalize empty -> null, fallback to first content image.
          const rawCover = (wp.featured_image ?? "").trim();
          let coverUrl: string | null = rawCover.length > 0 ? rawCover : firstContentImage(html);
          if (coverUrl && importer) {
            try {
              coverUrl = await importer.importUrl(coverUrl);
            } catch (e) {
              await logger.push(
                "warn",
                `Cover image failed: ${e instanceof Error ? e.message : "unknown"}`,
                wp.ID,
              );
            }
          }

          const doc = parseGutenberg(html);
          const title = stripTags(wp.title);
          const excerpt = stripTags(wp.excerpt).slice(0, 1000);
          const incoming: LocalizedImport = {
            language: data.language,
            title,
            excerpt,
            doc,
          };

          const status = mapStatus(wp.status);

          const lookup = await findExistingWpPost(supabase, tenantId, identity, desiredSlug);
          const existing = lookup.row;
          if (lookup.slugOwner) {
            await logger.push(
              "info",
              `Slug ${desiredSlug} belongs to another WordPress post (${lookup.slugOwner}) - importing as a new post`,
              wp.ID,
            );
          }

          if (existing && !data.sync_existing) {
            skipped += 1;
            await logger.push(
              "info",
              `Skipped (${lookup.sameWpPost ? "already imported" : "slug exists"}): ${existing.slug}`,
              wp.ID,
            );
          } else if (existing && data.sync_existing) {
            const existingSlug = existing.slug;
            const prevCover = existing.cover_image_url ?? null;
            // Język importowany wygrywa, przeciwny zostaje nietknięty. Zajawka
            // wiersza przeżywa pustą zapowiedź z WP tylko przy potwierdzonej tożsamości.
            const merged = mergeLocalizedImport(incoming, existing, {
              sameWpPost: lookup.sameWpPost,
            });
            const { blocks_data, builder_data } = serializeLocalizedBlocks(merged.blocks);
            const { error: upErr } = await supabase
              .from("posts")
              .update({
                editor: "builder",
                status,
                published_at: status === "published" ? wp.date : null,
                cover_image_url: coverUrl,
                blocks_data,
                builder_data,
                title_pl: merged.title_pl,
                title_en: merged.title_en,
                excerpt_pl: merged.excerpt_pl,
                excerpt_en: merged.excerpt_en,
                // Wiersz dopasowany po slugu dostaje tożsamość teraz - kolejny
                // bieg rozpozna go już bez zgadywania.
                custom_meta: withWpIdentity(existing.custom_meta, identity),
              })
              .eq("id", existing.id)
              .eq("tenant_id", tenantId);
            if (upErr) throw new Error(upErr.message);
            updated_count += 1;
            if (merged.counterpartPreserved) {
              preserved_counterparts += 1;
              await logger.push(
                "info",
                `Kept existing ${merged.counterpart.toUpperCase()} version from ${merged.counterpartSource}: ${existingSlug}`,
                wp.ID,
              );
            }
            if (prevCover !== coverUrl) {
              await logger.push(
                "info",
                coverUrl ? `Cover updated: ${existingSlug}` : `Cover cleared: ${existingSlug}`,
                wp.ID,
              );
            }
            if (status === "published" && parentPath) {
              const made = await captureWpRedirect(
                supabase,
                userId,
                tenantId,
                wp.URL,
                `/${parentPath}/${existingSlug}`,
              );
              if (made) redirects_created += 1;
            }
            await logger.push("info", `Updated: ${existingSlug}`, wp.ID);
            await linkWpCategories(wp, existing.id);
            await recordAudit(supabase, {
              tenantId,
              action: "post.update",
              entityType: "post",
              entityId: existing.id as string,
              metadata: {
                source: "wordpress_com",
                wp_id: wp.ID,
                cover_changed: prevCover !== coverUrl,
                language: data.language,
                counterpart_preserved: merged.counterpartPreserved,
                counterpart_source: merged.counterpartSource,
              },
            });
          } else {
            const slug = await ensureUniqueSlug(supabase, tenantId, desiredSlug, wp.ID);
            // Nowy wpis - brak wersji do ocalenia, ale ta sama ścieżka budowania
            // payloadu (jedno miejsce, w którym powstaje para blocks/builder).
            const fresh = mergeLocalizedImport(incoming, null);
            const { blocks_data, builder_data } = serializeLocalizedBlocks(fresh.blocks);
            const { data: inserted, error } = await supabase
              .from("posts")
              .insert({
                tenant_id: tenantId,
                author_id: userId,
                slug,
                parent_page_id: parentPageId,
                editor: "builder",
                status,
                published_at: status === "published" ? wp.date : null,
                cover_image_url: coverUrl,
                blocks_data,
                builder_data,
                title_pl: fresh.title_pl,
                title_en: fresh.title_en,
                excerpt_pl: fresh.excerpt_pl,
                excerpt_en: fresh.excerpt_en,
                custom_meta: withWpIdentity(null, identity),
              })
              .select("id, slug")
              .single();
            if (error || !inserted) throw new Error(error?.message || "insert failed");
            imported += 1;
            if (status === "published" && parentPath) {
              const made = await captureWpRedirect(
                supabase,
                userId,
                tenantId,
                wp.URL,
                `/${parentPath}/${inserted.slug as string}`,
              );
              if (made) redirects_created += 1;
            }
            await logger.push("info", `Imported: ${inserted.slug as string}`, wp.ID);
            await linkWpCategories(wp, inserted.id as string);
            await recordAudit(supabase, {
              tenantId,
              action: "post.create",
              entityType: "post",
              entityId: inserted.id as string,
              metadata: { source: "wordpress_com", wp_id: wp.ID },
            });
          }
        } catch (e) {
          failed += 1;
          await logger.push("error", e instanceof Error ? e.message : "unknown error", wp.ID);
        } finally {
          processed += 1;
          await patchJob(supabase, data.jobId, {
            processed,
            imported,
            updated_count,
            skipped,
            failed,
            media_imported: importer?.count ?? 0,
          });
        }
      }

      await patchJob(supabase, data.jobId, {
        status: "completed",
        finished_at: new Date().toISOString(),
      });
      await logger.push(
        "info",
        `Done. imported=${imported}, updated=${updated_count}, skipped=${skipped}, failed=${failed}, media=${importer?.count ?? 0}, redirects=${redirects_created}, kept_other_language=${preserved_counterparts}, categories_created=${categories_created}, category_links=${category_links}, category_errors=${category_errors}`,
      );

      return {
        jobId: data.jobId,
        status: "completed" as const,
        processed,
        imported,
        updated_count,
        skipped,
        failed,
        media_imported: importer?.count ?? 0,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      await logger.push("error", `Job aborted: ${msg}`);
      await patchJob(supabase, data.jobId, {
        status: "failed",
        error: msg,
        finished_at: new Date().toISOString(),
      });
      throw e;
    }
  });

const GetJobInput = z.object({ jobId: z.string().uuid() });

export const getWpImportJob = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((i: unknown) => GetJobInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("wp_import_jobs")
      .select(
        "id, status, site, total, processed, imported, updated_count, skipped, failed, media_imported, log, error, created_at, finished_at",
      )
      .eq("id", data.jobId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Job not found");
    return row;
  });

// ---- cancel ----

const CancelInput = z.object({ jobId: z.string().uuid() });

export const cancelWpImportJob = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((i: unknown) => CancelInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const tenantId = await resolveTenant(supabase, userId);
    const { data: job } = await supabase
      .from("wp_import_jobs")
      .select("id, status, tenant_id")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job || job.tenant_id !== tenantId) throw new Error("Job not found");
    if (job.status !== "running") {
      return { jobId: data.jobId, status: job.status as string };
    }
    // Flip status; the runner polls and finalizes (writes finished_at and the
    // "canceled by user" log entry) on its next iteration.
    const { error } = await supabase
      .from("wp_import_jobs")
      .update({ status: "canceled" })
      .eq("id", data.jobId);
    if (error) throw new Error(error.message);
    await recordAudit(supabase, {
      tenantId,
      action: "wp_import.cancel",
      entityType: "wp_import_job",
      entityId: data.jobId,
    });
    return { jobId: data.jobId, status: "canceled" };
  });
