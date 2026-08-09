// Podgląd linku wklejonego do wpisu klubowego (A31).
//
// DLACZEGO SERWER, A NIE PRZEGLĄDARKA. Pobranie cudzej strony z przeglądarki
// jest niemożliwe (CORS), a nawet gdyby było - metadane OpenGraph czyta się
// z HTML-a, więc klient musiałby ściągnąć cały dokument obcego serwisu do
// pamięci czytelnika. Serwer robi jedno żądanie, obcina odpowiedź i oddaje
// pięć pól tekstowych.
//
// SSRF. To jest funkcja, która na życzenie użytkownika wchodzi pod DOWOLNY
// adres, czyli klasyczna dziura na sieć wewnętrzną. Dlatego:
//   * tylko http/https,
//   * odrzucamy hosty lokalne i adresy z zakresów prywatnych,
//   * przekierowania są WYŁĄCZONE (`redirect: "manual"`) - inaczej publiczny
//     adres mógłby przekierować na 169.254.169.254,
//   * odpowiedź jest cięta do 256 kB i ma twardy limit czasu.
//
// Zwracamy `null` zamiast wyjątku przy każdym niepowodzeniu: brak podglądu
// nie ma prawa zablokować opublikowania wpisu.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  url: z.string().trim().url().max(2048),
});

export interface ClubLinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 6000;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
]);

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^127\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  return false;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function clean(value: string | null): string | null {
  if (value === null) return null;
  const text = decodeEntities(value).replace(/\s+/g, " ").trim();
  return text === "" ? null : text.slice(0, 300);
}

/** Wyciąga `content` znacznika meta po `property` LUB `name`, w obu kolejnościach
 *  atrybutów - realny HTML pisze je raz tak, raz tak. */
function readMeta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match !== null && typeof match[1] === "string") return match[1];
  }
  return null;
}

function absolute(candidate: string | null, base: URL): string | null {
  if (candidate === null) return null;
  try {
    const resolved = new URL(candidate, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

export const fetchClubLinkPreview = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<ClubLinkPreview | null> => {
    let target: URL;
    try {
      target = new URL(data.url);
    } catch {
      return null;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") return null;
    if (isBlockedHost(target.hostname)) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(target.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "NewEuropeanStrategiesBot/1.0 (+link-preview)",
        },
      });
      if (!response.ok) return null;
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("html")) return null;

      const reader = response.body?.getReader();
      if (reader === undefined) return null;
      const decoder = new TextDecoder();
      let html = "";
      let received = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        received += chunk.value.byteLength;
        html += decoder.decode(chunk.value, { stream: true });
        if (received >= MAX_BYTES) {
          await reader.cancel();
          break;
        }
      }

      const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
      return {
        url: target.toString(),
        title:
          clean(readMeta(html, "og:title")) ??
          clean(readMeta(html, "twitter:title")) ??
          clean(titleTag?.[1] ?? null),
        description:
          clean(readMeta(html, "og:description")) ??
          clean(readMeta(html, "twitter:description")) ??
          clean(readMeta(html, "description")),
        image: absolute(
          clean(readMeta(html, "og:image")) ?? clean(readMeta(html, "twitter:image")),
          target,
        ),
        siteName: clean(readMeta(html, "og:site_name")) ?? target.hostname,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
