// Widget „Klub: strona" (`club-hub`) - jeden klub z trzema sekcjami: artykuły,
// komentarze i zapisy, ułożone tak jak strona klubu w panelu (`/club/$slug`).
//
// CZEGO NIE BYŁO. Istniejące widgety klubowe pokazują KARTĘ jednego klubu
// (`club-card`) albo strumień wątków PONAD klubami (`club-threads`). Redakcja
// nie miała czym postawić poza modułem tego, po co czytelnik naprawdę wchodzi
// na stronę klubu: co tam napisano, o czym się rozmawia i kto już dołączył.
//
// WIDOCZNOŚĆ LICZY SIĘ W BAZIE, nie tutaj. `club_view` oddaje anonimowi tylko
// kluby publiczne i aktywne, a `club_threads_list` / `club_posts_list` /
// `club_members_list` to SECURITY DEFINER po `club_capabilities`. Widget nie ma
// więc czym pokazać klubu, którego wołający i tak by nie zobaczył.
//
// PUSTY STAN JEST CICHY. Brak konfiguracji, brak dostępu albo brak treści =
// `null`, a nie ramka z komunikatem: karta „nie masz dostępu" na stronie
// głównej ujawnia istnienie klubu zamkniętego dokładnie tym, przed kim jest
// zamknięty. Redaktor widzi podpowiedź w panelu, czytelnik - nic.
//
// i18n PL/EN przez tablice napisów (bez `lang === "pl" ? …`), tokeny motywu
// zamiast kolorów wprost, 6 px zaokrąglenia - jak w pozostałych widgetach.
import { useQuery } from "@tanstack/react-query";
import { AppLink } from "@/components/atoms/AppLink";
import { MessagesSquare, Users, Heart, UserPlus } from "@/lib/lucide-shim";
import type { WidgetContent } from "@/lib/builder/types";
import {
  clubCardQueryOptions,
  clubHubArticlesQueryOptions,
  clubHubCommentsQueryOptions,
  clubHubMembersQueryOptions,
} from "@/lib/builder/clubsQuery";
import {
  CLUB_HUB_DEFAULTS,
  clubHubDateAttr,
  clubHubExcerpt,
  clubHubInitials,
  clubHubLimit,
  formatClubHubDate,
} from "@/lib/builder/clubHub";
import { getBool, getNum, getStr, type Lang } from "./frame";

function locStr(c: WidgetContent, base: string, lang: Lang): string {
  return getStr(c, `${base}_${lang}`) || getStr(c, `${base}_pl`) || getStr(c, `${base}_en`);
}

const T: Record<Lang, Record<string, string>> = {
  pl: {
    articles: "Artykuły",
    comments: "Komentarze",
    signups: "Zapisy",
    members: "członków",
    threads: "wątków",
    replies: "odpowiedzi",
    join: "Dołącz do klubu",
    open: "Zobacz klub",
    joined: "dołączył(a)",
    all: "Zobacz wszystkie",
  },
  en: {
    articles: "Articles",
    comments: "Comments",
    signups: "Sign-ups",
    members: "members",
    threads: "topics",
    replies: "replies",
    join: "Join the club",
    open: "Open the club",
    joined: "joined",
    all: "See all",
  },
};

function SectionShell({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold leading-snug">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ClubHubView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const slug = getStr(c, "clubSlug").trim();
  const t = T[lang];

  const showArticles = getBool(c, "showArticles", true);
  const showComments = getBool(c, "showComments", true);
  const showSignups = getBool(c, "showSignups", true);
  const showHeader = getBool(c, "showHeader", true);
  const showCover = getBool(c, "showCover", true);

  const articlesLimit = clubHubLimit(
    getNum(c, "articlesLimit", CLUB_HUB_DEFAULTS.articlesLimit),
    CLUB_HUB_DEFAULTS.articlesLimit,
  );
  const commentsLimit = clubHubLimit(
    getNum(c, "commentsLimit", CLUB_HUB_DEFAULTS.commentsLimit),
    CLUB_HUB_DEFAULTS.commentsLimit,
  );
  const signupsLimit = clubHubLimit(
    getNum(c, "signupsLimit", CLUB_HUB_DEFAULTS.signupsLimit),
    CLUB_HUB_DEFAULTS.signupsLimit,
  );

  const club = useQuery(clubCardQueryOptions(slug)).data ?? null;
  const clubId = club?.id ?? "";

  const articles =
    useQuery({
      ...clubHubArticlesQueryOptions(clubId, articlesLimit),
      enabled: showArticles && clubId !== "",
    }).data ?? [];
  const comments =
    useQuery({
      ...clubHubCommentsQueryOptions(clubId, commentsLimit),
      enabled: showComments && clubId !== "",
    }).data ?? [];
  const members =
    useQuery({
      ...clubHubMembersQueryOptions(clubId, signupsLimit),
      enabled: showSignups && clubId !== "",
    }).data ?? [];

  if (!club) return null;

  const name = lang === "pl" ? club.name_pl || club.name_en : club.name_en || club.name_pl;
  const tagline =
    lang === "pl"
      ? (club.tagline_pl ?? club.tagline_en ?? "")
      : (club.tagline_en ?? club.tagline_pl ?? "");
  const accent = club.accent_color ?? "";
  const clubHref = `/club/${club.slug}`;
  const joinLabel = locStr(c, "joinLabel", lang) || t.join;
  const memberTotal = members[0]?.total_count ?? club.member_count;

  return (
    <div
      className="overflow-hidden rounded-md border border-border bg-card"
      style={accent !== "" ? { borderTopColor: accent, borderTopWidth: 3 } : undefined}
      data-testid="club-hub"
    >
      {showCover && club.cover_image_url !== null && club.cover_image_url !== "" ? (
        <img
          src={club.cover_image_url}
          alt=""
          loading="lazy"
          className="h-40 w-full object-cover"
        />
      ) : null}

      <div className="space-y-6 p-4 sm:p-5">
        {showHeader ? (
          <header className="space-y-2">
            <AppLink href={clubHref} className="block">
              <h2 className="text-xl font-semibold leading-snug">{name}</h2>
            </AppLink>
            {tagline !== "" ? (
              <p className="line-clamp-2 text-sm text-muted-foreground">{tagline}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                {club.member_count} {t.members}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
                {club.thread_count} {t.threads}
              </span>
            </div>
          </header>
        ) : null}

        {showArticles && articles.length > 0 ? (
          <SectionShell
            title={locStr(c, "articlesTitle", lang) || t.articles}
            action={
              <AppLink href={clubHref} className="text-xs font-medium text-primary">
                {t.all}
              </AppLink>
            }
          >
            <ul className="space-y-2">
              {articles.map((row) => (
                <li key={row.id}>
                  <AppLink
                    href={`${clubHref}/t/${row.slug}`}
                    className="block rounded-md border border-border p-3 transition-colors hover:border-primary/40"
                  >
                    <span className="block text-sm font-semibold leading-snug">{row.title}</span>
                    {row.excerpt !== null && row.excerpt !== "" ? (
                      <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">
                        {clubHubExcerpt(row.excerpt)}
                      </span>
                    ) : null}
                    <span className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      {row.author_name !== null && row.author_name !== "" ? (
                        <span>{row.author_name}</span>
                      ) : null}
                      {clubHubDateAttr(row.created_at) !== "" ? (
                        <time dateTime={clubHubDateAttr(row.created_at)}>
                          {formatClubHubDate(row.created_at, lang)}
                        </time>
                      ) : null}
                      <span className="inline-flex items-center gap-1">
                        <MessagesSquare className="h-3 w-3" aria-hidden="true" />
                        {row.reply_count} {t.replies}
                      </span>
                    </span>
                  </AppLink>
                </li>
              ))}
            </ul>
          </SectionShell>
        ) : null}

        {showComments && comments.length > 0 ? (
          <SectionShell title={locStr(c, "commentsTitle", lang) || t.comments}>
            <ul className="space-y-3">
              {comments.map((row) => (
                <li key={row.id} className="flex gap-3 rounded-md border border-border p-3">
                  {row.author_avatar !== null && row.author_avatar !== "" ? (
                    <img
                      src={row.author_avatar}
                      alt=""
                      loading="lazy"
                      className="h-8 w-8 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground"
                    >
                      {clubHubInitials(row.author_name ?? "")}
                    </span>
                  )}
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium">
                      {row.author_name ?? ""}
                      {clubHubDateAttr(row.created_at) !== "" ? (
                        <time
                          dateTime={clubHubDateAttr(row.created_at)}
                          className="ml-2 font-normal text-muted-foreground"
                        >
                          {formatClubHubDate(row.created_at, lang)}
                        </time>
                      ) : null}
                    </p>
                    <p className="text-sm leading-relaxed text-foreground/90">
                      {clubHubExcerpt(row.body)}
                    </p>
                    {row.thread_slug !== null &&
                    row.thread_slug !== "" &&
                    row.thread_title !== null ? (
                      <AppLink
                        href={`${clubHref}/t/${row.thread_slug}`}
                        className="inline-block text-xs font-medium text-primary"
                      >
                        {row.thread_title}
                      </AppLink>
                    ) : null}
                    {row.like_count > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Heart className="h-3 w-3" aria-hidden="true" />
                        {row.like_count}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </SectionShell>
        ) : null}

        {showSignups ? (
          <SectionShell title={locStr(c, "signupsTitle", lang) || t.signups}>
            <div className="space-y-3">
              {members.length > 0 ? (
                <ul className="space-y-2">
                  {members.map((row) => (
                    <li key={row.user_id} className="flex items-center gap-3">
                      {row.avatar_url !== null && row.avatar_url !== "" ? (
                        <img
                          src={row.avatar_url}
                          alt=""
                          loading="lazy"
                          className="h-8 w-8 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground"
                        >
                          {clubHubInitials(row.display_name ?? "")}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {row.display_name ?? ""}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {[row.job_title, row.current_company].filter(Boolean).join(" · ") ||
                            `${t.joined} ${formatClubHubDate(row.joined_at, lang)}`.trim()}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  {memberTotal} {t.members}
                </span>
                <AppLink
                  href={clubHref}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  {joinLabel}
                </AppLink>
              </div>
            </div>
          </SectionShell>
        ) : null}
      </div>
    </div>
  );
}
