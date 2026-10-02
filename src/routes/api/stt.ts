// Server-side speech-to-text via the platform AI gateway (openai/gpt-4o-mini-transcribe).
// Znacznie dokładniejsze rozpoznawanie PL/EN niż Web Speech API w przeglądarce.
// Wymaga zalogowania (żeby nie palić kredytów AI dla anonimowego ruchu),
// dodatkowo rate-limit per uzytkownik.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { rateLimit } from "@/lib/server/rate-limit.server";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB - krótkie dyktowanie/wyszukiwanie
// Zapas na nagłówki części multipart i pole `lang`. Deklarowany `Content-Length`
// sprawdzamy PRZED `formData()`, bo parser buforuje całe ciało w pamięci
// izolatu - limit sprawdzany dopiero na sparsowanym pliku przychodzi za późno.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
// Bramka płatnego dostawcy nie może wisieć bez końca: klient czeka na wynik
// dyktowania, a zawieszone żądanie nie kończy się żadnym kodem.
export const STT_UPSTREAM_TIMEOUT_MS = 60_000;
const STT_LIMIT_PER_MINUTE = 20;
const STT_LIMIT_PER_HOUR = 200;
const ALLOWED_LANGS = new Set(["pl", "en", "auto"]);
// Kontenery z MediaRecordera (webm/mp4 bywają oznaczane jako `video/*`).
// Wszystko inne (HTML, PDF, `application/octet-stream`) nie jest nagraniem
// i nie ma czego szukać u płatnego dostawcy transkrypcji.
const VIDEO_CONTAINERS = new Set(["video/webm", "video/mp4"]);

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

        const declaredLength = Number(request.headers.get("content-length") ?? "");
        if (declaredLength > MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
          return json({ error: "Audio too large" }, 413);
        }

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
        if (!isAudioMime(file.type)) return json({ error: "Unsupported audio type" }, 415);

        const requestedLang = String(inbound.get("lang") ?? "auto");
        const lang = ALLOWED_LANGS.has(requestedLang) ? requestedLang : "auto";

        const upstream = new FormData();
        upstream.append("model", "openai/gpt-4o-mini-transcribe");
        // Zachowaj oryginalne rozszerzenie/nazwę - OpenAI wnioskuje format
        // po nazwie pliku; niedopasowanie zwraca 400.
        const filename = (file as File).name || guessFilename(file.type);
        upstream.append("file", file, filename);
        if (lang !== "auto") upstream.append("language", lang);

        let res: Response;
        try {
          res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}` },
            body: upstream,
            signal: AbortSignal.timeout(STT_UPSTREAM_TIMEOUT_MS),
          });
        } catch (e) {
          // Zerwane połączenie albo przekroczony czas - bez tego wyjątek
          // wychodził z handlera jako nieobsłużony 500.
          const timedOut = e instanceof DOMException && e.name === "TimeoutError";
          console.error("STT upstream unreachable", e);
          return json(
            { error: timedOut ? "STT upstream timeout" : "STT upstream error" },
            timedOut ? 504 : 502,
          );
        }
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.error("STT upstream error", res.status, errText);
          return json(
            { error: "STT upstream error", status: res.status },
            res.status === 402 ? 402 : 502,
          );
        }
        let data: unknown;
        try {
          data = await res.json();
        } catch {
          return json({ error: "STT upstream error" }, 502);
        }
        return json({ text: transcriptText(data) }, 200);
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

function isAudioMime(mime: string): boolean {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return base.startsWith("audio/") || VIDEO_CONTAINERS.has(base);
}

/** Tekst transkrypcji z odpowiedzi dostawcy; brak pola = pusta transkrypcja. */
function transcriptText(data: unknown): string {
  if (typeof data === "object" && data !== null && "text" in data) {
    return typeof data.text === "string" ? data.text.trim() : "";
  }
  return "";
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
