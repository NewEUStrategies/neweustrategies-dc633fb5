// Wspólne kodowanie celów @wzmianek.
//
// Osoby zachowują dotychczasowy slug profilu (`@jan-kowalski`). Firmy dostają
// jawny prefiks `org-` oraz stabilny identyfikator rekordu z bezpiecznej
// projekcji. Nazwa firmy NIE jest identyfikatorem - dwie firmy mogą nazywać się
// tak samo, a wzmianka nadal musi wskazywać właściwy rekord tenantowy.
//
// Koder (`organizationMentionSlug`) i fraza wyszukiwania ze sluga zostały
// usunięte: slug firmy składa baza (`search_mention_targets`), a żadne miejsce
// w kliencie nie budowało go ani nie szukało po nim.

const ORGANIZATION_PREFIX = "org-";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identyfikator firmy ze sluga `org-<uuid>` albo `null`, gdy to nie firma. */
export function decodeOrganizationMentionSlug(slug: string): string | null {
  const raw = slug.startsWith(ORGANIZATION_PREFIX) ? slug.slice(ORGANIZATION_PREFIX.length) : "";
  return UUID_RE.test(raw) ? raw.toLowerCase() : null;
}
