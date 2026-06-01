import { createFileRoute } from "@tanstack/react-router";

const MAX_CHARS = 5000;

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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

        const text = typeof body.text === "string" ? body.text.trim() : "";
        const voiceId = typeof body.voiceId === "string" && body.voiceId.length > 0
          ? body.voiceId
          : "JBFqnCBsd6RMkjVDRZzb";
        const model = typeof body.model === "string" && body.model.length > 0
          ? body.model
          : "eleven_multilingual_v2";

        if (!text) {
          return new Response(JSON.stringify({ error: "Missing text" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId)) {
          return new Response(JSON.stringify({ error: "Invalid voiceId" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const safeText = text.slice(0, MAX_CHARS);

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
