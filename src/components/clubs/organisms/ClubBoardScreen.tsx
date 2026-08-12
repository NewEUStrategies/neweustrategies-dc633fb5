// Organizm: pełna tablica "Szukam / Oferuję".
//
// CO ROBI INACZEJ NIŻ PANEL W SZYNIE. Panel jest streszczeniem: trzy
// ogłoszenia, jeden filtr, kompozytor schowany za przyciskiem. Tutaj tablica
// jest CELEM wizyty, więc:
//
//   * kompozytor stoi OTWARTY na górze - użytkownik, który wszedł na tę
//     stronę, przyszedł albo czytać, albo pisać, a schowany formularz płaci
//     kliknięciem za drugą z tych intencji,
//   * są trzy zakładki: otwarte / moje / archiwum. "Moje" to jedyne miejsce,
//     w którym autor widzi własną historię i może zamknąć ogłoszenie, którego
//     nie ma już na tablicy,
//   * karta jest pełna: treść bez ucinania, stanowisko autora, obszar, licznik
//     ważności i wynik ("załatwione" / "wygasło" / "zdjęte"),
//   * jest paginacja - tablica żywego klubu po pół roku ma sto pozycji.
//
// WYNIK OGŁOSZENIA JEST INFORMACJĄ ZWROTNĄ. "Załatwione" znaczy, że mechanizm
// zadziałał; "wygasło" - że nikt się nie odezwał. Jeden szary napis
// "zamknięte" na obu odbiera autorowi jedyny sygnał, jaki ten moduł produkuje,
// a klubowi - jedyną miarę, czy tablica działa.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckCircle2, Clock, Inbox, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubNoticeKindPill } from "@/components/clubs/atoms/ClubNetworkPrimitives";
import { ClubTopicChip, ClubTopicFilterChip } from "@/components/clubs/atoms/ClubTopicChip";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { ClubBoardComposer } from "@/components/clubs/molecules/ClubBoardPanel";
import { DirectMessageButton } from "@/components/network/DirectMessageButton";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import { useCloseClubBoardNotice, useClubBoardNotices } from "@/lib/clubs/useClubNetwork";
import type { ClubBoardScope } from "@/lib/clubs/useClubNetwork";
import {
  CLUB_NOTICE_KINDS,
  isNoticeExpiringSoon,
  noticeDaysLeft,
  noticeOutcome,
  toClubNoticeKind,
  type ClubNoticeKind,
  type ClubNoticeOutcome,
} from "@/lib/clubs/networkTypes";
import { formatDateShort, uiLang } from "@/lib/i18n/format";

const PAGE_SIZE = 24;

const SCOPES: readonly ClubBoardScope[] = ["open", "mine", "archive"];

/** Wynik ogłoszenia - trzy różne fakty, trzy różne tony. */
function OutcomeMark({ outcome }: { outcome: ClubNoticeOutcome }) {
  const { t, i18n } = useTranslation();
  if (outcome === "open") return null;

  const shape =
    "inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold";
  if (outcome === "resolved") {
    return (
      <span
        className={cn(
          shape,
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        )}
      >
        <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
        {t("club.network.board.outcome.resolved")}
      </span>
    );
  }
  if (outcome === "removed") {
    return (
      <span className={cn(shape, "border-destructive/40 bg-destructive/10 text-destructive")}>
        <ShieldX className="h-3 w-3 shrink-0" aria-hidden="true" />
        {t("club.network.board.outcome.removed")}
      </span>
    );
  }
  return (
    <span className={cn(shape, "border-border/60 bg-muted/50 text-muted-foreground")}>
      <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
      {t("club.network.board.outcome.expired")}
    </span>
  );
}

export function ClubBoardScreen({ clubId, canPost }: { clubId: string; canPost: boolean }) {
  const { t, i18n } = useTranslation();
  const { topics } = useClubTopics();
  const lang = uiLang(i18n.language);

  const [scope, setScope] = useState<ClubBoardScope>("open");
  const [kind, setKind] = useState<ClubNoticeKind | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const query = useClubBoardNotices({
    clubId,
    kind,
    topic,
    scope,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const close = useCloseClubBoardNotice(clubId);

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** Każda zmiana zawężenia wraca na pierwszą stronę - inaczej filtr
   *  z trzema wynikami pokazuje pustkę, bo czytelnik stał na stronie czwartej. */
  const narrow = (change: () => void): void => {
    change();
    setPage(0);
  };

  // Obszary obecne na tablicy - filtr oferujący obszar bez ani jednego
  // ogłoszenia jest obietnicą pustej listy.
  const usedTopics = [...new Set(rows.flatMap((row) => (row.topic !== null ? [row.topic] : [])))];

  return (
    <div className="space-y-4">
      {canPost ? <ClubBoardComposer clubId={clubId} variant="page" /> : null}

      {/* Zakładki zakresu. "Moje" i "archiwum" to nie są filtry tej samej
          listy - to są trzy różne pytania, więc stoją jako zakładki, a nie
          jako kolejne chipy obok rodzaju. */}
      <div
        role="tablist"
        aria-label={t("club.network.board.scopeLabel")}
        className="flex gap-1 border-b border-border/60"
      >
        {SCOPES.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={scope === value}
            onClick={() => narrow(() => setScope(value))}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              scope === value
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`club.network.board.scope.${value}`)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <ClubTopicFilterChip active={kind === null} onClick={() => narrow(() => setKind(null))}>
          {t("club.network.board.filterAll")}
        </ClubTopicFilterChip>
        {CLUB_NOTICE_KINDS.map((value) => (
          <ClubTopicFilterChip
            key={value}
            active={kind === value}
            onClick={() => narrow(() => setKind(kind === value ? null : value))}
          >
            {t(`club.network.board.kind.${value}`)}
          </ClubTopicFilterChip>
        ))}
        {usedTopics.length > 0 ? (
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
        ) : null}
        {usedTopics.map((value) => (
          <ClubTopicChip
            key={value}
            topic={value}
            lang={lang}
            catalog={topics}
            size="sm"
            active={topic === value}
            onSelect={(next) => narrow(() => setTopic(next))}
          />
        ))}
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
          <Inbox className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted-foreground">
            {scope === "mine"
              ? t("club.network.board.emptyMine")
              : kind !== null || topic !== null
                ? t("club.network.board.emptyFiltered")
                : t("club.network.board.empty")}
          </p>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            {t("club.network.board.total", { count: total })}
          </p>

          <ul className="grid gap-2 sm:grid-cols-2">
            {rows.map((row) => {
              const outcome = noticeOutcome(row);
              const daysLeft = noticeDaysLeft(row.expires_at);
              return (
                <li
                  key={row.id}
                  className={cn(
                    "flex flex-col rounded-lg border border-border/60 bg-card p-3 transition-colors sm:p-4",
                    outcome === "open" ? "hover:border-primary/40" : "opacity-75",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ClubNoticeKindPill kind={toClubNoticeKind(row.kind)} />
                    <OutcomeMark outcome={outcome} />
                    <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                      {formatDateShort(row.created_at, lang)}
                    </span>
                  </div>

                  {/* Treść bez ucinania - to jest jedna linia z definicji,
                      a na pełnym ekranie nie ma powodu jej skracać. */}
                  <p className="mt-2 text-sm leading-snug">{row.body}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <ClubTopicChip topic={row.topic} lang={lang} catalog={topics} size="sm" />
                    {outcome === "open" && isNoticeExpiringSoon(row.expires_at) ? (
                      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        {t("club.network.board.expiresIn", { count: daysLeft })}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-2.5">
                    <ClubAuthorAvatar
                      name={row.author_name}
                      avatarUrl={row.author_avatar}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{row.author_name}</p>
                      {row.author_headline !== null ? (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {row.author_headline}
                        </p>
                      ) : null}
                    </div>

                    {/* Ogłoszenie zamknięte nie dostaje przycisku odpowiedzi:
                        sprawa jest załatwiona i pisanie do autora jest tylko
                        kosztem dla niego. */}
                    {outcome === "open" && !row.is_mine ? (
                      <DirectMessageButton
                        userId={row.author_id}
                        displayName={row.author_name}
                        displayAvatar={row.author_avatar}
                        compact
                      />
                    ) : null}
                    {outcome === "open" && row.can_close ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 rounded-lg px-2 text-[11px]"
                        disabled={close.isPending}
                        onClick={() =>
                          close.mutate(row.id, {
                            onSuccess: () =>
                              toast.success(
                                row.is_mine
                                  ? t("club.network.board.closed")
                                  : t("club.network.board.removed"),
                              ),
                            onError: () => toast.error(t("club.network.board.closeFailed")),
                          })
                        }
                      >
                        {row.is_mine
                          ? t("club.network.board.resolve")
                          : t("club.network.board.remove")}
                      </Button>
                    ) : null}
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
        </>
      )}
    </div>
  );
}
