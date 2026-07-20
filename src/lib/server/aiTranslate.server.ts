// Tłumaczenie segmentów PL->EN przez bramkę AI Lovable (ten sam LOVABLE_API_KEY
// co gateway Resend w email.server.ts - zero nowych sekretów). Server-only.
//
// Kontrakt: wejście = tablica segmentów (mogą zawierać inline HTML/Markdown),
// wyjście = tablica tłumaczeń W TEJ SAMEJ kolejności i liczbie. Model dostaje
// segmenty jako JSON i MUSI odpowiedzieć czystą tablicą JSON - parsujemy
// defensywnie (zdejmujemy ewentualne płotki kodu), a niezgodność liczby
// segmentów jest twardym błędem (lepszy retry niż przesunięte tłumaczenia).
const GATEWAY_URL =
  process.env.AI_GATEWAY_URL || "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = process.env.AI_TRANSLATE_MODEL || "google/gemini-2.5-flash";

/** Budżet znaków jednej porcji (bezpieczny margines okna kontekstowego). */
const CHUNK_CHAR_BUDGET = 24_000;

const SYSTEM_PROMPT = [
  "You are a professional Polish-to-English translator for a geopolitical",
  "think tank (New European Strategies). Translate each segment into precise,",
  "idiomatic English suitable for policy analysis.",
  "Rules:",
  "- Preserve ALL inline HTML tags, attributes and Markdown syntax exactly;",
  "  translate only human-readable text.",
  "- Do not translate proper names, URLs, code or numbers.",
  "- Keep terminology consistent across segments.",
  "- Input is a JSON array of strings. Respond with ONLY a JSON array of the",
  "  translated strings, same length, same order. No commentary, no fences.",
].join("\n");

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1] : trimmed;
}

async function translateChunk(texts: readonly string[], apiKey: string): Promise<string[]> {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(texts) },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI gateway ${res.status}: ${detail.slice(0, 300)}`);
  }
  const payload = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI gateway returned empty completion");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(content));
  } catch {
    throw new Error("AI gateway returned non-JSON translation payload");
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("AI gateway returned malformed translation array");
  }
  if (parsed.length !== texts.length) {
    throw new Error(`AI gateway returned ${parsed.length} segments, expected ${texts.length}`);
  }
  return parsed as string[];
}

/** Dzieli segmenty na porcje wg budżetu znaków (kolejność zachowana). */
export function chunkSegments(texts: readonly string[], budget = CHUNK_CHAR_BUDGET): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const text of texts) {
    if (current.length > 0 && size + text.length > budget) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function translateSegmentsPlToEn(texts: readonly string[]): Promise<string[]> {
  if (texts.length === 0) return [];
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Tłumaczenie AI niedostępne: brak LOVABLE_API_KEY / AI translation unavailable",
    );
  }
  const out: string[] = [];
  // Sekwencyjnie (nie równolegle): spójność terminologii ważniejsza niż
  // kilka sekund, a gateway ma własne limity równoległości.
  for (const chunk of chunkSegments(texts)) {
    out.push(...(await translateChunk(chunk, apiKey)));
  }
  return out;
}
