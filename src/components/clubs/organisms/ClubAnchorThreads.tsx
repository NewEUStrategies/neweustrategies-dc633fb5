// Szew międzymodułowy: "o tym rozmawiają w klubach".
//
// Strona aktu prawnego, wydarzenia albo wpisu nie wie NIC o modelu klubów -
// podaje własny typ i identyfikator, dostaje listę wątków, które ktoś do niej
// przypiął. Cała wiedza o widoczności siedzi po stronie RPC
// (`club_threads_for_anchor` liczy `club_capabilities` per wiersz), więc ten
// komponent nie ma czego sprawdzać i nie próbuje.
//
// ZNIKA CAŁKOWICIE, gdy nie ma wątków. To jest ważniejsze, niż wygląda:
// sekcja "Dyskusje w klubach: brak" na stronie każdego aktu prawnego mówiłaby
// czytelnikowi bez dostępu, że kluby istnieją i coś się w nich dzieje, a przy
// klubie `secret` byłaby dokładnie tym wyciekiem, którego reszta warstwy
// pilnuje. Pusty wynik i brak dostępu wyglądają tu identycznie - celowo.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { MessageSquare, MessagesSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useClubThreadsForAnchor } from "@/lib/clubs/useClubs";
import type { ClubAnchorType } from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

export type { ClubAnchorType };

export function ClubAnchorThreads({
  anchorType,
  anchorId,
  limit = 5,
  className,
}: {
  anchorType: ClubAnchorType;
  anchorId: string | undefined;
  limit?: number;
  className?: string;
}) {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const threadsQ = useClubThreadsForAnchor({ anchorType, anchorId, limit });

  const rows = threadsQ.data ?? [];
  // Brak wyniku, trwające zapytanie i błąd dają ten sam efekt: nic. Szkielet
  // ładowania też nie, bo mrugnąłby na stronie, na której często nic nie ma.
  if (rows.length === 0) return null;

  return (
    <section className={className} aria-labelledby="club-anchor-heading">
      <h2
        id="club-anchor-heading"
        className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground"
      >
        <MessagesSquare className="h-4 w-4" />
        {t("club.anchor.title")}
      </h2>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.thread_id}>
            <Link
              to="/club/$clubSlug/t/$threadSlug"
              params={{ clubSlug: row.club_slug, threadSlug: row.thread_slug }}
              className="block rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/40"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-primary">
                  {pickLocalized(row, "club_name", lang)}
                </span>
                <Badge variant="outline" className="text-[11px]">
                  {t(`club.kind.${row.kind}`)}
                </Badge>
              </div>
              <p className="mt-1 font-medium leading-snug">{row.title}</p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5" />
                {t("club.repliesCount", { count: row.reply_count })}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
