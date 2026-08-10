// Organizm: pełny dorobek klubu - co powstało ze wspólnych rozmów.
//
// TO NIE JEST DRUGA BIBLIOTEKA. Biblioteka odpowiada na pytanie "jakie mamy
// pliki" i ma własny ekran z filtrem rodzaju, wyszukiwaniem i wgrywaniem.
// Ten ekran odpowiada na jedno pytanie: co wynikło z tego, że ci ludzie ze
// sobą rozmawiali - więc każda pozycja jest ZŁOŻONA z trzech rzeczy:
// materiału, rozmowy, z której wyrósł, i twarzy osób, które ją prowadziły.
//
// UKŁAD JEST DOWODEM. Materiał bez rozmowy to zwykły plik i stoi niżej;
// materiał z rozmową i sześcioma współautorami jest dowodem, że networking
// daje wynik - i to on ma być pierwszą rzeczą, którą widać po wejściu.
//
// Regułę Chatham House egzekwuje baza: w klubie, który jej używa, twarze nie
// wychodzą wcale, a materiał zostaje. Ten ekran nie ma o tym wiedzieć.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Award, ExternalLink, MessagesSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubDocumentKindIcon } from "@/components/clubs/atoms/ClubWorkspaceBadges";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { useClubOutput } from "@/lib/clubs/useClubNetwork";
import { documentHref, toDocumentKind } from "@/lib/clubs/workspaceTypes";
import { formatDateShort } from "@/lib/i18n/format";

const PAGE_SIZE = 12;

export function ClubOutputScreen({
  clubId,
  clubSlug,
  isPl,
}: {
  clubId: string;
  clubSlug: string;
  isPl: boolean;
}) {
  const { t } = useTranslation();
  const lang = isPl ? "pl" : "en";
  const [page, setPage] = useState(0);

  const query = useClubOutput({ clubId, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  const entries = query.data?.entries ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (query.isError) return <ClubErrorNotice onRetry={() => void query.refetch()} />;

  if (query.isPending) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-32 animate-pulse rounded-lg bg-muted/50" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-10 text-center">
        <Award className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {t("club.network.output.empty")}
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4 rounded-lg">
          <Link to="/club/$clubSlug/documents" params={{ clubSlug }}>
            {t("club.network.output.toLibrary")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        {t("club.network.output.count", { count: total })}
      </p>

      <ul className="space-y-2">
        {entries.map(({ row, contributors }) => {
          const href = documentHref(row);
          const title = isPl ? row.title_pl : row.title_en;
          const summary = isPl ? row.summary_pl : row.summary_en;

          return (
            <li
              key={row.id}
              className="rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/40 sm:p-4"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40">
                  <ClubDocumentKindIcon
                    kind={toDocumentKind(row.kind)}
                    className="h-4 w-4 text-muted-foreground"
                  />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-lg text-[10px]">
                      {t(`club.docs.kind.${toDocumentKind(row.kind)}`)}
                    </Badge>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {formatDateShort(row.published_at ?? "", lang)}
                    </span>
                  </div>

                  {href !== null ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-start gap-1.5 text-base font-semibold leading-tight hover:text-primary"
                    >
                      <span>{title}</span>
                      <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    </a>
                  ) : (
                    <h3 className="mt-1 text-base font-semibold leading-tight">{title}</h3>
                  )}

                  {summary !== null && summary.trim() !== "" ? (
                    <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{summary}</p>
                  ) : null}

                  {/* PROWENIENCJA. Bez niej to jest lista plików. */}
                  {row.thread_slug !== null && row.thread_title !== null ? (
                    <Link
                      to="/club/$clubSlug/t/$threadSlug"
                      params={{ clubSlug, threadSlug: row.thread_slug }}
                      className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      <MessagesSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {t("club.network.output.fromThread", { title: row.thread_title })}
                      </span>
                    </Link>
                  ) : (
                    <p className="mt-2 text-xs italic text-muted-foreground">
                      {t("club.network.output.noThread")}
                    </p>
                  )}

                  {contributors.length > 0 ? (
                    <div className="mt-2.5 border-t border-border/60 pt-2.5">
                      <p className="text-[11px] font-medium text-muted-foreground">
                        {t("club.network.output.contributors", { count: row.contributor_count })}
                      </p>
                      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
                        {contributors.map((person) => (
                          <li key={person.userId} className="flex items-center gap-1.5">
                            <ClubAuthorAvatar
                              name={person.name}
                              avatarUrl={person.avatarUrl}
                              size="sm"
                            />
                            {person.slug !== null ? (
                              <Link
                                to="/author/$slug"
                                params={{ slug: person.slug }}
                                className="text-xs hover:text-primary"
                              >
                                {person.name}
                              </Link>
                            ) : (
                              <span className="text-xs">{person.name}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {pages > 1 ? (
        <nav
          aria-label={t("club.network.pagination")}
          className="flex items-center justify-between gap-3 pt-1"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-lg"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            {t("club.network.prev")}
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("club.network.pageOf", { page: page + 1, pages })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-lg"
            disabled={page + 1 >= pages}
            onClick={() => setPage((current) => current + 1)}
          >
            {t("club.network.next")}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
