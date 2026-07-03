import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const MAX_CHARS = 5000;
const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_MODEL = "eleven_multilingual_v2";
// Explicit allowlist so an attacker cannot switch the request to a more
// expensive ElevenLabs model by supplying an arbitrary `model` string.
const ALLOWED_MODELS = new Set<string>([
  "eleven_multilingual_v2",
  "eleven_monolingual_v1",
  "eleven_turbo_v2",
  "eleven_turbo_v2_5",
]);

export type TtsBody = { text?: string; voiceId?: string; model?: string };
export type TtsNormalized =
  | { ok: true; safeText: string; voiceId: string; model: string }
  | { ok: false; error: string };

/**
 * Validate + normalize a TTS request body: trims text, applies voice/model
 * defaults, enforces a voiceId allowlist regex and clamps text length.
 * Exported for tests; the handler calls this before hitting ElevenLabs.
 */
export function normalizeTtsInput(body: TtsBody): TtsNormalized {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voiceId = typeof body.voiceId === "string" && body.voiceId.length > 0 ? body.voiceId : DEFAULT_VOICE;
  const model = typeof body.model === "string" && body.model.length > 0 ? body.model : DEFAULT_MODEL;
  if (!text) return { ok: false, error: "Missing text" };
  if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId)) return { ok: false, error: "Invalid voiceId" };
  if (!ALLOWED_MODELS.has(model)) return { ok: false, error: "Invalid model" };
  return { ok: true, safeText: text.slice(0, MAX_CHARS), voiceId, model };
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
          return new Response(JSON.stringify({ error: "TTS upstream error", status: upstream.status }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
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
