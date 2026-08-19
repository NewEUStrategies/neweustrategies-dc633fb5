// Organizm: katalog ekspertów klubu.
//
// INNE PYTANIE NIŻ PANEL W WĄTKU. Tam pytanie brzmi "kto zna się na tym,
// o czym tu mowa" i odpowiedź ma sześć pozycji. Tutaj brzmi "kto tu się na
// czym zna" - i to jest pytanie, które w think tanku zadaje się przed
// napisaniem czegokolwiek, a odpowiedź na nie zwykle siedzi w głowach trzech
// osób znających wszystkich.
//
// DEKLARACJA OBOK DOROBKU. Każda karta niesie zadeklarowane obszary ORAZ ślad
// pracy w tym klubie (wątki, odpowiedzi, ostatnia aktywność). Sama deklaracja
// jest deklaracją; deklaracja obok trzydziestu wypowiedzi jest argumentem.
// Katalog, który pokazuje tylko checkboxy, zamienia się w listę intencji.
//
// WŁASNA DEKLARACJA STOI NA GÓRZE. To jest jedyny ekran, na którym człowiek
// widzi, czego temu klubowi brakuje - i jedyny moment, w którym uzupełnienie
// własnych obszarów ma dla niego oczywisty sens.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MessagesSquare, Search, UsersRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { ClubTopicFilterChip } from "@/components/clubs/atoms/ClubTopicChip";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { ClubExpertiseEditor } from "@/components/clubs/molecules/ClubRosterPanel";
import { ClubPersonCard } from "@/components/clubs/molecules/ClubPersonCard";
import { MessageOrConnectButton } from "@/components/network/MessageOrConnectButton";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import { useClubExperts, useClubExpertiseAreas } from "@/lib/clubs/useClubNetwork";
import { expertContribution } from "@/lib/clubs/networkTypes";
import { topicLabel } from "@/lib/clubs/topicCatalog";
import { formatDateShort, formatNumber, uiLang } from "@/lib/i18n/format";

const PAGE_SIZE = 24;

export function ClubExpertsScreen({
  clubId,
  canDeclare,
  locale,
}: {
  clubId: string;
  canDeclare: boolean;
  locale: string;
}) {
  const { t, i18n } = useTranslation();
  const { topics } = useClubTopics();
  const lang = uiLang(i18n.language);

  const [topic, setTopic] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const debouncedSearch = useDebouncedValue(search, 250);
  const areasQ = useClubExpertiseAreas(clubId);
  const query = useClubExperts({
    clubId,
    topic,
    search: debouncedSearch,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const areas = areasQ.data ?? [];
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const narrow = (change: () => void): void => {
    change();
    setPage(0);
  };

  return (
    <div className="space-y-4">
      {canDeclare ? <ClubExpertiseEditor clubId={clubId} variant="page" /> : null}

      {/* Obszary z licznikami. Chip bez ani jednej osoby nie istnieje -
          filtr obiecujący pustkę jest gorszy niż brak filtra. */}
      {areas.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <ClubTopicFilterChip active={topic === null} onClick={() => narrow(() => setTopic(null))}>
            {t("club.network.experts.allAreas")}
          </ClubTopicFilterChip>
          {areas.map((area) => (
            <ClubTopicFilterChip
              key={area.topic}
              active={topic === area.topic}
              onClick={() => narrow(() => setTopic(topic === area.topic ? null : area.topic))}
            >
              <span className="truncate">{topicLabel(area.topic, lang, topics)}</span>
              <span className="tabular-nums opacity-70">{area.people}</span>
            </ClubTopicFilterChip>
          ))}
        </div>
      ) : null}

      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(event) => narrow(() => setSearch(event.target.value))}
          placeholder={t("club.network.experts.searchPlaceholder")}
          aria-label={t("club.network.experts.searchPlaceholder")}
          className="rounded-lg pl-9 pr-9"
        />
        {search !== "" ? (
          <button
            type="button"
            onClick={() => narrow(() => setSearch(""))}
            aria-label={t("club.searchClear")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {query.isError ? (
        <ClubErrorNotice onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <div className="grid gap-2 sm:grid-cols-2" aria-busy="true">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-28 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 p-10 text-center">
          <UsersRound className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted-foreground">
            {topic !== null || debouncedSearch.trim() !== ""
              ? t("club.network.experts.emptyFiltered")
              : t("club.network.experts.empty")}
          </p>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            {t("club.network.experts.total", { count: total })}
          </p>

          <ul className="grid gap-2 sm:grid-cols-2">
            {rows.map((row) => {
              const work = expertContribution(row);
              return (
                <li key={row.user_id}>
                  <ClubPersonCard
                    name={row.display_name}
                    avatarUrl={row.avatar_url}
                    profileSlug={row.profile_slug}
                    headline={row.headline}
                    role={row.club_role}
                    topics={row.topics}
                    topicCatalog={topics}
                    active={
                      row.last_active_at !== null &&
                      Date.now() - Date.parse(row.last_active_at) < 86_400_000
                    }
                    meta={
                      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span className="inline-flex items-center gap-1">
                          <MessagesSquare className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {t("club.network.experts.contribution", {
                            count: work,
                            value: formatNumber(work, locale),
                          })}
                        </span>
                        {row.last_active_at !== null ? (
                          <span>
                            {t("club.network.experts.lastActive", {
                              date: formatDateShort(row.last_active_at, lang),
                            })}
                          </span>
                        ) : (
                          <span className="italic">{t("club.network.experts.neverActive")}</span>
                        )}
                      </span>
                    }
                    actions={
                      <MessageOrConnectButton
                        userId={row.user_id}
                        displayName={row.display_name}
                        displayAvatar={row.avatar_url}
                        compact
                      />
                    }
                  />
                </li>
              );
            })}
          </ul>

          {pages > 1 ? (
            <nav
              aria-label={t("club.network.pagination")}
              className={cn("flex items-center justify-between gap-3 pt-1")}
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
        </>
      )}
    </div>
  );
}
