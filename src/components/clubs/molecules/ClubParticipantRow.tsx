// Molekuła: jedna osoba zaangażowana w wątek.
//
// Wkład jest ROZBITY na trzy liczby (wypowiedzi, pytania, źródła), a nie
// zsumowany do jednej. Pięć wypowiedzi i pięć wniesionych dokumentów to dwa
// zupełnie różne rodzaje obecności w dyskusji; jedna liczba "10" zaciera
// właśnie tę różnicę.
//
// Rola klubowa i stanowisko przychodzą z bazy jako `null` w trybie Chatham
// House - i to jest jedyne miejsce, w którym o tym decydujemy: komponent
// renderuje to, co dostał, i nigdy nie próbuje wywnioskować tożsamości.
import { useTranslation } from "react-i18next";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubStatusPill } from "@/components/clubs/atoms/ClubStatusPill";
import { formatDateShort } from "@/lib/i18n/format";
import type { ClubThreadParticipantRow } from "@/lib/clubs/threadWorkspaceTypes";

/**
 * Nazwa gotowa do renderu. Ta sama zasada, co w `toAuthorLabel`: komponent NIE
 * decyduje o anonimowości - dostaje albo imię, albo alias, bo baza już
 * rozstrzygnęła, co wolno pokazać.
 */
export function participantName(
  row: ClubThreadParticipantRow,
  aliasTemplate: string,
  unknownLabel: string,
): string {
  if (row.display_name !== null && row.display_name.length > 0) return row.display_name;
  if (row.alias !== null && row.alias.length > 0)
    return aliasTemplate.replace("{{alias}}", row.alias);
  return unknownLabel;
}

export function ClubParticipantRow({
  row,
  lang,
}: {
  row: ClubThreadParticipantRow;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  const name = participantName(row, t("club.anonymousAuthor"), t("club.deletedAuthor"));
  const anonymous = row.display_name === null;

  const stats = [
    { key: "replies", value: Number(row.reply_count) || 0 },
    { key: "questions", value: Number(row.question_count) || 0 },
    { key: "documents", value: Number(row.document_count) || 0 },
  ].filter((stat) => stat.value > 0);

  return (
    <li className="flex items-start gap-3 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/30">
      <ClubAuthorAvatar name={name} avatarUrl={row.avatar_url} size="md" muted={anonymous} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium">{name}</span>
          {row.is_thread_author ? (
            <ClubStatusPill label={t("club.threadHub.participants.author")} tone="active" />
          ) : null}
          {row.club_role !== null ? (
            <ClubStatusPill label={t(`club.role.${row.club_role}`)} />
          ) : null}
          {row.stance !== null ? <ClubStatusPill label={t(`club.stance.${row.stance}`)} /> : null}
        </div>

        {stats.length > 0 ? (
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {stats.map((stat) => (
              <span key={stat.key} className="tabular-nums">
                {t(`club.threadHub.participants.${stat.key}`, { count: stat.value })}
              </span>
            ))}
          </p>
        ) : null}

        {/* Ostatnia aktywność mówi, czy ta osoba nadal jest w rozmowie -
            uczestnik sprzed trzech miesięcy to inna informacja niż uczestnik
            sprzed godziny. */}
        {row.last_at !== null ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t("club.threadHub.participants.lastActive", {
              date: formatDateShort(row.last_at, lang),
            })}
          </p>
        ) : null}
      </div>

      {row.reactions_received > 0 ? (
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums">{row.reactions_received}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("club.threadHub.participants.reactions")}
          </p>
        </div>
      ) : null}
    </li>
  );
}
