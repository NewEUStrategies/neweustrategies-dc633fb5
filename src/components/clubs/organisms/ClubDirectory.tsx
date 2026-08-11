// Siatka klubów - sekcja "moje kluby" i "odkryj".
//
// Wyciągnięte ze strony, bo hub używa tego DWA razy z różnymi zbiorami, a
// wcześniejsza wersja trzymała kartę klubu w tym samym pliku, co logika
// zaproszeń i filtrowania. Karta klubu jest jedna - jeśli kiedyś dojdzie do
// niej odznaka albo licznik nieprzeczytanych, dojdzie w jednym miejscu.
//
// UKŁADY. Cztery warianty z tego samego słownika, co układ strony klubu:
//
//   `cards`     - siatka z okładką 16:9 i fragmentem opisu. Domyślny.
//   `list`      - gęsty wiersz z miniaturą. Dla osób w wielu klubach naraz;
//                 mieści trzy razy więcej pozycji na ekranie.
//   `magazine`  - pierwszy klub jako duży kafel z pełną okładką i dłuższym
//                 fragmentem, reszta wierszami. Dla huba z jednym klubem,
//                 który realnie żyje.
//   `editorial` - wariant ARCHITECTURAL PRESTIGE: ostre, instytucjonalne
//                 karty z okładką, subtelnymi obramowaniami i złotym akcentem.
//                 Domyślny dla huba.
//
// Fragment (`tagline`) jest we WSZYSTKICH wariantach - różni się tylko
// liczbą linii. Klub bez zdania wyjaśniającego, po co istnieje, jest w
// katalogu nie do odróżnienia od sąsiada.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Layers, MessagesSquare, Users2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ClubCover } from "@/components/clubs/atoms/ClubCover";
import { ClubDirectorySkeleton } from "@/components/clubs/atoms/ClubSkeletons";
import { ClubTopicChip } from "@/components/clubs/atoms/ClubTopicChip";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import { CLUB_VISIBILITIES, type ClubLayout, type ClubVisibility } from "@/lib/clubs/types";

export interface ClubDirectoryCard {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  tagline_pl: string | null;
  tagline_en: string | null;
  cover_image_url: string | null;
  policy_area: string | null;
  visibility: string;
  member_count: number;
  thread_count: number;
  group_count: number;
  /** Stan członkostwa wołającego użytkownika w tym klubie. */
  my_status?: string | null;
  /** Czy wołający może czytać treść klubu (publiczny / uprawniony plan). */
  can_read?: boolean;
  /** Data ostatniej aktywności w klubie. */
  last_activity_at?: string | null;
}

function asVisibility(value: string): ClubVisibility {
  return (CLUB_VISIBILITIES as readonly string[]).includes(value)
    ? (value as ClubVisibility)
    : "members";
}

function clubName(club: ClubDirectoryCard, isPl: boolean): string {
  return isPl ? club.name_pl : club.name_en;
}

function clubExcerpt(club: ClubDirectoryCard, isPl: boolean): string | null {
  const value = isPl ? club.tagline_pl : club.tagline_en;
  return value !== null && value.trim() !== "" ? value : null;
}

function clubAccess(
  club: ClubDirectoryCard,
): import("@/lib/clubs/hubAccess").ClubHubAccess | null {
  if (club.my_status === "active") return "member";
  if (club.my_status === "invited") return "invited";
  if (club.can_read) return "entitled";
  return "locked";
}

function ctaLabel(access: import("@/lib/clubs/hubAccess").ClubHubAccess | null, t: (k: string) => string): string {
  switch (access) {
    case "member":
      return t("club.hub.enterWorkspace");
    case "invited":
      return t("club.hub.requestAccess");
    case "entitled":
      return t("club.hub.enterPortal");
    case "locked":
    default:
      return t("club.hub.requestAccess");
  }
}

function ClubStats({ club, isPl }: { club: ClubDirectoryCard; isPl: boolean }) {
  const { t } = useTranslation();
  const { topics } = useClubTopics();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Users2 className="h-3.5 w-3.5" aria-hidden="true" />
        {t("club.membersCount", { count: club.member_count })}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
        {t("club.threadsCount", { count: club.thread_count })}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Layers className="h-3.5 w-3.5" aria-hidden="true" />
        {t("club.groupsCount", { count: club.group_count })}
      </span>
      <ClubTopicChip
        topic={club.policy_area}
        lang={isPl ? "pl" : "en"}
        catalog={topics}
        size="sm"
      />
    </div>
  );
}

function CardTile({ club, isPl }: { club: ClubDirectoryCard; isPl: boolean }) {
  const { t } = useTranslation();
  const excerpt = clubExcerpt(club, isPl);
  return (
    <Link
      to="/club/$clubSlug"
      params={{ clubSlug: club.slug }}
      className="group flex flex-col overflow-hidden rounded-lg border border-border/60 bg-card transition-colors hover:border-primary/40"
    >
      <ClubCover url={club.cover_image_url} variant="card" />
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium leading-tight group-hover:text-primary">
            {clubName(club, isPl)}
          </h3>
          <Badge variant="outline" className="shrink-0 text-[11px]">
            {t(`club.visibility.${asVisibility(club.visibility)}`)}
          </Badge>
        </div>
        {excerpt !== null ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{excerpt}</p>
        ) : null}
        <div className="mt-auto pt-2.5">
          <ClubStats club={club} isPl={isPl} />
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary opacity-80 transition-opacity group-hover:opacity-100">
            {t("club.hub.goToThreads")}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function ListRow({ club, isPl }: { club: ClubDirectoryCard; isPl: boolean }) {
  const { t } = useTranslation();
  const excerpt = clubExcerpt(club, isPl);
  return (
    <Link
      to="/club/$clubSlug"
      params={{ clubSlug: club.slug }}
      className="group flex gap-3 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/40"
    >
      <ClubCover
        url={club.cover_image_url}
        variant="card"
        className="w-20 shrink-0 rounded-md sm:w-28"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-medium leading-tight group-hover:text-primary">
            {clubName(club, isPl)}
          </h3>
          <Badge variant="outline" className="shrink-0 text-[11px]">
            {t(`club.visibility.${asVisibility(club.visibility)}`)}
          </Badge>
        </div>
        {excerpt !== null ? (
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground sm:line-clamp-2">
            {excerpt}
          </p>
        ) : null}
        <div className="mt-2">
          <ClubStats club={club} isPl={isPl} />
        </div>
      </div>
    </Link>
  );
}

function MagazineLead({ club, isPl }: { club: ClubDirectoryCard; isPl: boolean }) {
  const { t } = useTranslation();
  const excerpt = clubExcerpt(club, isPl);
  return (
    <Link
      to="/club/$clubSlug"
      params={{ clubSlug: club.slug }}
      className="group grid overflow-hidden rounded-xl border border-border/60 bg-card transition-colors hover:border-primary/40 md:grid-cols-2"
    >
      <ClubCover url={club.cover_image_url} variant="card" className="rounded-none md:h-full" />
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-semibold leading-tight group-hover:text-primary">
            {clubName(club, isPl)}
          </h3>
          <Badge variant="outline" className="shrink-0 text-[11px]">
            {t(`club.visibility.${asVisibility(club.visibility)}`)}
          </Badge>
        </div>
        {excerpt !== null ? (
          <p className="line-clamp-3 text-sm text-muted-foreground">{excerpt}</p>
        ) : null}
        <div className="mt-auto pt-2">
          <ClubStats club={club} isPl={isPl} />
        </div>
      </div>
    </Link>
  );
}

function PrestigeCard({
  club,
  isPl,
  featured = false,
}: {
  club: ClubDirectoryCard;
  isPl: boolean;
  featured?: boolean;
}) {
  const { t } = useTranslation();
  const excerpt = clubExcerpt(club, isPl);
  const access = clubAccess(club);
  const label = ctaLabel(access, t);

  return (
    <Link
      to="/club/$clubSlug"
      params={{ clubSlug: club.slug }}
      className={`group flex flex-col overflow-hidden rounded-md border transition-all duration-500 ${
        featured
          ? "border-primary/40 bg-foreground/[0.04] hover:border-primary hover:shadow-[0_20px_50px_rgba(0,0,0,0.25)]"
          : "border-border/60 bg-foreground/[0.02] hover:border-primary/50 hover:shadow-[0_20px_40px_rgba(0,0,0,0.25)]"
      }`}
    >
      <div className="relative h-48 overflow-hidden">
        <div
          className={`h-full w-full transition-all duration-700 ${
            featured ? "opacity-100" : "opacity-50 grayscale group-hover:opacity-100 group-hover:grayscale-0"
          }`}
        >
          <ClubCover
            url={club.cover_image_url}
            variant="card"
            className="h-full w-full rounded-none border-0 transition-transform duration-700 group-hover:scale-105"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
        <div className="absolute left-4 top-4">
          {featured ? (
            <span className="bg-primary px-2 py-1 text-[8px] font-black uppercase tracking-widest text-primary-foreground rounded-[4px]">
              {t("club.hub.activeNow")}
            </span>
          ) : (
            <span className="border-border/60 bg-background/80 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-foreground backdrop-blur-md rounded-[4px] border">
              {t(`club.visibility.${asVisibility(club.visibility)}`)}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-6 md:p-8">
        <h3 className="text-lg font-bold leading-tight text-foreground group-hover:text-primary transition-colors md:text-xl">
          {clubName(club, isPl)}
        </h3>
        {excerpt !== null ? (
          <p className="mt-4 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {excerpt}
          </p>
        ) : null}

        <div className="mt-auto">
          <div className="mb-6 flex items-center justify-between text-[10px] font-bold uppercase tracking-tighter text-muted-foreground">
            <span className="text-foreground">{t("club.membersCount", { count: club.member_count })}</span>
            <div className="h-4 w-px bg-border/60" />
            <span className={featured ? "text-primary" : "text-muted-foreground/70"}>
              {t("club.threadsCount", { count: club.thread_count })}
            </span>
          </div>

          <span
            className={`block w-full rounded-md py-4 text-center text-[9px] font-black uppercase tracking-[0.3em] transition-all duration-300 ${
              featured
                ? "bg-primary text-primary-foreground hover:bg-primary-foreground hover:text-primary"
                : "border border-border/60 text-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground"
            }`}
          >
            {label}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function ClubDirectory({
  title,
  empty,
  clubs,
  isPl,
  loading,
  layout = "cards",
  action,
}: {
  title: string;
  empty: string;
  clubs: readonly ClubDirectoryCard[];
  isPl: boolean;
  loading: boolean;
  layout?: ClubLayout;
  action?: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>

      {loading ? (
        <ClubDirectorySkeleton layout={layout} />
      ) : clubs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : layout === "list" ? (
        <div className="flex flex-col gap-2">
          {clubs.map((club) => (
            <ListRow key={club.id} club={club} isPl={isPl} />
          ))}
        </div>
      ) : layout === "magazine" ? (
        <div className="space-y-3">
          <MagazineLead club={clubs[0]} isPl={isPl} />
          {clubs.length > 1 ? (
            <div className="flex flex-col gap-2">
              {clubs.slice(1).map((club) => (
                <ListRow key={club.id} club={club} isPl={isPl} />
              ))}
            </div>
          ) : null}
        </div>
      ) : layout === "editorial" ? (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {clubs.map((club, index) => (
            <PrestigeCard key={club.id} club={club} isPl={isPl} featured={index === 0} />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {clubs.map((club) => (
            <CardTile key={club.id} club={club} isPl={isPl} />
          ))}
        </div>
      )}
    </section>
  );
}
