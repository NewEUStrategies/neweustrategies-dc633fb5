// Organizm: szyna kontekstu wątku (prawa kolumna huba).
//
// PO CO ONA JEST. Panel, do którego trzeba kliknąć, nie istnieje dla kogoś,
// kto nie wie, że tam coś jest. Szyna pokazuje NAJWAŻNIEJSZĄ jedną rzecz
// z każdego panelu bez klikania: najbliższy termin, pierwsze pytanie bez
// odpowiedzi, dokument podstawowy, otwarte głosowanie. Reszta zostaje
// w panelach.
//
// Każda karta pojawia się WYŁĄCZNIE, gdy ma co pokazać. Szyna złożona
// z sześciu pustych stanów jest gorsza niż jej brak - uczy przewijać obok.
//
// Zapytania są WSPÓŁDZIELONE z panelami przez klucze React Query, więc
// otwarcie panelu po obejrzeniu szyny nie kosztuje drugiego round-tripu.
import { useTranslation } from "react-i18next";
import { CalendarClock, FileText, HelpCircle, Link2, Users2, Vote } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ClubContextCard } from "@/components/clubs/molecules/ClubContextCard";
import { ClubDocumentIcon } from "@/components/clubs/atoms/ClubEntryIcon";
import { ClubStatusPill, milestoneTone } from "@/components/clubs/atoms/ClubStatusPill";
import { participantName } from "@/components/clubs/molecules/ClubParticipantRow";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { milestoneWhen } from "@/components/clubs/molecules/ClubMilestoneRow";
import {
  useClubThreadDocuments,
  useClubThreadLinks,
  useClubThreadMilestones,
  useClubThreadParticipants,
  useClubThreadPolls,
  useClubThreadQuestions,
} from "@/lib/clubs/useThreadWorkspace";
import {
  groupSchedule,
  toClubDocumentKind,
  toClubMilestoneStatus,
  type ClubWorkspacePanel,
  type ClubWorkspaceSummary,
} from "@/lib/clubs/threadWorkspaceTypes";

export function ClubThreadContextRail({
  threadId,
  lang,
  summary,
  onOpenPanel,
}: {
  threadId: string;
  lang: "pl" | "en";
  summary: ClubWorkspaceSummary;
  onOpenPanel: (panel: ClubWorkspacePanel) => void;
}) {
  const { t } = useTranslation();

  // Każde zapytanie włączone tylko wtedy, gdy licznik ze spisu treści mówi,
  // że jest co pobierać. Szyna nie może kosztować sześciu zapytań po pustkę
  // przy każdym otwarciu wątku.
  // Bez własnego `limit`: klucz React Query nie niesie limitu, więc szyna
  // i nagłówek muszą pytać TAK SAMO - inaczej ten, który trafi pierwszy,
  // zapisałby swoją krótszą listę pod kluczem, z którego czyta drugi.
  // Przycinamy po stronie widoku.
  const participantsQ = useClubThreadParticipants({
    threadId,
    enabled: summary.participants > 0,
  });
  const milestonesQ = useClubThreadMilestones({
    threadId,
    enabled: summary.upcoming > 0,
  });
  const documentsQ = useClubThreadDocuments({
    threadId,
    enabled: summary.documents > 0,
  });
  const questionsQ = useClubThreadQuestions({
    threadId,
    status: "open",
    enabled: summary.openQuestions > 0,
  });
  const pollsQ = useClubThreadPolls({ threadId, enabled: summary.openPolls > 0 });
  const linksQ = useClubThreadLinks({ threadId, enabled: summary.links > 0 });

  const aliasTemplate = t("club.anonymousAuthor");
  const unknownLabel = t("club.deletedAuthor");

  const participants = participantsQ.data ?? [];
  const upcoming = groupSchedule(milestonesQ.data ?? [], new Date()).filter(
    (group) => group.key !== "past",
  );
  const nextMilestones = upcoming.flatMap((group) => group.items).slice(0, 3);
  // Dokument podstawowy najpierw - RPC sortuje `is_primary DESC`, więc bierzemy
  // po prostu wierzchołek listy.
  const documents = (documentsQ.data ?? []).slice(0, 3);
  const questions = (questionsQ.data ?? []).slice(0, 2);
  const openPolls = (pollsQ.data ?? []).filter((row) => row.poll_status === "open").slice(0, 2);
  const links = (linksQ.data ?? []).slice(0, 3);

  const seeAll = t("club.threadHub.seeAll");

  return (
    <aside aria-label={t("club.threadHub.contextLabel")} className="flex flex-col gap-3">
      {participants.length > 0 ? (
        <ClubContextCard
          icon={<Users2 className="h-3.5 w-3.5" />}
          title={t("club.threadHub.panel.participants")}
          count={summary.participants}
          onOpen={() => onOpenPanel("participants")}
          openLabel={seeAll}
        >
          <ul className="space-y-2">
            {participants.slice(0, 5).map((row) => {
              const name = participantName(row, aliasTemplate, unknownLabel);
              const contributions =
                (Number(row.reply_count) || 0) +
                (Number(row.question_count) || 0) +
                (Number(row.document_count) || 0);
              return (
                <li key={row.participant_key} className="flex items-center gap-2">
                  <ClubAuthorAvatar
                    name={name}
                    avatarUrl={row.avatar_url}
                    muted={row.display_name === null}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs">{name}</span>
                  {contributions > 0 ? (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {contributions}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </ClubContextCard>
      ) : null}

      {nextMilestones.length > 0 ? (
        <ClubContextCard
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          title={t("club.threadHub.nextUp")}
          count={summary.upcoming}
          onOpen={() => onOpenPanel("schedule")}
          openLabel={seeAll}
        >
          <ul className="space-y-2.5">
            {nextMilestones.map((row) => (
              <li key={row.id}>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 text-xs font-medium leading-snug">
                    {row.title}
                  </span>
                  <ClubStatusPill
                    label={t(`club.threadHub.milestoneStatus.${toClubMilestoneStatus(row.status)}`)}
                    tone={milestoneTone(toClubMilestoneStatus(row.status))}
                  />
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  <time dateTime={row.starts_at}>{milestoneWhen(row, lang)}</time>
                </p>
              </li>
            ))}
          </ul>
        </ClubContextCard>
      ) : null}

      {questions.length > 0 ? (
        <ClubContextCard
          icon={<HelpCircle className="h-3.5 w-3.5" />}
          title={t("club.threadHub.unanswered")}
          count={summary.openQuestions}
          onOpen={() => onOpenPanel("questions")}
          openLabel={seeAll}
        >
          <ul className="space-y-2">
            {questions.map((row) => (
              <li key={row.id} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {row.vote_count}
                </span>
                <p className="line-clamp-2 text-xs leading-snug">{row.body}</p>
              </li>
            ))}
          </ul>
        </ClubContextCard>
      ) : null}

      {documents.length > 0 ? (
        <ClubContextCard
          icon={<FileText className="h-3.5 w-3.5" />}
          title={t("club.threadHub.panel.documents")}
          count={summary.documents}
          onOpen={() => onOpenPanel("documents")}
          openLabel={seeAll}
        >
          <ul className="space-y-2">
            {documents.map((row) => {
              const kind = toClubDocumentKind(row.kind);
              const label = (
                <>
                  <span className="mt-0.5 shrink-0 text-muted-foreground">
                    <ClubDocumentIcon kind={kind} className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-xs leading-snug">{row.title}</span>
                    {row.source_label !== null && row.source_label.length > 0 ? (
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {row.source_label}
                      </span>
                    ) : null}
                  </span>
                </>
              );
              return (
                <li key={row.id}>
                  {row.url !== null && row.url.length > 0 ? (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2 underline-offset-2 hover:underline"
                    >
                      {label}
                    </a>
                  ) : (
                    <span className="flex items-start gap-2">{label}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </ClubContextCard>
      ) : null}

      {openPolls.length > 0 ? (
        <ClubContextCard
          icon={<Vote className="h-3.5 w-3.5" />}
          title={t("club.threadHub.panel.polls")}
          count={summary.openPolls}
          onOpen={() => onOpenPanel("polls")}
          openLabel={t("club.threadHub.vote")}
        >
          <ul className="space-y-2">
            {openPolls.map((row) => (
              <li key={row.id} className="text-xs leading-snug">
                {lang === "pl" ? row.question_pl : row.question_en}
              </li>
            ))}
          </ul>
        </ClubContextCard>
      ) : null}

      {links.length > 0 ? (
        <ClubContextCard
          icon={<Link2 className="h-3.5 w-3.5" />}
          title={t("club.threadHub.panel.links")}
          count={summary.links}
          onOpen={() => onOpenPanel("links")}
          openLabel={seeAll}
        >
          <ul className="space-y-2">
            {links.map((row) => (
              <li key={row.id}>
                <Link
                  to="/club/$clubSlug/t/$threadSlug"
                  params={{ clubSlug: row.club_slug, threadSlug: row.thread_slug }}
                  className="line-clamp-2 text-xs leading-snug underline-offset-2 hover:underline"
                >
                  {row.title}
                </Link>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t(
                    `club.threadHub.relation.${row.direction === "incoming" ? "incoming" : "outgoing"}.${row.relation}`,
                  )}
                </p>
              </li>
            ))}
          </ul>
        </ClubContextCard>
      ) : null}
    </aside>
  );
}
