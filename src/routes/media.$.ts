// Markowy adres publicznych mediów: /media/<ścieżka>. Nie ujawnia w interfejsie
// technicznego hosta magazynu, a pliki nadal korzystają z jego trwałości i cache.
import { createFileRoute } from "@tanstack/react-router";
import { mediaStoragePath } from "@/lib/media/publicUrl";

const PASSTHROUGH_HEADERS = ["content-type", "content-length", "etag", "last-modified"] as const;
// Odpowiedź 304 nie niesie ciała, więc `Content-Type`/`Content-Length` opisywałyby
// treść, której nie wysyłamy - zostają same walidatory cache.
const NOT_MODIFIED_HEADERS = ["etag", "last-modified"] as const;

// Nagłówki żądania, które muszą dojść do magazynu:
// - `Accept` - transformacja Supabase wybiera WebP WYŁĄCZNIE na jego podstawie
//   (parametr `format` zna tylko wartość `origin`). Bez przekazania markowa
//   ścieżka /media/* zawsze oddawałaby format oryginału.
// - `If-None-Match` / `If-Modified-Since` - pozwalają magazynowi odpowiedzieć
//   304 zamiast całego ciała po wygaśnięciu `max-age` w cache przeglądarki.
// - `Range` - przewijanie wideo.
// Wartości idą bez interpretacji (również `Accept: */*`) - negocjację prowadzi
// upstream, a każda nasza "poprawka" tylko rozjechałaby ją z tym, co wybierze.
const FORWARDED_REQUEST_HEADERS = [
  ["accept", "Accept"],
  ["if-none-match", "If-None-Match"],
  ["if-modified-since", "If-Modified-Since"],
  ["range", "Range"],
] as const;

function upstreamHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [incoming, outgoing] of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(incoming);
    if (value) headers[outgoing] = value;
  }
  return headers;
}

/**
 * Warianty rozmiarowe muszą działać pod markową domeną - inaczej miniatury
 * cofałyby się do technicznego hosta magazynu. Przepisujemy więc `width`,
 * `height`, `resize` i `quality` na endpoint transformacji obrazu.
 */
function imageTransform(url: URL): URLSearchParams | null {
  const clamp = (raw: string | null): number | null => {
    const value = Number(raw ?? "");
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.min(Math.round(value), 4000);
  };
  const width = clamp(url.searchParams.get("width"));
  const height = clamp(url.searchParams.get("height"));
  // Warianty szerokościowe (srcSet) podają tylko `width` - wysokość jest wtedy
  // wyliczana proporcjonalnie przez transformację magazynu.
  if (!width && !height) return null;
  const resize = url.searchParams.get("resize");
  const quality = Number(url.searchParams.get("quality") ?? "");
  const params = new URLSearchParams();
  if (width) params.set("width", String(width));
  if (height) params.set("height", String(height));
  if (resize === "cover" || resize === "contain" || resize === "fill") params.set("resize", resize);
  if (Number.isFinite(quality) && quality >= 20 && quality <= 100) {
    params.set("quality", String(Math.round(quality)));
  }
  return params;
}

async function serveMedia(request: Request, splat: string): Promise<Response> {
  const storagePath = mediaStoragePath(`/media/${splat}`);
  const storageOrigin = process.env.SUPABASE_URL;
  if (!storagePath || !storageOrigin) return new Response("Not found", { status: 404 });

  const transform = imageTransform(new URL(request.url));
  const encodedPath = storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const upstream = new URL(
    transform
      ? `/storage/v1/render/image/public/media/${encodedPath}?${transform.toString()}`
      : `/storage/v1/object/public/media/${encodedPath}`,
    storageOrigin,
  );
  const response = await fetch(upstream, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: upstreamHeaders(request),
  });
  // 304 to poprawna odpowiedź na żądanie warunkowe, nie brak pliku. Bez tego
  // wyjątku warunek poniżej zamieniłby odświeżenie cache w twarde 404.
  const notModified = response.status === 304;
  if (!notModified && !response.ok && response.status !== 206) {
    // Magazyn zgłasza brak obiektu również statusem 400 (`NoSuchKey`), dlatego
    // każdą odpowiedź 4xx traktujemy jako brak pliku - nie jako awarię serwera.
    const missing = response.status >= 400 && response.status < 500;
    return new Response("Not found", { status: missing ? 404 : 502 });
  }

  const headers = new Headers({
    "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    "X-Content-Type-Options": "nosniff",
    // Treść zależy od `Accept` (WebP kontra format oryginału). Bez `Vary` cache
    // brzegowy podałby WebP przeglądarce, która go nie obsługuje.
    Vary: "Accept",
  });
  for (const name of notModified ? NOT_MODIFIED_HEADERS : PASSTHROUGH_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  const contentRange = response.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);
  if (response.headers.get("accept-ranges")) headers.set("Accept-Ranges", "bytes");

  return new Response(request.method === "HEAD" || notModified ? null : response.body, {
    status: response.status,
    headers,
  });
}

export const Route = createFileRoute("/media/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => serveMedia(request, params._splat ?? ""),
      HEAD: ({ request, params }) => serveMedia(request, params._splat ?? ""),
    },
  },
});
