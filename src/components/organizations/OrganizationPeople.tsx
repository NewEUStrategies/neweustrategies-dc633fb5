// Siatka osób związanych z organizacją.
//
// SKĄD SIĘ BIORĄ. Profil trzyma firmę jako SNAPSHOT tekstowy
// (`profiles.current_company`), więc „kto tu pracuje" to dopasowanie po nazwie,
// a nie po kluczu obcym. Dopasowanie jest ŚCISŁE, a sekcja hydratuje się po
// stronie klienta - kolumna nie ma indeksu i nie wolno jej stawiać na ścieżce
// TTFB (uzasadnienie w `lib/queries/organization.ts`).
//
// ZERO TRAFIEŃ = SEKCJI NIE MA. Nie pokazujemy pustej karty z komunikatem:
// brak dopasowania po nazwie nie jest twierdzeniem „nikt tu nie pracuje", tylko
// brakiem danych, a pusty nagłówek sugerowałby to pierwsze.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BadgeCheck, Users } from "lucide-react";

import { ProfileSectionCard } from "@/components/profile/shell/ProfileShell";
import {
  organizationPeopleQueryOptions,
  type OrganizationPerson,
} from "@/lib/queries/organization";

function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toLocaleUpperCase("pl-PL");
}

/** Pojedyncza wizytówka. Stanowisko jest opcjonalne - bez niego wiersz znika. */
export function OrganizationPersonCard({
  person,
  verifiedLabel,
}: {
  person: OrganizationPerson;
  verifiedLabel: string;
}) {
  return (
    <li>
      <Link
        to="/people/$slug"
        params={{ slug: person.slug }}
        data-organization-person={person.slug}
        className="flex min-w-0 items-center gap-3 rounded-[6px] border border-border bg-background p-3 transition-colors hover:border-primary/50"
      >
        {person.avatarUrl !== null ? (
          <img
            src={person.avatarUrl}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-border/60"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary ring-1 ring-border/60"
          >
            {initials(person.name)}
          </span>
        )}
        <span className="min-w-0">
          <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
            <span className="truncate">{person.name}</span>
            {person.verified ? (
              <BadgeCheck
                className="h-3.5 w-3.5 shrink-0 text-primary"
                aria-label={verifiedLabel}
              />
            ) : null}
          </span>
          {person.jobTitle !== null ? (
            <span className="block truncate text-xs text-muted-foreground">{person.jobTitle}</span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

export function OrganizationPeople({
  companyNames,
  heading,
  verifiedLabel,
}: {
  /** Warianty nazwy, pod którymi organizacja może stać w profilach. */
  companyNames: readonly string[];
  heading: string;
  verifiedLabel: string;
}) {
  const { data } = useQuery(organizationPeopleQueryOptions(companyNames));
  const people = data ?? [];
  if (people.length === 0) return null;
  return (
    <ProfileSectionCard icon={<Users className="h-3.5 w-3.5" />} title={heading}>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {people.map((person) => (
          <OrganizationPersonCard key={person.slug} person={person} verifiedLabel={verifiedLabel} />
        ))}
      </ul>
    </ProfileSectionCard>
  );
}
