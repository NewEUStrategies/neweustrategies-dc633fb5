// Publiczny endpoint TTS dla wpisów. Renderuje audio (ElevenLabs) na podstawie
// treści wpisu ładowanej server-side (nie przyjmujemy tekstu od klienta - żeby
// atakujący nie mogli przepompowywać dowolnego tekstu przez naszą kwotę API).
//
// KONTRAKT WEJSCIA: `{ postId, lang }` i nic więcej. Głos i model są KANONICZNE
// per wpis i rozstrzygane WYŁĄCZNIE po stronie serwera (nadpisanie redakcyjne
// `posts.tts_voice_*` -> ustawienia najemcy `site_settings.reading` ->
// platformowa wartość domyślna). Pola `voiceId` / `model` w ciele żądania są
// świadomie IGNOROWANE, a nie odrzucane - stary klient nie ma się na czym
// wywalić, a mimo to nie kupi już drugiego wariantu.
//
// PRZYCZYNA ZRODLOWA usunięcia wyboru z klienta (audyt 2026-08-03): przy
// kluczu cache `(post, lang, voice, model, hash)` i wyborze po stronie klienta
// allowlista 6 głosów × 2 modele × 2 języki dawała do 24 PŁATNYCH syntez i 24
// plików na jeden wpis - dostępnych dla dowolnego anonimowego czytelnika pętlą
// po allowliście. Teraz na (wpis, język) istnieje dokładnie jedno nagranie:
// klucz główny `post_tts_renditions (post_id, lang)` + ścieżka obiektu bez
// głosu i modelu, nadpisywana przy zmianie treści albo głosu.
//
// Rate-limit: 3/min i 15/h per IP; 60/h globalnie per postId (klucze tekstowe
// wymagają rate_limits.subject_id typu text - migracja 20260711120000).
// Endpoint jest wyłącznie same-origin (brak nagłówków CORS): audio odtwarza
// nasz własny player, a otwarty CORS pozwalałby dowolnej obcej stronie
// przepalać kwotę ElevenLabs przeglądarkami odwiedzających.
// Post jest dodatkowo zawężany do tenanta wynikającego z hosta żądania -
// service role omija RLS, więc bez tego filtra treść tenanta A dałaby się
// syntezować przez domenę tenanta B.
import { createFileRoute } from "@tanstack/react-router";
import { getRequestIP } from "@tanstack/react-start/server";
import { rateLimit } from "@/lib/server/rate-limit.server";
import { trustedPublicHost } from "@/lib/http/requestHost";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import {
  TTS_MAX_CHARS,
  ttsRenditionEtag,
  type TtsLang,
  type TtsVoiceOverrides,
} from "@/lib/audio/ttsCanonical";
import {
  TTS_CACHE_BUCKET,
  coalesceTtsSynthesis,
  recordTtsRendition,
  resolveCanonicalTtsPlan,
  ttsContentHash,
} from "@/lib/server/tts.server";
import type { BlocksDoc, Block, Json, LocalizedBlocks } from "@/lib/blocks/types";
import type { Database } from "@/integrations/supabase/types";

interface PostTtsRequest {
  postId?: string;
  lang?: TtsLang;
}

function jsonError(status: number, message: string, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...(extra ?? {}) },
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function pickString(data: Record<string, Json> | undefined, key: string): string {
  const v = data?.[key];
  return typeof v === "string" ? v : "";
}

function blocksToText(doc: BlocksDoc | null | undefined): string {
  if (!doc?.blocks?.length) return "";
  const parts: string[] = [];
  for (const b of doc.blocks as Block[]) {
    const d = b.data ?? {};
    switch (b.type) {
      case "heading":
      case "paragraph":
      case "quote":
      case "pullquote":
      case "callout":
      case "preformatted":
      case "verse": {
        const t = pickString(d, "text") || pickString(d, "content") || pickString(d, "quote");
        if (t) parts.push(stripHtml(t));
        break;
      }
      case "list": {
        const items = Array.isArray(d.items) ? (d.items as Json[]) : [];
        for (const it of items) {
          if (typeof it === "string") parts.push(stripHtml(it));
          else if (it && typeof it === "object" && "text" in it) {
            const t = (it as { text?: unknown }).text;
            if (typeof t === "string") parts.push(stripHtml(t));
          }
        }
        break;
      }
      case "faq": {
        const items = Array.isArray(d.items) ? (d.items as Json[]) : [];
        for (const it of items) {
          if (it && typeof it === "object") {
            const q = (it as { q?: unknown }).q;
            const a = (it as { a?: unknown }).a;
            if (typeof q === "string") parts.push(stripHtml(q));
            if (typeof a === "string") parts.push(stripHtml(a));
          }
        }
        break;
      }
      case "html": {
        const t = pickString(d, "html");
        if (t) parts.push(stripHtml(t));
        break;
      }
      default:
        break;
    }
  }
  return parts.join(". ").replace(/\.\.+/g, ".").trim();
}

/** Błąd upstreamu ElevenLabs przenoszony przez koalescencję syntez. */
class TtsUpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`ElevenLabs ${status}`);
    this.name = "TtsUpstreamError";
  }
}

/**
 * Handler żądania syntezy. Wyniesiony z literału trasy jako NAZWANA funkcja,
 * żeby dało się przejechać tę samą ścieżkę w testach (konwencja repo:
 * `__handleForTests`, jak w webhooku płatności). Bez tego cała bramka dostępu,
 * rozstrzyganie kanonicznego głosu, cache w prywatnym buckecie i mapowanie
 * błędów dostawcy stały na ZERZE pokrycia - przy 129 mierzonych liniach.
 */
async function handlePostTtsRequest(request: Request): Promise<Response> {
  let body: PostTtsRequest;
  try {
    body = (await request.json()) as PostTtsRequest;
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  const postId = typeof body.postId === "string" ? body.postId.trim() : "";
  const lang: TtsLang = body.lang === "en" ? "en" : "pl";

  if (!/^[0-9a-f-]{8,64}$/i.test(postId)) {
    return jsonError(400, "Invalid postId");
  }

  // Pre-cache per-minute throttle: pure abuse protection (runs on every
  // request, including cache hits), so it stays FAIL-OPEN - a DB blip must
  // not block readers listening to already-cached audio. The cost-bearing
  // gates below (cache-miss only) are fail-closed.
  const ip = (() => {
    try {
      return getRequestIP({ xForwardedFor: true }) ?? "unknown";
    } catch {
      return "unknown";
    }
  })();
  const okMin = await rateLimit({
    scope: "post-tts:ip:min",
    subjectId: ip,
    max: 3,
    windowMinutes: 1,
  });
  if (!okMin) {
    return jsonError(429, "Rate limit exceeded (minute)", { "Retry-After": "60" });
  }
  // Budget-protecting limits (per-IP hourly + per-post) are applied later,
  // only on a cache MISS - a cache hit costs nothing and must never be
  // throttled. Only the tight per-minute limit above runs pre-cache, as
  // pure abuse protection. A reader listening to many already-cached
  // articles is legitimate traffic.

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return jsonError(503, "TTS not configured");
  }

  // Tenant hosta żądania: service role omija RLS, więc zakres nakładamy
  // jawnie (plan treści - nieznany host degraduje do tenanta domyślnego,
  // tak samo jak public_tenant_id() dla anonimowych zapytań).
  const tenantId = await resolveTenantIdForHost(await trustedPublicHost(request));
  if (!tenantId) {
    return jsonError(503, "Tenant directory unavailable");
  }

  // Ładowanie treści przez service role (server-only). `tts_voice_*` to
  // redakcyjne nadpisanie kanonicznego głosu - jedyne dopuszczone źródło
  // wariantu poza ustawieniami najemcy.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: post, error: postErr } = await supabaseAdmin
    .from("posts")
    .select(
      "id, title_pl, title_en, content_pl, content_en, blocks_data, status, tenant_id, tts_voice_pl, tts_voice_en",
    )
    .eq("id", postId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (postErr || !post) {
    return jsonError(404, "Post not found");
  }
  if (post.status !== "published") {
    // Ten sam kod co "brak wpisu" - 403 zdradzałoby istnienie szkicu.
    return jsonError(404, "Post not found");
  }

  // Paywall: gated posts (members/paid/password) must NOT be read aloud to
  // a caller without access - otherwise TTS is a full content-gate bypass.
  // `has_content_access` returns true for public/unset and for members/paid
  // only with a matching entitlement; `password` always returns false here,
  // so password-gated posts are conservatively not synthesized (no unlock
  // proof reaches this endpoint). Public posts stay open to anon callers.
  const { data: accessRow } = await supabaseAdmin
    .from("content_access")
    .select("mode")
    .eq("entity_type", "post")
    .eq("entity_id", postId)
    .maybeSingle();
  if (accessRow && accessRow.mode !== "public") {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    let entitled = false;
    if (token && supabaseUrl && supabasePublishableKey) {
      const { createClient } = await import("@supabase/supabase-js");
      // Client bound to the caller's JWT: has_content_access() reads auth.uid()
      // from it. An invalid/expired token makes the RPC run as anon -> false.
      const authed = createClient<Database>(supabaseUrl, supabasePublishableKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: allowed, error: accessErr } = await authed.rpc("has_content_access", {
        _entity_type: "post",
        _entity_id: postId,
      });
      entitled = !accessErr && allowed === true;
    }
    if (!entitled) {
      // Same 404 as unpublished/missing - never confirm a gated body via TTS.
      return jsonError(404, "Post not found");
    }
  }

  const title = lang === "en" ? post.title_en || post.title_pl : post.title_pl || post.title_en;
  const blocks = (post.blocks_data as LocalizedBlocks | null) ?? null;
  const doc = blocks ? (blocks[lang] ?? blocks.pl ?? blocks.en ?? null) : null;
  const fromBlocks = blocksToText(doc);
  const html =
    lang === "en"
      ? (post.content_en as string | null) || (post.content_pl as string | null)
      : (post.content_pl as string | null) || (post.content_en as string | null);
  const fromHtml = html ? stripHtml(html) : "";

  const text = [title, fromBlocks || fromHtml].filter(Boolean).join(". ").slice(0, TTS_MAX_CHARS);
  if (!text.trim()) {
    return jsonError(422, "No readable content");
  }

  // Hash pełnej treści (nie samej długości): zmiana artykułu = nowe
  // nagranie i nowy ETag. Głos i model są POZA hashem - trzyma je rejestr
  // nagrań, a do ETag-a wchodzą osobno.
  const contentHash = ttsContentHash(`${postId}:${lang}:${text}`);
  const overrides: TtsVoiceOverrides = {
    pl: post.tts_voice_pl,
    en: post.tts_voice_en,
  };
  const plan = await resolveCanonicalTtsPlan({
    tenantId,
    postId,
    lang,
    overrides,
    contentHash,
  });

  const etag = ttsRenditionEtag(contentHash, plan.pin);
  const audioHeaders = {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "private, max-age=86400",
    ETag: etag,
  } as const;

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: audioHeaders });
  }

  // Cache serwerowy: kanoniczne nagranie tego wpisu i języka. Podajemy je
  // tylko gdy rejestr potwierdza zgodność treści, głosu i modelu - stary
  // plik po zmianie głosu nie może wygrać z decyzją redakcji.
  if (plan.fresh) {
    try {
      const { data: cached } = await supabaseAdmin.storage
        .from(TTS_CACHE_BUCKET)
        .download(plan.storagePath);
      if (cached) {
        return new Response(cached, {
          status: 200,
          headers: { ...audioHeaders, "X-Tts-Cache": "hit" },
        });
      }
    } catch {
      // Brak obiektu (lub brak bucketa) = zwykła synteza poniżej.
    }
  }

  // Cache miss => we are about to spend ElevenLabs budget. Apply the
  // synthesis throttles now: per-IP hourly + per-post hourly. FAIL-CLOSED:
  // these gate real paid synthesis, so a counter-store outage must DENY
  // rather than let the budget be drained (rate-limit.server.ts).
  const okHour = await rateLimit({
    scope: "post-tts:ip:hour",
    subjectId: ip,
    max: 15,
    windowMinutes: 60,
    failClosed: true,
  });
  if (!okHour) {
    return jsonError(429, "Rate limit exceeded (hour)", { "Retry-After": "3600" });
  }
  const okPost = await rateLimit({
    scope: "post-tts:post:hour",
    subjectId: `${postId}:${lang}`,
    max: 60,
    windowMinutes: 60,
    failClosed: true,
  });
  if (!okPost) {
    return jsonError(429, "Post throttled", { "Retry-After": "3600" });
  }

  // Premiera artykułu: wielu czytelników trafia na zimny cache w tej samej
  // sekundzie. Koalescencja sprowadza to do JEDNEJ płatnej syntezy w
  // izolacie zamiast jednej na żądanie.
  let audio: ArrayBuffer;
  try {
    audio = await coalesceTtsSynthesis(plan.storagePath, async () => {
      const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${plan.pin.voiceId}?output_format=mp3_44100_128`;
      const upstream = await fetch(ttsUrl, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: plan.pin.model,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
          },
        }),
      });

      if (!upstream.ok) {
        const errBody = await upstream.text().catch(() => "");
        console.error(`[post-tts] ElevenLabs ${upstream.status}: ${errBody.slice(0, 300)}`);
        throw new TtsUpstreamError(upstream.status, errBody);
      }
      return upstream.arrayBuffer();
    });
  } catch (e) {
    if (e instanceof TtsUpstreamError) {
      if (/quota_exceeded/i.test(e.body)) {
        return jsonError(402, "TTS quota exceeded - uzupełnij kredyty ElevenLabs");
      }
      if (e.status === 429) {
        return jsonError(429, "TTS rate limited", { "Retry-After": "60" });
      }
      return jsonError(502, "TTS upstream failed");
    }
    console.error("[post-tts] synthesis failed:", e);
    return jsonError(502, "TTS upstream failed");
  }

  // Zapis do cache w tle - odpowiedź nie czeka na upload, a jego błąd
  // (np. brak bucketa w starym środowisku) nie psuje odtwarzania. Rejestr
  // nagrania aktualizujemy PO uploadzie, żeby nigdy nie wskazywał
  // obiektu, którego nie ma.
  void supabaseAdmin.storage
    .from(TTS_CACHE_BUCKET)
    .upload(plan.storagePath, audio, { contentType: "audio/mpeg", upsert: true })
    .then(async ({ error }) => {
      if (error) {
        console.warn(`[post-tts] cache write failed: ${error.message}`);
        return;
      }
      if (!plan.registryAvailable) return;
      await recordTtsRendition({
        postId,
        lang,
        pin: plan.pin,
        contentHash,
        storagePath: plan.storagePath,
        byteSize: audio.byteLength,
        charCount: text.length,
      });
    })
    .catch((e: unknown) => {
      console.warn(`[post-tts] cache write failed:`, e);
    });

  return new Response(audio, {
    status: 200,
    headers: { ...audioHeaders, "X-Tts-Cache": "miss" },
  });
}

/** Wejście dla testów - identyczna ścieżka jak trasa HTTP. */
export const __handleForTests = handlePostTtsRequest;

export const Route = createFileRoute("/api/public/post-tts")({
  server: {
    handlers: {
      POST: async ({ request }) => handlePostTtsRequest(request),
    },
  },
});
