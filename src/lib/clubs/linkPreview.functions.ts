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
//   * woła ją wyłącznie ZALOGOWANY (bez tego serwer jest otwartym proxy
//     wyjścia na sieć dla każdego anonima) i tylko w limicie żądań,
//   * adres przechodzi przez wspólną bramkę egress `assertPublicHttpUrl`,
//     która ROZWIĄZUJE nazwę i odrzuca każdą odpowiedź DNS w zakresie
//     prywatnym/loopback/link-local/metadata. Lista zakazanych nazw, którą ta
//     funkcja miała wcześniej, była do obejścia jedną domeną wskazującą na
//     127.0.0.1,
//   * bramka wymusza https, więc podgląd nie powstanie dla `http://`. To jest
//     cena świadoma: ta funkcja ODDAJE fragmenty obcej odpowiedzi czytelnikowi,
//     a przy przewiązaniu DNS po kontroli (rebinding) TLS jest jedyną warstwą,
//     która nie wpuści nas do usługi wewnętrznej. Sam link w treści działa dalej,
//   * przekierowania są WYŁĄCZONE (`redirect: "manual"`) - inaczej publiczny
//     adres mógłby przekierować na 169.254.169.254,
//   * odpowiedź jest cięta do 256 kB i ma twardy limit czasu.
//
// Zwracamy `null` zamiast wyjątku przy każdym niepowodzeniu: brak podglądu
// nie ma prawa zablokować opublikowania wpisu.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
/** Podgląd jest leniwy (dopiero po najechaniu) i trzymany 10 minut na adres po
 *  stronie klienta, więc czytanie wątku nie zbliża się do tego progu. */
const PREVIEWS_PER_MINUTE = 30;

/** Cel podglądu albo `null`, gdy adres nie przechodzi bramki egress. */
export async function resolveClubPreviewTarget(raw: string): Promise<URL | null> {
  // Dynamiczny import: bramka stoi na `node:dns`, a ten moduł jest w grafie
  // klienta (useClubLinkPreview).
  const { assertPublicHttpUrl } = await import("@/lib/http/egressGuard.server");
  try {
    return await assertPublicHttpUrl(raw);
  } catch {
    return null;
  }
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
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"),
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
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }): Promise<ClubLinkPreview | null> => {
    const { rateLimit } = await import("@/lib/server/rate-limit.server");
    // FAIL-CLOSED, bo to bramka WYJŚCIA NA SIEĆ: awaria licznika nie może
    // otwierać serwera jako proxy - patrz rate-limit.server.ts.
    const allowed = await rateLimit({
      scope: "club.link-preview",
      subjectId: context.userId,
      max: PREVIEWS_PER_MINUTE,
      failClosed: true,
    });
    if (!allowed) return null;

    const target = await resolveClubPreviewTarget(data.url);
    if (target === null) return null;

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
