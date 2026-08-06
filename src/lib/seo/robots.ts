// Czysty builder robots.txt - wydzielony z trasy, żeby treść dała się objąć
// testem kontraktu (tak jak <head> w headContract.test.ts).
//
// PRZYCZYNA: trasa deklarowała na sztywno JEDNĄ sitemapę (`Sitemap: /sitemap.xml`),
// więc /news-sitemap.xml - trasa istniejąca i wymagana przez Google News - nie
// był odkrywalny żadnym kanałem. Builder przyjmuje listę sitemap, a wywołujący
// decyduje, które są włączone; test pilnuje, że kanoniczny host zawsze ogłasza
// przynajmniej indeks sitemapy.
//
// Trzech konsumentów, JEDEN builder: trasa (`src/routes/robots[.]txt.ts` przez
// `robotsRequest.server.ts`), test kontraktu i podgląd w panelu redakcji
// (`RobotsTxtPreview`). Redakcja widzi więc dokładnie ten sam plik, który
// dostaje crawler - a nie własną, rozjeżdżającą się reprezentację polityki.
import { cacheControlHeader } from "@/lib/http/cachePolicy";

export type RobotsMode =
  /** Kanoniczny host serwisu (marka albo domena tenanta): indeksowanie dozwolone. */
  | "canonical"
  /** Host podglądowy/legacy: pełny zakaz + komentarz wyjaśniający. */
  | "legacy"
  /** Nieznany host: bezpieczny domyślny zakaz. */
  | "unknown";

/**
 * Grupa reguł dla nazwanych user-agentów. Crawler stosuje TYLKO grupę, która
 * najlepiej pasuje do jego nazwy, więc reguły per agent (polityka crawlerów AI)
 * muszą być osobnymi blokami, a nie dopiskiem do grupy `*` - inaczej blokada
 * jednego bota wyłączyłaby indeksowanie wszystkim.
 */
export interface RobotsGroup {
  /** Nazwy user-agentów objęte tą grupą (pusta grupa jest pomijana). */
  readonly agents: readonly string[];
  /** Ścieżki zamknięte dla tych agentów ("/" = pełny zakaz). */
  readonly disallow: readonly string[];
  /** Wyjątki wewnątrz zakazu (dłuższy wzorzec Allow wygrywa nad Disallow). */
  readonly allow?: readonly string[];
}

export interface RobotsInput {
  mode: RobotsMode;
  /** Absolutny origin kanoniczny (bez ukośnika na końcu). */
  origin: string;
  /** Ścieżki sitemap do ogłoszenia (tylko dla mode="canonical"). */
  sitemapPaths?: readonly string[];
  /** Ścieżki zamknięte dla crawlerów (tylko dla mode="canonical"). */
  disallow?: readonly string[];
  /** Grupy per user-agent, np. polityka crawlerów AI (tylko dla mode="canonical"). */
  groups?: readonly RobotsGroup[];
}

/** Domyślnie zamknięte obszary: panel, API i ścieżki autoryzacji. */
export const ROBOTS_DEFAULT_DISALLOW: readonly string[] = ["/admin/", "/api/", "/auth/"];

/** Host z originu - do komentarza identyfikującego, dla kogo plik powstał. */
function hostFromOrigin(origin: string): string {
  const match = origin.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
  return match ? match[1] : origin;
}

function renderGroup(group: RobotsGroup): string[] | null {
  if (group.agents.length === 0) return null;
  const rules = [
    ...(group.allow ?? []).map((path) => `Allow: ${path}`),
    ...group.disallow.map((path) => `Disallow: ${path}`),
  ];
  // Grupa bez reguł nie jest polityką, tylko szumem, który crawler i tak
  // zignoruje - a przy `User-agent:` bez reguł niektóre parsery sklejają ją z
  // następną grupą, zmieniając znaczenie pliku.
  if (rules.length === 0) return null;
  return [...group.agents.map((agent) => `User-agent: ${agent}`), ...rules];
}

export function buildRobotsTxt(input: RobotsInput): string {
  if (input.mode !== "canonical") {
    const blocks =
      input.mode === "legacy"
        ? [
            ["# Legacy / preview host - not the canonical domain."],
            ["User-agent: *", "Disallow: /"],
          ]
        : [["User-agent: *", "Disallow: /"]];
    return render(blocks);
  }

  const disallow = input.disallow ?? ROBOTS_DEFAULT_DISALLOW;
  const origin = input.origin.replace(/\/+$/, "");
  // Kolejność deklaracji nie ma znaczenia dla crawlerów, ale deduplikacja ma:
  // ten sam adres dwa razy to bezsensowny podwójny crawl mapy.
  const sitemaps = Array.from(new Set(input.sitemapPaths ?? []));

  const blocks: string[][] = [
    // Komentarz nagłówkowy nie jest ozdobą: nazywa host, dla którego plik
    // POWSTAŁ, więc jednym spojrzeniem widać, czy odpowiedziała trasa (polityka
    // per host), czy statyczny plik z `public/` - dokładnie ten błąd przez
    // miesiące był niewidoczny (audyt 2026-08-06).
    [`# robots.txt for ${hostFromOrigin(origin)} - generated per request.`],
    ["User-agent: *", "Allow: /", ...disallow.map((path) => `Disallow: ${path}`)],
  ];

  for (const group of input.groups ?? []) {
    const rendered = renderGroup(group);
    if (rendered) blocks.push(rendered);
  }

  if (sitemaps.length > 0) {
    blocks.push(sitemaps.map((path) => `Sitemap: ${origin}${path}`));
  }

  return render(blocks);
}

/** Bloki rozdzielone jedną pustą linią, plik zamknięty jednym `\n`. */
function render(blocks: readonly string[][]): string {
  return `${blocks.map((block) => block.join("\n")).join("\n\n")}\n`;
}

/** Świeżość robots.txt na krawędzi (s). Plik zmienia się rzadko, ale zależy od
 *  ustawień redakcji - kilkuminutowy cache CDN + długie okno stale trzymają
 *  crawler na świeżej polityce bez ruchu do bazy na każde żądanie. */
export const ROBOTS_SHARED_MAX_AGE = 300;
export const ROBOTS_STALE_WHILE_REVALIDATE = 1800;

export interface RobotsHeadersInput {
  /** Czy host wolno indeksować (wynik klasyfikacji hosta). */
  readonly indexable: boolean;
  /**
   * Klasyfikacja niepewna - katalog domen był nieosiągalny, więc odpowiedź to
   * fail-closed "Disallow: /", a nie rozstrzygnięcie. Takiej odpowiedzi NIE
   * WOLNO cache'ować: chwilowa awaria bazy zamroziłaby zakaz indeksowania w
   * CDN i w Google na długo po tym, jak baza wróci.
   */
  readonly volatile?: boolean;
}

export function robotsHeaders(input: RobotsHeadersInput): Record<string, string> {
  return {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": input.volatile
      ? cacheControlHeader({ cacheable: false })
      : cacheControlHeader({
          cacheable: true,
          browserMaxAge: 0,
          sharedMaxAge: ROBOTS_SHARED_MAX_AGE,
          staleWhileRevalidate: ROBOTS_STALE_WHILE_REVALIDATE,
        }),
    // Dotyczy TEJ odpowiedzi (samego pliku), nie całego serwisu - polityka
    // serwisu jest w treści. Wartość jest jednocześnie najprostszym dowodem, że
    // /robots.txt wyszedł z workera: statyczny asset nigdy nie nosi tego
    // nagłówka, więc e2e potrafi wykryć ponowne przesłonięcie trasy.
    "X-Robots-Tag": input.indexable ? "all" : "noindex, nofollow",
  };
}
