// Pomocnicze funkcje tożsamości dla zaproszeń użytkowników:
//  - inicjały wyliczane z imienia i nazwiska (fallback awataru w modalce),
//  - normalizacja adresu profilu LinkedIn (akceptujemy wklejenie samego
//    uchwytu, adresu bez protokołu albo pełnego URL-a).
//
// Trzymane osobno od komponentu, bo ten sam kontrakt obowiązuje warstwę
// serwerową (metadata zaproszenia trafia do profiles.linkedin_url).

/** Do dwóch pierwszych liter kolejnych członów nazwy, wielkimi literami. */
export function initialsFromName(name: string): string {
  const parts = name
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "";
  const letters = parts
    .slice(0, 2)
    .map((p) => Array.from(p)[0] ?? "")
    .join("");
  return letters.toLocaleUpperCase("pl-PL");
}

/**
 * Zwraca kanoniczny `https://www.linkedin.com/...` albo `null`, gdy wejście
 * jest puste bądź nie jest adresem LinkedIn. Nigdy nie przepuszcza innego
 * hosta ani schematu (ochrona przed `javascript:` w profilu publicznym).
 */
export function normalizeLinkedInUrl(input: string): string | null {
  const raw = input.trim();
  if (raw.length === 0) return null;

  // Sam uchwyt: "jan-kowalski" -> pełny adres profilu.
  if (/^[A-Za-z0-9À-ž._-]+$/.test(raw) && !raw.includes(".")) {
    return `https://www.linkedin.com/in/${raw}`;
  }

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  url.protocol = "https:";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

/** Czy pole LinkedIn (opcjonalne) jest akceptowalne w formularzu. */
export function isLinkedInInputValid(input: string): boolean {
  return input.trim().length === 0 || normalizeLinkedInUrl(input) !== null;
}
