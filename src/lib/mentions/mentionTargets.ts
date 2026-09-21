// Wspólne kodowanie celów @wzmianek.
//
// Osoby zachowują dotychczasowy slug profilu (`@jan-kowalski`). Firmy dostają
// jawny prefiks `org-` oraz stabilny identyfikator rekordu z bezpiecznej
// projekcji. Nazwa firmy NIE jest identyfikatorem - dwie firmy mogą nazywać się
// tak samo, a wzmianka nadal musi wskazywać właściwy rekord tenantowy.

const ORGANIZATION_PREFIX = "org-";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function organizationMentionSlug(idOrSlug: string): string | null {
  const token = idOrSlug.trim().toLowerCase();
  const id = token.startsWith(ORGANIZATION_PREFIX) ? token.slice(ORGANIZATION_PREFIX.length) : token;
  return UUID_RE.test(id) ? `${ORGANIZATION_PREFIX}${id}` : null;
}

export function decodeOrganizationMentionSlug(slug: string): string | null {
  const raw = slug.startsWith(ORGANIZATION_PREFIX) ? slug.slice(ORGANIZATION_PREFIX.length) : "";
  return UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

export function mentionSlugSearchPhrase(slug: string): string {
  const orgSlug = decodeOrganizationMentionSlug(slug) ?? slug;
  return orgSlug.replace(/-/g, " ").trim();
}