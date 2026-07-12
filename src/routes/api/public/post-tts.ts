// Publiczny endpoint TTS dla wpisów. Renderuje audio (ElevenLabs) na podstawie
// treści wpisu ładowanej server-side (nie przyjmujemy tekstu od klienta - żeby
// atakujący nie mogli przepompowywać dowolnego tekstu przez naszą kwotę API).
//
// Rate-limit: 3/min i 15/h per IP; 60/h globalnie per postId (klucze tekstowe
// wymagają rate_limits.subject_id typu text - migracja 20260711120000).
// Endpoint jest wyłącznie same-origin (brak nagłówków CORS): audio odtwarza
// nasz własny player, a otwarty CORS pozwalałby dowolnej obcej stronie
// przepalać kwotę ElevenLabs przeglądarkami odwiedzających.
// Post jest dodatkowo zawężany do tenanta wynikającego z hosta żądania -
// service role omija RLS, więc bez tego filtra treść tenanta A dałaby się
// syntezować przez domenę tenanta B.
// Zsyntezowane MP3 trafia do prywatnego bucketa `tts-cache` (klucz = hash
// treści+głosu+modelu); kolejni słuchacze dostają plik z cache zamiast
// ponownej płatnej syntezy.
import { createFileRoute } from "@tanstack/react-router";
import { getRequestIP } from "@tanstack/react-start/server";
import { rateLimit } from "@/lib/server/rate-limit.server";
import { requestPublicHost } from "@/lib/http/requestHost";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import type { BlocksDoc, Block, Json, LocalizedBlocks } from "@/lib/blocks/types";

const MAX_CHARS = 5000;
const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // George
const DEFAULT_MODEL = "eleven_multilingual_v2";
const ALLOWED_MODELS = new Set(["eleven_multilingual_v2", "eleven_turbo_v2_5"]);
const ALLOWED_VOICES = new Set([
  "JBFqnCBsd6RMkjVDRZzb", // George
  "EXAVITQu4vr4xnSDxMaL", // Sarah
  "onwK4e9ZLuTAKqWW03F9", // Daniel
  "pFZP5JQG7iQjIQuC4Bku", // Lily
  "FGY2WhTYpPnrIDTdsKH5", // Laura
  "XrExE9yKIg1WjnnlVkGX", // Matilda
]);

interface PostTtsRequest {
  postId?: string;
  lang?: "pl" | "en";
  voiceId?: string;
  model?: string;
}

const TTS_CACHE_BUCKET = "tts-cache";

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

async function fnv1a(input: string): Promise<string> {
  // ETag: prosty hash bez zależności - stabilny między requestami.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16);
}

export const Route = createFileRoute("/api/public/post-tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: PostTtsRequest;
        try {
          body = (await request.json()) as PostTtsRequest;
        } catch {
          return jsonError(400, "Invalid JSON");
        }

        const postId = typeof body.postId === "string" ? body.postId.trim() : "";
        const lang: "pl" | "en" = body.lang === "en" ? "en" : "pl";
        const voiceId =
          body.voiceId && ALLOWED_VOICES.has(body.voiceId) ? body.voiceId : DEFAULT_VOICE;
        const model = body.model && ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;

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
        const tenantId = await resolveTenantIdForHost(requestPublicHost(request));
        if (!tenantId) {
          return jsonError(503, "Tenant directory unavailable");
        }

        // Ładowanie treści przez service role (server-only).
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: post, error: postErr } = await supabaseAdmin
          .from("posts")
          .select("id, title_pl, title_en, content_pl, content_en, blocks_data, status, tenant_id")
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

        const title =
          lang === "en" ? post.title_en || post.title_pl : post.title_pl || post.title_en;
        const blocks = (post.blocks_data as LocalizedBlocks | null) ?? null;
        const doc = blocks ? (blocks[lang] ?? blocks.pl ?? blocks.en ?? null) : null;
        const fromBlocks = blocksToText(doc);
        const html =
          lang === "en"
            ? (post.content_en as string | null) || (post.content_pl as string | null)
            : (post.content_pl as string | null) || (post.content_en as string | null);
        const fromHtml = html ? stripHtml(html) : "";

        const text = [title, fromBlocks || fromHtml].filter(Boolean).join(". ").slice(0, MAX_CHARS);
        if (!text.trim()) {
          return jsonError(422, "No readable content");
        }

        // Hash pełnej treści (nie samej długości): zmiana artykułu = nowy klucz
        // cache i nowy ETag.
        const contentHash = await fnv1a(`${postId}:${lang}:${voiceId}:${model}:${text}`);
        const etag = `"tts-${contentHash}"`;
        const audioHeaders = {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "private, max-age=86400",
          ETag: etag,
        } as const;

        const ifNoneMatch = request.headers.get("if-none-match");
        if (ifNoneMatch === etag) {
          return new Response(null, { status: 304, headers: audioHeaders });
        }

        // Cache serwerowy: ten sam artykuł+głos+model syntezujemy raz.
        const cachePath = `${postId}/${lang}-${voiceId}-${model}-${contentHash}.mp3`;
        try {
          const { data: cached } = await supabaseAdmin.storage
            .from(TTS_CACHE_BUCKET)
            .download(cachePath);
          if (cached) {
            return new Response(cached, {
              status: 200,
              headers: { ...audioHeaders, "X-Tts-Cache": "hit" },
            });
          }
        } catch {
          // Brak cache (lub brak bucketa) = zwykła synteza poniżej.
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

        const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
        const upstream = await fetch(ttsUrl, {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: model,
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
          if (/quota_exceeded/i.test(errBody)) {
            return jsonError(402, "TTS quota exceeded - uzupełnij kredyty ElevenLabs");
          }
          if (upstream.status === 429) {
            return jsonError(429, "TTS rate limited", { "Retry-After": "60" });
          }
          return jsonError(502, "TTS upstream failed");
        }

        const audio = await upstream.arrayBuffer();

        // Zapis do cache w tle - odpowiedź nie czeka na upload, a jego błąd
        // (np. brak bucketa w starym środowisku) nie psuje odtwarzania.
        void supabaseAdmin.storage
          .from(TTS_CACHE_BUCKET)
          .upload(cachePath, audio, { contentType: "audio/mpeg", upsert: true })
          .then(({ error }) => {
            if (error) console.warn(`[post-tts] cache write failed: ${error.message}`);
          })
          .catch((e: unknown) => {
            console.warn(`[post-tts] cache write failed:`, e);
          });

        return new Response(audio, {
          status: 200,
          headers: { ...audioHeaders, "X-Tts-Cache": "miss" },
        });
      },
    },
  },
});
