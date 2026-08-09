// Prawa szyna: WĄTKI I ICH ŹRÓDŁA.
//
// PO CO TO STOI PO PRAWEJ. Środkowa kolumna jest jednym strumieniem, w którym
// wątki z sześciu działów lecą jeden pod drugim - i to jest poprawne, bo tak
// się czyta rozmowę. Cena tego układu jest taka, że po trzecim przewinięciu
// nie wiadomo już, ILE tych działów naprawdę żyje i który z nich odezwał się
// dziś. Panel odpowiada dokładnie na to pytanie: pokazuje wątki POGRUPOWANE
// według działu, z którego pochodzą, i robi z pochodzenia rzecz widoczną,
// zamiast zostawiać ją jako szary tekst w pasku meta.
//
// PANEL PATRZY NA CAŁY KLUB, NIE NA BIEŻĄCE ZAWĘŻENIE. Gdyby jechał tym samym
// zapytaniem, co strumień, to po wybraniu działu pokazywałby jedno źródło -
// czyli dokładnie tę informację, którą użytkownik już ma na ekranie. Wartość
// tego panelu polega na tym, że mówi o działach, których w tej chwili NIE
// widać.
//
// KAŻDA NAZWA DZIAŁU JEST PRZYCISKIEM zawężającym strumień. Panel orientacyjny,
// z którego nie da się nigdzie przejść, zmusza do szukania tej samej pozycji
// w lewej szynie - a to jest podatek od tego, że w ogóle spojrzało się w prawo.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MessagesSquare, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClubRailPanel } from "@/components/clubs/atoms/ClubHubPrimitives";
import {
  CLUB_GROUP_CHIP,
  CLUB_GROUP_EDGE,
  CLUB_GROUP_TINT,
  ClubGroupIcon,
  clubGroupAccentVars,
} from "@/components/clubs/atoms/ClubGroupAccent";
import { groupClubThreadsBySource } from "@/lib/clubs/threadSources";
import type { ClubGroupRow, ClubThreadListRow } from "@/lib/clubs/types";
import { formatDateShort } from "@/lib/i18n/format";

export function ClubThreadSourcesPanel({
  clubSlug,
  threads,
  groups,
  activeGroupId,
  onGroupChange,
  isPl,
}: {
  clubSlug: string;
  /** Wątki CAŁEGO klubu w porządku "najnowsze" - patrz nagłówek pliku. */
  threads: readonly ClubThreadListRow[];
  groups: readonly ClubGroupRow[];
  activeGroupId: string | null;
  onGroupChange: (groupId: string | null) => void;
  isPl: boolean;
}) {
  const { t } = useTranslation();
  const lang = isPl ? "pl" : "en";
  const sources = groupClubThreadsBySource({
    threads,
    groups,
    isPl,
    unassignedLabel: t("club.hub.sources.unassigned"),
  });

  // Panel bez treści znika w całości - nagłówek "Wątki i ich źródła" nad pustką
  // opisuje brak danych, a nie klub.
  if (sources.length === 0) return null;

  return (
    <ClubRailPanel
      title={t("club.hub.sources.title")}
      icon={Waypoints}
      action={
        activeGroupId !== null ? (
          <button
            type="button"
            onClick={() => onGroupChange(null)}
            className="rounded-lg px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-primary"
          >
            {t("club.allGroups")}
          </button>
        ) : undefined
      }
    >
      <ul className="flex flex-col gap-2.5">
        {sources.map((source) => {
          const active = source.id !== null && source.id === activeGroupId;
          return (
            <li key={source.id ?? "unassigned"} style={clubGroupAccentVars(source.accent)}>
              {/* Nagłówek źródła. Dział bez identyfikatora (wpisy poza działami)
                  nie jest przyciskiem - nie ma czego zawęzić. */}
              {source.id === null ? (
                <span className="flex w-full items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-left">
                  <SourceIcon icon={source.icon} />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                    {source.name}
                  </span>
                  <SourceCount value={source.threadCount ?? source.matched} />
                </span>
              ) : (
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onGroupChange(active ? null : source.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-1.5 py-1 text-left transition-colors",
                    active
                      ? cn(CLUB_GROUP_TINT, "text-foreground")
                      : "border-transparent text-foreground hover:bg-muted/50",
                  )}
                >
                  <SourceIcon icon={source.icon} />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                    {source.name}
                  </span>
                  <SourceCount value={source.threadCount ?? source.matched} />
                </button>
              )}

              {/* Pionowa krecha w kolorze działu jest CAŁYM powiązaniem wątku ze
                  źródłem - powtarzanie nazwy działu przy każdym tytule zjadłoby
                  kolumnę i tak wąską na 20 rem. */}
              <ul
                className={cn("ml-3 mt-1 flex flex-col gap-1.5 border-l-2 pl-2.5", CLUB_GROUP_EDGE)}
              >
                {source.threads.map((thread) => {
                  const stamp = thread.last_reply_at ?? thread.created_at;
                  return (
                    <li key={thread.id}>
                      <Link
                        to="/club/$clubSlug/t/$threadSlug"
                        params={{ clubSlug, threadSlug: thread.slug }}
                        className="group/source block rounded-lg px-1 py-0.5 hover:bg-muted/50"
                      >
                        <span className="flex items-start gap-1.5">
                          {thread.is_unread ? (
                            <span
                              aria-label={t("club.hub.sources.unread")}
                              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                            />
                          ) : null}
                          <span className="line-clamp-2 text-[13px] font-medium leading-snug group-hover/source:text-primary">
                            {thread.title}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <MessagesSquare className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="tabular-nums">{thread.reply_count}</span>
                          <span aria-hidden="true">·</span>
                          <time dateTime={stamp}>{formatDateShort(stamp, lang)}</time>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </ClubRailPanel>
  );
}

function SourceIcon({ icon }: { icon: string | null }) {
  return (
    <span
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
        CLUB_GROUP_CHIP,
      )}
    >
      <ClubGroupIcon icon={icon} className="h-3 w-3" />
    </span>
  );
}

function SourceCount({ value }: { value: number }) {
  return (
    <span className="shrink-0 rounded-md bg-muted px-1 text-[11px] tabular-nums text-muted-foreground">
      {value}
    </span>
  );
}
