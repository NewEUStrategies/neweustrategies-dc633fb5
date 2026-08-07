// Siatka klubów - sekcja "moje kluby" i "odkryj".
//
// Wyciągnięte ze strony, bo hub używa tego DWA razy z różnymi zbiorami, a
// wcześniejsza wersja trzymała kartę klubu w tym samym pliku, co logika
// zaproszeń i filtrowania. Karta klubu jest jedna - jeśli kiedyś dojdzie do
// niej odznaka albo licznik nieprzeczytanych, dojdzie w jednym miejscu.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Layers, MessagesSquare, Users2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ClubCover } from "@/components/clubs/atoms/ClubCover";
import { areaLabel } from "@/lib/tracker/stages";
import { CLUB_VISIBILITIES, type ClubVisibility } from "@/lib/clubs/types";

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
}

function asVisibility(value: string): ClubVisibility {
  return (CLUB_VISIBILITIES as readonly string[]).includes(value)
    ? (value as ClubVisibility)
    : "members";
}

export function ClubDirectory({
  title,
  empty,
  clubs,
  isPl,
  loading,
}: {
  title: string;
  empty: string;
  clubs: readonly ClubDirectoryCard[];
  isPl: boolean;
  loading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : clubs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.map((club) => (
            <Link
              key={club.id}
              to="/club/$clubSlug"
              params={{ clubSlug: club.slug }}
              className="group flex flex-col overflow-hidden rounded-lg border border-border/60 bg-card transition-colors hover:border-primary/40"
            >
              <ClubCover url={club.cover_image_url} variant="card" />
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium leading-tight group-hover:text-primary">
                    {isPl ? club.name_pl : club.name_en}
                  </h3>
                  <Badge variant="outline" className="shrink-0 text-[11px]">
                    {t(`club.visibility.${asVisibility(club.visibility)}`)}
                  </Badge>
                </div>
                {club.policy_area !== null && club.policy_area.trim() !== "" ? (
                  <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                    {areaLabel(club.policy_area, isPl ? "pl" : "en")}
                  </p>
                ) : null}
                {(isPl ? club.tagline_pl : club.tagline_en) ? (
                  <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                    {isPl ? club.tagline_pl : club.tagline_en}
                  </p>
                ) : null}
                <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Users2 className="h-3.5 w-3.5" />
                    {t("club.membersCount", { count: club.member_count })}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MessagesSquare className="h-3.5 w-3.5" />
                    {t("club.threadsCount", { count: club.thread_count })}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" />
                    {t("club.groupsCount", { count: club.group_count })}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
