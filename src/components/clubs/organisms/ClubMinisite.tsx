// Minisite klubu - osobny widok treści.
//
// DLACZEGO OSOBNY WIDOK, a nie kolejna zakładka listy. Strona `/club/$slug`
// jest OPERACYJNA: filtry, sortowanie, wyszukiwarka, przycisk "nowy temat".
// Świetna dla członka, który wchodzi codziennie i wie, czego szuka. Fatalna
// dla osoby zaproszonej albo z planem Pro, która trafia do klubu PIERWSZY raz:
// dostaje listę tytułów bez treści i nie ma jak ocenić, czy ta rozmowa jest o
// czymkolwiek dla niej.
//
// Minisite odwraca proporcje: okładka, po co ten klub istnieje, zasady, jeden
// wyróżniony temat z fragmentem i siatka pozostałych - też z fragmentami.
// Zero kontrolek. To jest wizytówka klubu wewnątrz klubu.
//
// BRAMKA. Miękka warstwa (`resolveClubMinisiteAccess`) rozstrzyga wyłącznie,
// który panel narysować; treść i tak przychodzi z RPC, które sprawdziło
// `club_capabilities`. Osoba bez planu i bez zaproszenia widzi zachętę zamiast
// fragmentów - ale gdyby baza odmówiła odczytu, nie widzi nawet tego.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Clock, Lock, MessagesSquare, ShieldQuestion, KeyRound, Users2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ClubCover } from "@/components/clubs/atoms/ClubCover";
import { ClubTopicChip } from "@/components/clubs/atoms/ClubTopicChip";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import type { ClubMinisiteAccess } from "@/lib/clubs/minisiteAccess";
import { showsClubMinisiteContent } from "@/lib/clubs/minisiteAccess";
import { toAuthorLabel, type ClubThreadListRow, type ClubViewRow } from "@/lib/clubs/types";
import { formatDate, uiLang } from "@/lib/i18n/format";
import { pickLocalized, type LocaleCode } from "@/lib/i18n/pickLocalized";

function fmtDate(value: string | null, lang: LocaleCode): string | null {
  if (value === null || value === "") return null;
  return (
    formatDate(value, lang, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }) || null
  );
}

function ThreadTeaser({
  thread,
  clubSlug,
  featured,
}: {
  thread: ClubThreadListRow;
  clubSlug: string;
  featured: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const date = fmtDate(thread.last_reply_at ?? thread.created_at, lang);
  const author = toAuthorLabel(thread, t("club.anonymousAuthor"), t("club.deletedAuthor"));

  return (
    <Link
      to="/club/$clubSlug/t/$threadSlug"
      params={{ clubSlug, threadSlug: thread.slug }}
      className={
        featured
          ? "group flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/5 p-5 transition-colors hover:border-primary"
          : "group flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card p-4 transition-colors hover:border-primary/40"
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="text-[11px]">
          {t(`club.kind.${thread.kind}`)}
        </Badge>
        <span>{pickLocalized(thread, "group_name", lang)}</span>
      </div>
      <h3
        className={
          featured
            ? "text-xl font-semibold leading-tight group-hover:text-primary"
            : "font-medium leading-tight group-hover:text-primary"
        }
      >
        {thread.title}
      </h3>
      {thread.excerpt !== null && thread.excerpt.trim() !== "" ? (
        <p
          className={
            featured
              ? "text-sm text-muted-foreground"
              : "line-clamp-3 text-sm text-muted-foreground"
          }
        >
          {thread.excerpt}
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
          {t("club.repliesCount", { count: thread.reply_count })}
        </span>
        {date !== null ? (
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {date}
          </span>
        ) : null}
        {/* Etykieta autora idzie przez WSPOLNA funkcje, tak jak w kazdym
            innym miejscu modulu. Wlasna wersja gubila dwa przypadki: wpis
            w klubie 'chatham' (is_anonymous=false, ale author_name=NULL - pusty
            napis) i konto usuniete (oba pola NULL). Trzecia: alias jest tu
            renderowany surowo, bez szablonu "Uczestnik {{alias}}". */}
        <span>{author.name}</span>
      </div>
    </Link>
  );
}

export function ClubMinisite({
  club,
  threads,
  loading,
  access,
}: {
  club: ClubViewRow;
  threads: readonly ClubThreadListRow[];
  loading: boolean;
  access: ClubMinisiteAccess;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { topics: topicCatalog } = useClubTopics();
  const name = pickLocalized(club, "name", lang);
  const tagline = pickLocalized(club, "tagline", lang);
  const description = pickLocalized(club, "description", lang);
  const rules = pickLocalized(club, "rules", lang);
  const showContent = showsClubMinisiteContent(access);
  const [lead, ...rest] = threads;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8">
        <ClubCover url={club.cover_image_url} variant="banner" className="mb-5" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("club.minisite.eyebrow")}
            </p>
            <h1 className="mt-1 text-3xl font-semibold">{name}</h1>
            {tagline !== null && tagline.trim() !== "" ? (
              <p className="mt-1 text-muted-foreground">{tagline}</p>
            ) : null}
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/club/$clubSlug" params={{ clubSlug: club.slug }}>
              {t("club.minisite.toDiscussion")}
            </Link>
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Users2 className="h-4 w-4" aria-hidden="true" />
            {t("club.membersCount", { count: club.member_count })}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MessagesSquare className="h-4 w-4" aria-hidden="true" />
            {t("club.threadsCount", { count: club.thread_count })}
          </span>
          <ClubTopicChip topic={club.policy_area} lang={lang} catalog={topicCatalog} />
          {club.attribution_mode === "chatham" ? (
            <Badge variant="outline" className="gap-1">
              <ShieldQuestion className="h-3 w-3" aria-hidden="true" />
              {t("club.attribution.chatham")}
            </Badge>
          ) : null}
          <Badge variant="secondary" className="gap-1">
            <KeyRound className="h-3 w-3" aria-hidden="true" />
            {t(`club.minisite.access.${access}`)}
          </Badge>
        </div>
      </header>

      {description !== null && description.trim() !== "" ? (
        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold">{t("club.minisite.aboutTitle")}</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </section>
      ) : null}

      {!showContent ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Lock className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-lg font-semibold">
              {access === "no_read"
                ? t("club.minisite.noReadTitle")
                : t("club.minisite.lockedTitle")}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {access === "no_read" ? t("club.minisite.noReadBody") : t("club.minisite.lockedBody")}
            </p>
            {access === "locked" ? (
              <Button asChild size="sm">
                <Link to="/pricing">{t("club.hub.upgradeCta")}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">{t("club.minisite.readingTitle")}</h2>
          {loading ? (
            <div className="space-y-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-lg bg-muted/50" />
              ))}
            </div>
          ) : threads.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              {t("club.minisite.empty")}
            </p>
          ) : (
            <div className="space-y-3">
              <ThreadTeaser thread={lead} clubSlug={club.slug} featured />
              {rest.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {rest.map((thread) => (
                    <ThreadTeaser
                      key={thread.id}
                      thread={thread}
                      clubSlug={club.slug}
                      featured={false}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </section>
      )}

      {rules !== null && rules.trim() !== "" ? (
        <section className="mb-4 rounded-lg border border-border/60 bg-muted/30 p-5">
          <h2 className="mb-2 text-base font-semibold">{t("club.rules")}</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {rules}
          </p>
        </section>
      ) : null}
    </div>
  );
}
