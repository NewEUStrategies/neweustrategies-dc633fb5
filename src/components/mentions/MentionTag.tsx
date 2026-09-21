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
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BadgeCheck, Building2, UserRound } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMentionProfile } from "@/lib/mentions/useMentionProfile";
import {
  identityLine,
  slugToDisplayName,
  type MentionEntity,
  type MentionOrg,
  type MentionPerson,
} from "@/lib/mentions/directory";
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
}

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
  rounded = "full",
}: {
  name: string;
  avatarUrl: string | null;
  variant?: "inline" | "card";
  rounded?: "full" | "lg";
}) {
  const size = variant === "inline" ? "h-[1.15em] w-[1.15em] text-[0.6em]" : "h-10 w-10 text-xs";
  const shape = rounded === "full" ? "rounded-full" : "rounded-lg";
  const base = `${size} ${shape} shrink-0 select-none overflow-hidden ring-1 ring-border/60`;
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
      {variant === "card" ? initials(name) : <UserRound className="h-[0.8em] w-[0.8em]" />}
    </span>
  );
}

/** Treść dymka osoby. Czysta prezentacja - zero zapytań, żeby dało się ją
 *  pokazać w katalogu komponentów bez wychodzenia do bazy. */
export function MentionPersonCard({
  person,
  labels,
}: {
  person: Pick<
    MentionPerson,
    "slug" | "name" | "avatarUrl" | "jobTitle" | "company" | "bio" | "verified"
  >;
  labels: MentionTagLabels;
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
      <Link
        to="/author/$slug"
        params={{ slug: person.slug }}
        className="inline-block text-xs font-medium text-primary hover:underline"
      >
        {labels.viewProfile}
      </Link>
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

/** Dymek osoby dociągany leniwie - dla wzmianek, których katalog nie rozwiązał
 *  (np. profil widoczny dopiero po zalogowaniu). */
function LazyPersonCard({
  slug,
  lang,
  labels,
  open,
}: {
  slug: string;
  lang: "pl" | "en";
  labels: MentionTagLabels;
  open: boolean;
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
  return <MentionPersonCard person={profile.data} labels={labels} />;
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
  children,
}: {
  slug: string;
  entity: MentionEntity | null;
  lang: "pl" | "en";
  labels: MentionTagLabels;
  testId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <HoverCard openDelay={200} closeDelay={120} open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-72" data-testid={testId}>
        {entity !== null && entity.kind === "org" ? (
          <MentionOrgCard org={entity} labels={labels} />
        ) : entity !== null ? (
          <MentionPersonCard person={entity} labels={labels} />
        ) : (
          <LazyPersonCard slug={slug} lang={lang} labels={labels} open={open} />
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Wzmianka w biegu tekstu. `entity` pochodzi z katalogu powierzchni; gdy go
 * nie ma, etykietą jest uczytelniony slug, a dymek dociąga profil sam.
 */
export function MentionTag({
  slug,
  entity,
  lang,
  labels,
  className,
  testId = "mention-preview",
  showCompany = true,
}: {
  slug: string;
  entity: MentionEntity | null;
  lang: "pl" | "en";
  labels: MentionTagLabels;
  className?: string;
  testId?: string;
  /** Firma w linii tekstu. Dymek pokazuje ją zawsze, gdy jest w profilu. */
  showCompany?: boolean;
}) {
  const isOrg = entity !== null && entity.kind === "org";
  const name = entity !== null ? entity.name : slugToDisplayName(slug);
  const company = entity !== null && entity.kind === "person" ? entity.company : null;
  const avatarUrl = entity !== null && entity.kind === "person" ? entity.avatarUrl : null;

  const chip: ReactNode = (
    <span className="inline-flex items-center gap-1 align-baseline">
      {isOrg ? (
        <Building2
          className="h-[1.05em] w-[1.05em] shrink-0"
          aria-hidden="true"
          data-mention-avatar=""
        />
      ) : (
        <MentionAvatar name={name} avatarUrl={avatarUrl} />
      )}
      <span>{name}</span>
      {showCompany && company !== null ? (
        <span className="font-normal text-muted-foreground">· {company}</span>
      ) : null}
    </span>
  );

  const trigger =
    entity !== null && entity.kind === "org" ? (
      <Link
        to="/organization/$slug"
        params={{ slug: entity.slug }}
        data-mention-org={entity.slug}
        className={cn("font-medium text-primary hover:underline", className)}
      >
        {chip}
      </Link>
    ) : (
      <Link
        to="/author/$slug"
        params={{ slug }}
        data-mention={slug}
        className={cn("font-medium text-primary hover:underline", className)}
      >
        {chip}
      </Link>
    );

  return (
    <PersonHoverCard slug={slug} entity={entity} lang={lang} labels={labels} testId={testId}>
      {trigger}
    </PersonHoverCard>
  );
}
