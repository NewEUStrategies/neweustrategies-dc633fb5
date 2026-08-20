// Sondaż wątku `kind='poll'`.
//
// DLACZEGO NIE WŁASNE GŁOSOWANIE. Specyfikacja (V1 §1.3) mówi wprost, że ten
// rodzaj wątku "reużywa istniejące polls / poll_votes" - i tak to jest zrobione:
// `club_threads.poll_id` (migracja A20) wskazuje na tę samą tabelę, którą
// obsługuje strona /polls i blok "poll" w treści wpisu, a renderuje ten sam
// `PollCard`. Zyski są trzy i wszystkie są jakościowe, nie oszczędnościowe:
//
//   * ANTI-ANCHORING działa od pierwszego dnia. `vote_poll` nie pokazuje
//     rozkładu głosów, dopóki nie zagłosujesz - w klubie deliberacyjnym to jest
//     ważniejsze niż gdziekolwiek indziej, bo tu głosuje się po przeczytaniu
//     argumentów, a nie po zobaczeniu, gdzie stoi większość.
//   * Wyniki są w jednym miejscu w bazie, więc redakcja widzi sondaż klubowy
//     obok pozostałych zamiast w osobnym silniku.
//   * Zero drugiej implementacji, która rozjechałaby się z pierwszą.
//
// Do A20 rodzaj `poll` był samą etykietą: chip nad tytułem i nic pod spodem.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PollCard } from "@/components/community/PollCard";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { pollResultsQueryOptions, publicPollsQueryOptions } from "@/lib/community/publicQueries";
import { ensureClubI18n } from "@/lib/i18n-club";

export function ClubThreadPoll({
  pollId,
  lang,
  userId,
}: {
  pollId: string;
  lang: "pl" | "en";
  userId: string | null;
}) {
  ensureClubI18n();
  const { t } = useTranslation();

  // Lista ankiet i wyniki mają już współdzielone `queryOptions`, więc sondaż
  // klubowy trafia w ten sam wpis cache, co strona /polls - otwarcie obu nie
  // kosztuje dwóch zapytań i nie może pokazać dwóch różnych stanów.
  const pollsQ = useQuery(publicPollsQueryOptions());
  const resultsQ = useQuery(pollResultsQueryOptions([pollId], userId));

  // JEDNO miejsce, w którym brak odpowiedzi zamienia się w pustą listę - nad
  // bramkami stanu, a nie pod nimi. Wcześniej `?? []` stało w wyrażeniu
  // szukającym ankiety, czyli w gałęzi osiągalnej wyłącznie po odpowiedzi:
  // fallback nie miał jak się wykonać i nie miał jak zostać sprawdzony.
  const polls = pollsQ.data ?? [];

  if (pollsQ.isError || resultsQ.isError) return <ClubErrorNotice compact />;
  if (pollsQ.isPending) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />;
  }

  const poll = polls.find((row) => row.id === pollId);
  // Ankieta zamknięta i usunięta z listy publicznej nie jest błędem - wątek
  // zostaje, głosowanie się skończyło. Mówimy to wprost zamiast rysować pustkę.
  if (!poll) {
    return (
      <p className="rounded-lg border border-dashed border-border/60 p-4 text-center text-sm text-muted-foreground">
        {t("club.poll.unavailable")}
      </p>
    );
  }

  return <PollCard poll={poll} results={resultsQ.data?.get(pollId)} lang={lang} userId={userId} />;
}
