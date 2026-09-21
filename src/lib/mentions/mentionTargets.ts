// Wspólne kodowanie celów @wzmianek.
//
// Osoby zachowują dotychczasowy slug profilu (`@jan-kowalski`). Firmy nie mają
// bezpiecznej publicznej trasy po `id`, więc w tekście dostają jawny prefiks
// `org-` oraz slug z nazwy. Dzięki temu render po publikacji może odróżnić
// organizację od osoby bez odpytywania prywatnej tabeli CRM na starcie.

const ORGANIZATION_PREFIX = "org-";

const TRANSLITERATION: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
  ä: "a",
  ö: "o",
  ü: "u",
  ß: "ss",
  æ: "ae",
  ø: "o",
  å: "a",
};

export function slugifyMentionLabel(label: string): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ąćęłńóśźżäöüßæøå]/g, (char) => TRANSLITERATION[char] ?? "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return normalized || "organization";
}

export function organizationMentionSlug(labelOrSlug: string): string {
  const slug = slugifyMentionLabel(labelOrSlug);
  return slug.startsWith(ORGANIZATION_PREFIX) ? slug : `${ORGANIZATION_PREFIX}${slug}`;
}

export function decodeOrganizationMentionSlug(slug: string): string | null {
  return slug.startsWith(ORGANIZATION_PREFIX) ? slug.slice(ORGANIZATION_PREFIX.length) : null;
}

export function mentionSlugSearchPhrase(slug: string): string {
  const orgSlug = decodeOrganizationMentionSlug(slug) ?? slug;
  return orgSlug.replace(/-/g, " ").trim();
}