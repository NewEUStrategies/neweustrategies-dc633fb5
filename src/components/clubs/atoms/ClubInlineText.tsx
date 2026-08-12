// Atom: inline treści klubowej - linki z podglądem, @wzmianki z wizytówką,
// #tagi jako filtr strumienia.
//
// TREŚĆ POZOSTAJE TEKSTEM. Zero `dangerouslySetInnerHTML` - budujemy węzły
// React z segmentów (`splitInline`), więc treść od użytkownika nie może
// wstrzyknąć znaczników. Linki wychodzące dostają `rel="nofollow ugc
// noopener noreferrer"`, bo to treść generowana przez członków.
//
// PODGLĄDY SĄ LENIWE. Dymek montuje zapytanie DOPIERO po otwarciu (najechanie
// lub fokus klawiaturą), więc wątek z trzydziestoma linkami nie robi
// trzydziestu wyjść na świat przy renderze.
import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BadgeCheck, ExternalLink, Hash } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { splitInline } from "@/lib/clubs/inlineSegments";
import { useClubLinkPreview } from "@/lib/clubs/useClubLinkPreview";
import { useMentionProfile } from "@/lib/mentions/useMentionProfile";
import { ensureClubI18n } from "@/lib/i18n-club";
import { cn } from "@/lib/utils";
import { uiLang } from "@/lib/i18n/format";

ensureClubI18n();

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

function LinkSegment({ href, raw }: { href: string; raw: string }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const preview = useClubLinkPreview(href, open);
  const data = preview.data ?? null;

  return (
    <HoverCard openDelay={220} closeDelay={120} open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="nofollow ugc noopener noreferrer"
          data-club-link={href}
          className="break-words font-medium text-primary underline-offset-2 hover:underline"
        >
          {raw}
        </a>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 p-0" data-testid="club-link-preview">
        {data?.image ? (
          <img
            src={data.image}
            alt=""
            loading="lazy"
            className="h-36 w-full rounded-t-[8px] object-cover"
          />
        ) : null}
        <div className="space-y-1.5 p-3">
          <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            {data?.siteName ?? hostOf(href)}
          </p>
          {preview.isPending ? (
            <>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </>
          ) : data?.title ? (
            <>
              <p className="text-sm font-semibold leading-snug text-foreground">{data.title}</p>
              {data.description ? (
                <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                  {data.description}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{t("club.inline.noPreview")}</p>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function MentionSegment({
  slug,
  raw,
  className,
}: {
  slug: string;
  raw: string;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [open, setOpen] = useState(false);
  const profile = useMentionProfile(slug, lang, open);
  const person = profile.data ?? null;

  return (
    <HoverCard openDelay={200} closeDelay={120} open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>
        <Link
          to="/author/$slug"
          params={{ slug }}
          data-mention={slug}
          className={cn("font-medium text-primary hover:underline", className)}
        >
          {raw}
        </Link>
      </HoverCardTrigger>
      <HoverCardContent className="w-72" data-testid="club-mention-preview">
        {profile.isPending ? (
          <div className="flex gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ) : person === null ? (
          <p className="text-xs text-muted-foreground">{t("club.inline.noProfile")}</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                {person.avatarUrl ? (
                  <img src={person.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  person.name.slice(0, 2).toLocaleUpperCase()
                )}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1 text-sm font-semibold text-foreground">
                  <span className="truncate">{person.name}</span>
                  {person.verified ? (
                    <BadgeCheck
                      className="h-3.5 w-3.5 shrink-0 text-primary"
                      aria-label={t("club.inline.verified")}
                    />
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[person.jobTitle, person.company].filter(Boolean).join(" - ") || `@${slug}`}
                </p>
              </div>
            </div>
            {person.bio ? (
              <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                {person.bio}
              </p>
            ) : null}
            <Link
              to="/author/$slug"
              params={{ slug }}
              className="inline-block text-xs font-medium text-primary hover:underline"
            >
              {t("club.inline.viewProfile")}
            </Link>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

function HashtagSegment({
  tag,
  raw,
  clubSlug,
}: {
  tag: string;
  raw: string;
  clubSlug: string | null;
}) {
  const chip =
    "inline-flex items-center gap-0.5 rounded-[6px] bg-primary/10 px-1.5 py-0.5 align-baseline text-[0.9em] font-medium text-primary";
  if (clubSlug === null) {
    return (
      <span className={chip} data-club-tag={tag}>
        <Hash className="h-3 w-3" aria-hidden="true" />
        {raw.slice(1)}
      </span>
    );
  }
  return (
    <Link
      to="/club/$clubSlug"
      params={{ clubSlug }}
      search={{ tag }}
      data-club-tag={tag}
      className={cn(chip, "hover:bg-primary/20")}
    >
      <Hash className="h-3 w-3" aria-hidden="true" />
      {raw.slice(1)}
    </Link>
  );
}

/**
 * Renderuje tekst z bogatymi segmentami. `clubSlug` włącza tagi jako filtr
 * strumienia klubu; bez niego tag zostaje etykietą (poza kontekstem klubu nie
 * ma dokąd prowadzić).
 */
export function ClubInlineText({
  body,
  clubSlug = null,
}: {
  body: string;
  clubSlug?: string | null;
}) {
  const segments = splitInline(body);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "text") return <Fragment key={i}>{seg.text}</Fragment>;
        if (seg.kind === "url") return <LinkSegment key={i} href={seg.href} raw={seg.raw} />;
        if (seg.kind === "mention") return <MentionSegment key={i} slug={seg.slug} raw={seg.raw} />;
        return <HashtagSegment key={i} tag={seg.tag} raw={seg.raw} clubSlug={clubSlug} />;
      })}
    </>
  );
}
