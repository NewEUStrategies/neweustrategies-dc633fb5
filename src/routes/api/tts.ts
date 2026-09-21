import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { rateLimit } from "@/lib/server/rate-limit.server";
import {
  DEFAULT_TTS_MODEL_ID,
  DEFAULT_TTS_VOICE_ID,
  isAllowedTtsModelId,
  isAllowedTtsVoiceId,
  TTS_MAX_CHARS,
} from "@/lib/audio/ttsCanonical";

// Trwały (DB-backed) budzet wywołań na uzytkownika: TTS pali płatną kwotę
// ElevenLabs, więc nawet uprawnione konto ma limit na minutę i na godzinę.
const TTS_LIMIT_PER_MINUTE = 6;
const TTS_LIMIT_PER_HOUR = 60;
// GŁOS, MODEL I LIMIT ZNAKÓW POCHODZĄ Z JEDNEGO ŹRÓDŁA - `lib/audio/ttsCanonical`.
//
// Do 2026-09-14 ta trasa miała własne trzy kopie tych wartości i wszystkie trzy
// rozjeżdżały się ze źródłem prawdy. Najdroższy był rozjazd modeli: lokalna lista
// wymieniała CZTERY pozycje (`eleven_multilingual_v2`, `eleven_monolingual_v1`,
// `eleven_turbo_v2`, `eleven_turbo_v2_5`), a kanoniczna `TTS_MODELS` ma DWIE -
// czyli dwa modele, których najemca nigdy nie wybrał, dawały się wymusić z ciała
// żądania. Głos był jeszcze słabiej pilnowany: regex `[A-Za-z0-9]{8,40}` sprawdzał
// KSZTAŁT identyfikatora, nie jego PRZYNALEŻNOŚĆ, więc przechodził dowolny głos
// ElevenLabs, także spoza sześciu opłaconych przez platformę.
//
// Przyczyna źródłowa jest ta sama, którą opisuje nagłówek `ttsCanonical.ts`:
// wybór głosu i modelu po stronie klienta mnoży płatne syntezy. Naprawiono to
// wtedy w `/api/public/post-tts` i pozostawiono nietkniętą tę drugą ścieżkę.
// Ten sam mechanizm konsumują już produkcyjnie `content.functions.ts` (refine
// schematu Zod) i `resolveTtsSettings` - trasa dołącza do nich, nie wprowadza
// nowego wzorca.

export type TtsBody = { text?: string; voiceId?: string; model?: string };
export type TtsNormalized =
  { ok: true; safeText: string; voiceId: string; model: string } | { ok: false; error: string };

/**
 * Validate + normalize a TTS request body: trims text, applies voice/model
 * defaults, enforces PRZYNALEŻNOŚĆ głosu i modelu do allowlisty kanonicznej
 * (nie sam ich kształt) i clamps text length.
 * Exported for tests; the handler calls this before hitting ElevenLabs.
 */
export function normalizeTtsInput(body: TtsBody): TtsNormalized {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voiceId =
    typeof body.voiceId === "string" && body.voiceId.length > 0
      ? body.voiceId
      : DEFAULT_TTS_VOICE_ID;
  const model =
    typeof body.model === "string" && body.model.length > 0 ? body.model : DEFAULT_TTS_MODEL_ID;
  if (!text) return { ok: false, error: "Missing text" };
  if (!isAllowedTtsVoiceId(voiceId)) return { ok: false, error: "Invalid voiceId" };
  if (!isAllowedTtsModelId(model)) return { ok: false, error: "Invalid model" };
  return { ok: true, safeText: text.slice(0, TTS_MAX_CHARS), voiceId, model };
}

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // SECURITY: require an authenticated Supabase user before spending
        // ElevenLabs quota on their behalf. Without this any unauthenticated
        // caller could exhaust the API key. Route runs with verify_jwt=false
        // by default, so we validate the bearer token in code.
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!token || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userData?.user) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        // SECURITY: TTS jest funkcją redakcyjną (generowanie audio w edytorze),
        // nie publiczną - wymagamy roli staff (admin/editor/author), tym samym
        // RPC SECURITY DEFINER co middleware requireStaff. Zwykłe konto
        // czytelnika nie może palić kwoty ElevenLabs.
        const { data: isStaff, error: staffErr } = await supabase.rpc("is_staff");
        if (staffErr || !isStaff) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Dwuoknowy limit per uzytkownik (minutowy chroni przed seriami,
        // godzinowy przed powolnym drenowaniem kwoty). FAIL-CLOSED: to jest
        // bramka kosztowa (płatna synteza ElevenLabs), więc awaria licznika
        // ma ODMAWIAĆ, a nie otwierać budżet - patrz rate-limit.server.ts.
        const userId = userData.user.id;
        const [minuteOk, hourOk] = await Promise.all([
          rateLimit({
            scope: "tts.minute",
            subjectId: userId,
            max: TTS_LIMIT_PER_MINUTE,
            failClosed: true,
          }),
          rateLimit({
            scope: "tts.hour",
            subjectId: userId,
            max: TTS_LIMIT_PER_HOUR,
            windowMinutes: 60,
            failClosed: true,
          }),
        ]);
        if (!minuteOk || !hourOk) {
          return new Response(JSON.stringify({ error: "Too Many Requests" }), {
            status: 429,
            headers: { "Content-Type": "application/json", "Retry-After": "60" },
          });
        }

        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: { text?: string; voiceId?: string; model?: string };
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const norm = normalizeTtsInput(body);
        if (!norm.ok) {
          return new Response(JSON.stringify({ error: norm.error }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const { safeText, voiceId, model } = norm;

        const upstream = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
          {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
            },
            body: JSON.stringify({
              text: safeText,
              model_id: model,
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                style: 0.3,
                use_speaker_boost: true,
              },
            }),
          },
        );

        if (!upstream.ok) {
          const errText = await upstream.text();
          console.error("ElevenLabs TTS error", upstream.status, errText);
          return new Response(
            JSON.stringify({ error: "TTS upstream error", status: upstream.status }),
            {
              status: 502,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        const audio = await upstream.arrayBuffer();
        return new Response(audio, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "public, max-age=86400",
          },
        });
      },
    },
  },
});
