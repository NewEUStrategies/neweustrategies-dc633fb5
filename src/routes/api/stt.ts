// Server-side speech-to-text via Lovable AI Gateway (openai/gpt-4o-mini-transcribe).
// Znacznie dokładniejsze rozpoznawanie PL/EN niż Web Speech API w przeglądarce.
// Wymaga zalogowania (żeby nie palić kredytów AI dla anonimowego ruchu),
// dodatkowo rate-limit per uzytkownik.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { rateLimit } from "@/lib/server/rate-limit.server";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB - krótkie dyktowanie/wyszukiwanie
const STT_LIMIT_PER_MINUTE = 20;
const STT_LIMIT_PER_HOUR = 200;
const ALLOWED_LANGS = new Set(["pl", "en", "auto"]);

export const Route = createFileRoute("/api/stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!token || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return json({ error: "Unauthorized" }, 401);
        }
        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

        const userId = userData.user.id;
        const [minuteOk, hourOk] = await Promise.all([
          rateLimit({
            scope: "stt.minute",
            subjectId: userId,
            max: STT_LIMIT_PER_MINUTE,
            failClosed: true,
          }),
          rateLimit({
            scope: "stt.hour",
            subjectId: userId,
            max: STT_LIMIT_PER_HOUR,
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

        const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
        if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

        let inbound: FormData;
        try {
          inbound = await request.formData();
        } catch {
          return json({ error: "Expected multipart/form-data" }, 400);
        }
        const file = inbound.get("file");
        if (!(file instanceof Blob)) return json({ error: "Missing audio file" }, 400);
        if (file.size === 0) return json({ error: "Empty audio" }, 400);
        if (file.size > MAX_BYTES) return json({ error: "Audio too large" }, 413);

        const requestedLang = String(inbound.get("lang") ?? "auto");
        const lang = ALLOWED_LANGS.has(requestedLang) ? requestedLang : "auto";

        const upstream = new FormData();
        upstream.append("model", "openai/gpt-4o-mini-transcribe");
        // Zachowaj oryginalne rozszerzenie/nazwę - OpenAI wnioskuje format
        // po nazwie pliku; niedopasowanie zwraca 400.
        const filename = (file as File).name || guessFilename(file.type);
        upstream.append("file", file, filename);
        if (lang !== "auto") upstream.append("language", lang);

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}` },
          body: upstream,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.error("STT upstream error", res.status, errText);
          return json(
            { error: "STT upstream error", status: res.status },
            res.status === 402 ? 402 : 502,
          );
        }
        const data = (await res.json()) as { text?: string };
        return json({ text: (data.text ?? "").trim() }, 200);
      },
    },
  },
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function guessFilename(mime: string): string {
  const base = mime.split(";")[0]?.trim() ?? "";
  const ext =
    base === "audio/webm"
      ? "webm"
      : base === "audio/mp4"
        ? "mp4"
        : base === "audio/mpeg"
          ? "mp3"
          : base === "audio/wav" || base === "audio/x-wav"
            ? "wav"
            : base === "audio/ogg"
              ? "ogg"
              : "webm";
  return `recording.${ext}`;
}
