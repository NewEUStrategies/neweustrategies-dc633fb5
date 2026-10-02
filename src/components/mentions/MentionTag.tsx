// Wzmianka jako WIZYTÓWKA, nie jako nick.
//
// CO SIĘ ZMIENIŁO I DLACZEGO. Wcześniej wzmianka renderowała się dosłownie
// jako `@slug`. Nick nie niesie informacji: czytelnik widzi `@a-nowak` i nie
// wie, kto to. Teraz w linii tekstu stoi AWATAR + IMIĘ I NAZWISKO, a gdy osoba
// ma w profilu firmę - także firma. Nicku nie ma NIGDZIE: ani w treści, ani w
// dymku, ani w stanie zastępczym (tam wchodzi uczytelniony slug).
//
// FIRMA JEST OPCJONALNA I NIE ZOSTAWIA PO SOBIE ŚLADU. Gdy profil nie ma
// wpisanej firmy, element nie renderuje się w ogóle - nie ma pustego `<span>`,
// nie ma separatora-sieroty, reszta wiersza przesuwa się w lewo.
//
// ETYKIETY WCHODZĄ PROPSAMI. Ten komponent obsługuje dwie powierzchnie o
// osobnych przestrzeniach tłumaczeń (kluby i komentarze pod artykułami).
// Gdyby sam wołał `t()`, wciągnąłby overlay jednej z nich do chunku drugiej.
//
// NIEROZWIĄZANA FIRMA TO NADAL FIRMA. Slug `org-<uuid>` rozpoznajemy po samym
// slugu, bez katalogu: wcześniej wzmianka firmy, której katalog nie rozwiązał
// (rekord usunięty, katalog jeszcze się ładuje, brak dostawcy), schodziła na
// gałąź osoby - etykieta z UUID („Org 1b2c…"), link `/people/org-<uuid>`
// i karta osoby w dymku. Teraz dostaje ikonę firmy, etykietę „Firma", adres
// `/organization/org-<uuid>` (ta trasa sama rozpoznaje prefiks) i kartę firmy.
//
// TRASA OSOBY ZALEŻY OD POWIERZCHNI. Kluby są przestrzenią członkowską, więc
// prowadzą na `/people/<slug>`. Komentarze pod artykułami czyta anonim - dla
// niego `/people` to bramka logowania z `noindex`. Tam wzmianka idzie na
// `/author/<slug>`: autor dostaje publiczny hub, a członek bez roli autora -
// trwałe 301 na `/people` (rozstrzyga trasa, tymi samymi regułami widoczności).
import { useState, type ComponentPropsWithRef, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BadgeCheck, Building2, UserRound } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMentionProfile, type MentionProfilePreview } from "@/lib/mentions/useMentionProfile";
import {
  identityLine,
  nameInitials,
  slugToDisplayName,
  type MentionEntity,
  type MentionOrg,
  type MentionPerson,
} from "@/lib/mentions/directory";
import { decodeOrganizationMentionSlug } from "@/lib/mentions/mentionTargets";
import { cn } from "@/lib/utils";

/** Napisy dymka - dostarcza je powierzchnia, wraz ze swoją przestrzenią kluczy. */
export interface MentionTagLabels {
  /** Gdy sluga nie da się rozwiązać (profil poza zasięgiem widoczności). */
  noProfile: string;
  /** Odnośnik w stopce dymka osoby. */
  viewProfile: string;
  /** Etykieta dostępności odznaki weryfikacji. */
  verified: string;
  /** Odnośnik w stopce dymka organizacji. */
  viewOrg: string;
  /** Etykieta firmy, której katalog nie rozwiązał (zamiast UUID ze sluga). */
  organization: string;
}

/** Trasa profilu osoby: członkowska (`/people`) albo publiczna (`/author`). */
export type MentionProfileRoute = "people" | "author";

/** Odnośnik do osoby. Dwie jawne gałęzie, bo drzewo tras typuje `to`. Musi
 *  przekazywać propsy i ref dalej - jest dzieckiem `HoverCardTrigger asChild`,
 *  a Radix dokleja wyzwalaczowi zdarzenia, `data-state` i ref kotwicy dymka. */
function PersonLink({
  route,
  slug,
  ...rest
}: { route: MentionProfileRoute; slug: string } & Omit<ComponentPropsWithRef<"a">, "href">) {
  return route === "author" ? (
    <Link to="/author/$slug" params={{ slug }} {...rest} />
  ) : (
    <Link to="/people/$slug" params={{ slug }} {...rest} />
  );
}

/**
 * Awatar wzmianki. `inline` to wariant do biegu tekstu (mały, wyrównany do
 * linii pisma), `card` - do dymka.
 *
 * BRAK ZDJĘCIA SCHODZI INACZEJ W KAŻDYM WARIANCIE. W dymku wchodzą inicjały:
 * jest miejsce, a inicjały czytają się jak awatar. W biegu tekstu wchodzi
 * IKONA, bo inicjały stoją tam tuż obok pełnego nazwiska i czytałyby się jak
 * literówka („AAnna Nowak") - także dla czytnika zrzucającego tekst strony.
 */
export function MentionAvatar({
  name,
  avatarUrl,
  variant = "inline",
}: {
  name: string;
  avatarUrl: string | null;
  variant?: "inline" | "card";
}) {
  const size = variant === "inline" ? "h-[1.15em] w-[1.15em] text-[0.6em]" : "h-10 w-10 text-xs";
  const base = `${size} rounded-full shrink-0 select-none overflow-hidden ring-1 ring-border/60`;
  if (avatarUrl !== null && avatarUrl !== "") {
    return (
      <img
        src={avatarUrl}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className={`${base} object-cover`}
        data-mention-avatar=""
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${base} grid place-items-center bg-primary/10 font-semibold text-primary`}
      data-mention-avatar=""
    >
      {variant === "card" ? nameInitials(name) : <UserRound className="h-[0.8em] w-[0.8em]" />}
    </span>
  );
}

/** Treść dymka osoby. Czysta prezentacja - zero zapytań, żeby dało się ją
 *  pokazać w katalogu komponentów bez wychodzenia do bazy. */
export function MentionPersonCard({
  person,
  labels,
  profileRoute = "people",
}: {
  person: Pick<
    MentionPerson,
    "slug" | "name" | "avatarUrl" | "jobTitle" | "company" | "bio" | "verified"
  >;
  labels: MentionTagLabels;
  profileRoute?: MentionProfileRoute;
}) {
  const identity = identityLine(person.jobTitle, person.company);
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <MentionAvatar name={person.name} avatarUrl={person.avatarUrl} variant="card" />
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-sm font-semibold text-foreground">
            <span className="truncate">{person.name}</span>
            {person.verified ? (
              <BadgeCheck
                className="h-3.5 w-3.5 shrink-0 text-primary"
                aria-label={labels.verified}
              />
            ) : null}
          </p>
          {identity.length > 0 ? (
            <p className="truncate text-xs text-muted-foreground">{identity.join(" · ")}</p>
          ) : null}
        </div>
      </div>
      {person.bio !== null && person.bio !== "" ? (
        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{person.bio}</p>
      ) : null}
      <PersonLink
        route={profileRoute}
        slug={person.slug}
        className="inline-block text-xs font-medium text-primary hover:underline"
      >
        {labels.viewProfile}
      </PersonLink>
    </div>
  );
}

/** Treść dymka organizacji. Dane ma już katalog - dymek nic nie dociąga. */
export function MentionOrgCard({ org, labels }: { org: MentionOrg; labels: MentionTagLabels }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        {org.logoUrl !== null && org.logoUrl !== "" ? (
          <img
            src={org.logoUrl}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="h-10 w-10 shrink-0 rounded-lg object-contain ring-1 ring-border/60"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-border/60"
          >
            <Building2 className="h-5 w-5" />
          </span>
        )}
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">{org.name}</p>
      </div>
      {org.description !== null && org.description !== "" ? (
        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {org.description}
        </p>
      ) : null}
      <Link
        to="/organization/$slug"
        params={{ slug: org.slug }}
        className="inline-block text-xs font-medium text-primary hover:underline"
      >
        {labels.viewOrg}
      </Link>
    </div>
  );
}

/** Podgląd celu z `get_mention_target` -> firma do karty organizacji. Podpis
 *  firmy to jej branża - dokładnie to, co karta pokazuje jako opis. */
function orgFromPreview(preview: MentionProfilePreview): MentionOrg {
  return {
    kind: "org",
    slug: preview.slug,
    id: preview.id,
    name: preview.name,
    logoUrl: preview.logoUrl,
    description: preview.company,
    website: preview.website,
  };
}

/** Dymek dociągany leniwie - dla wzmianek, których katalog nie rozwiązał
 *  (np. profil widoczny dopiero po zalogowaniu). Karta idzie za RODZAJEM
 *  celu z bazy, a nie za domysłem ze sluga. */
function LazyMentionCard({
  slug,
  lang,
  labels,
  open,
  profileRoute,
}: {
  slug: string;
  lang: "pl" | "en";
  labels: MentionTagLabels;
  open: boolean;
  profileRoute: MentionProfileRoute;
}) {
  const profile = useMentionProfile(slug, lang, open);
  if (profile.isPending) {
    return (
      <div className="flex gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    );
  }
  if (profile.data === null || profile.data === undefined) {
    return <p className="text-xs text-muted-foreground">{labels.noProfile}</p>;
  }
  if (profile.data.kind === "organization") {
    return <MentionOrgCard org={orgFromPreview(profile.data)} labels={labels} />;
  }
  return <MentionPersonCard person={profile.data} labels={labels} profileRoute={profileRoute} />;
}

/**
 * Dymek osoby owijający DOWOLNY wyzwalacz. Byline ma awatar obok nazwiska, więc
 * nie potrzebuje wizytówki z własnym awatarem - potrzebuje samego dymka.
 * Wyzwalacz musi być fokusowalny, inaczej dymek znika dla klawiatury.
 */
export function PersonHoverCard({
  slug,
  entity,
  lang,
  labels,
  testId = "mention-preview",
  profileRoute = "people",
  children,
}: {
  slug: string;
  entity: MentionEntity | null;
  lang: "pl" | "en";
  labels: MentionTagLabels;
  testId?: string;
  profileRoute?: MentionProfileRoute;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <HoverCard openDelay={200} closeDelay={120} open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-72" data-testid={testId}>
        {entity === null ? (
          <LazyMentionCard
            slug={slug}
            lang={lang}
            labels={labels}
            open={open}
            profileRoute={profileRoute}
          />
        ) : entity.kind === "org" ? (
          <MentionOrgCard org={entity} labels={labels} />
        ) : (
          <MentionPersonCard person={entity} labels={labels} profileRoute={profileRoute} />
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Wzmianka w biegu tekstu. `entity` pochodzi z katalogu powierzchni; gdy go
 * nie ma, etykietą jest uczytelniony slug (osoba) albo „Firma" (slug
 * `org-<uuid>`), a dymek dociąga cel sam.
 */
export function MentionTag({
  slug,
  entity,
  lang,
  labels,
  className,
  testId = "mention-preview",
  showCompany = true,
  profileRoute = "people",
}: {
  slug: string;
  entity: MentionEntity | null;
  lang: "pl" | "en";
  labels: MentionTagLabels;
  className?: string;
  testId?: string;
  /** Firma w linii tekstu. Dymek pokazuje ją zawsze, gdy jest w profilu. */
  showCompany?: boolean;
  /** Dokąd prowadzi osoba - patrz nagłówek pliku. */
  profileRoute?: MentionProfileRoute;
}) {
  const person = entity !== null && entity.kind === "person" ? entity : null;
  // Slug firmy: z katalogu, a bez niego - rozpoznany po prefiksie `org-<uuid>`.
  const orgId = entity === null ? decodeOrganizationMentionSlug(slug) : null;
  const orgSlug = entity?.kind === "org" ? entity.slug : orgId !== null ? `org-${orgId}` : null;
  const name =
    entity !== null
      ? entity.name
      : orgSlug !== null
        ? labels.organization
        : slugToDisplayName(slug);
  const company = person?.company ?? null;
  const linkClass = cn("font-medium text-primary hover:underline", className);

  const chip: ReactNode = (
    <span className="inline-flex items-center gap-1 align-baseline">
      {orgSlug !== null ? (
        <Building2
          className="h-[1.05em] w-[1.05em] shrink-0"
          aria-hidden="true"
          data-mention-avatar=""
        />
      ) : (
        <MentionAvatar name={name} avatarUrl={person?.avatarUrl ?? null} />
      )}
      <span>{name}</span>
      {showCompany && company !== null ? (
        <span className="font-normal text-muted-foreground">· {company}</span>
      ) : null}
    </span>
  );

  return (
    <PersonHoverCard
      slug={slug}
      entity={entity}
      lang={lang}
      labels={labels}
      testId={testId}
      profileRoute={profileRoute}
    >
      {orgSlug !== null ? (
        <Link
          to="/organization/$slug"
          params={{ slug: orgSlug }}
          data-mention-org={orgSlug}
          className={linkClass}
        >
          {chip}
        </Link>
      ) : (
        <PersonLink route={profileRoute} slug={slug} data-mention={slug} className={linkClass}>
          {chip}
        </PersonLink>
      )}
    </PersonHoverCard>
  );
}
