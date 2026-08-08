// Organizm: panel „Uczestnicy".
//
// Odpowiada na pytanie, którego licznik „12 odpowiedzi" nie zadaje: KTO tu
// właściwie jest. Lista jest liczona z TREŚCI (wypowiedzi, pytania, źródła),
// a nie z listy członków klubu - członek, który nic nie napisał, nie jest
// uczestnikiem tego wątku, i to jest cała wartość panelu.
//
// Nad listą stoi rozkład wkładu: pięć osób po dwie wypowiedzi to inna
// dyskusja niż jedna osoba z dziesięcioma, a lista sama tego nie pokazuje.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users2 } from "lucide-react";
import { ClubWorkspaceEmpty } from "@/components/clubs/atoms/ClubWorkspaceEmpty";
import { ClubThreadListSkeleton } from "@/components/clubs/atoms/ClubSkeletons";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import {
  ClubParticipantRow,
  participantName,
} from "@/components/clubs/molecules/ClubParticipantRow";
import { useClubThreadParticipants } from "@/lib/clubs/useClubWorkspace";
import { toContributionBars } from "@/lib/clubs/workspaceTypes";

export function ClubThreadParticipantsPanel({
  threadId,
  lang,
}: {
  threadId: string;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  const query = useClubThreadParticipants({ threadId });
  const rows = useMemo(() => query.data ?? [], [query.data]);

  const aliasTemplate = t("club.anonymousAuthor");
  const unknownLabel = t("club.deletedAuthor");
  const bars = useMemo(
    () => toContributionBars(rows, (row) => participantName(row, aliasTemplate, unknownLabel)),
    [rows, aliasTemplate, unknownLabel],
  );

  if (query.isPending) return <ClubThreadListSkeleton count={4} />;
  if (query.isError) return <ClubErrorNotice onRetry={() => void query.refetch()} />;

  if (rows.length === 0) {
    return (
      <ClubWorkspaceEmpty
        icon={<Users2 className="h-5 w-5" />}
        title={t("club.workspace.participants.empty")}
        hint={t("club.workspace.participants.emptyHint")}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Rozkład wkładu: gołe SVG-free słupki na diwach. Osiem pozycji nie
          potrzebuje biblioteki do wykresów, a każda taka biblioteka kosztuje
          kilkadziesiąt kB na trasie, która ma być szybka (ta sama decyzja,
          co w `ClubThreadPulse`). */}
      {bars.length > 1 ? (
        <section
          aria-label={t("club.workspace.participants.distribution")}
          className="rounded-xl border border-border/60 bg-card p-3 sm:p-4"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("club.workspace.participants.distribution")}
          </h3>
          <ul className="mt-3 space-y-2">
            {bars.map((bar) => (
              <li
                key={bar.key}
                className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2"
              >
                <span className="truncate text-xs">{bar.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary/70 transition-[width] duration-500"
                    style={{ width: `${Math.max(4, Math.round(bar.ratio * 100))}%` }}
                  />
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{bar.value}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ul className="space-y-2">
        {rows.map((row) => (
          <ClubParticipantRow key={row.participant_key} row={row} lang={lang} />
        ))}
      </ul>
    </div>
  );
}
