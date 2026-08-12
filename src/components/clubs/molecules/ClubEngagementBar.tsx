// Molekuła: pasek zaangażowania pod kartą strumienia.
//
// PO CO. Karta wątku na hubie była do tej pory CZYTELNIĄ: dawała tytuł, zajawkę
// i liczniki, ale żeby cokolwiek zrobić, trzeba było najpierw wejść w wątek,
// przewinąć do dołu i dopiero tam znaleźć reakcje oraz kompozytor. Reakcja jest
// gestem sekundowym - jeśli kosztuje nawigację, nie zdarza się wcale.
//
// REGUŁA PODZIAŁU. Reakcja zostaje NA MIEJSCU (jedno kliknięcie, bez opuszczania
// strumienia), a komentarz PRZENOSI DO WĄTKU. To nie jest kompromis techniczny,
// tylko decyzja produktowa: pogłębiona dyskusja ma jedno miejsce - wątek - i nie
// wolno jej rozsypywać po kartach huba. Dlatego "Komentuj" jest linkiem
// routera z `?reply=1`, a widok wątku po wejściu ustawia kursor w kompozytorze.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MessageSquarePlus, SmilePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClubReactionBar } from "@/components/clubs/molecules/ClubReactionBar";
import { ClubReactionAvatars } from "@/components/clubs/molecules/ClubReactionAvatars";
import {
  ClubHoverActionBody,
  clubHoverActionClass,
} from "@/components/clubs/atoms/ClubHoverAction";
import type { ClubReactionActor, ClubReactionKind, ClubReactionTally } from "@/lib/clubs/types";

export interface ClubEngagementBarProps {
  clubSlug: string;
  /** Slug wątku, do którego prowadzi komentowanie. */
  threadSlug: string;
  tallies: readonly ClubReactionTally[];
  /** Kto zareagował - twarze obok liczników, tooltip z imieniem i nazwiskiem. */
  actors?: readonly ClubReactionActor[];
  replyCount: number;
  /** Brak uprawnienia do odpowiedzi wyłącza reakcje, ale NIE link do wątku:
   *  czytanie dyskusji jest szersze niż prawo do zabrania w niej głosu. */
  canReact?: boolean;
  pending?: boolean;
  onToggle?: (kind: ClubReactionKind, active: boolean) => void;
  className?: string;
}

export function ClubEngagementBar({
  clubSlug,
  threadSlug,
  tallies,
  actors,
  replyCount,
  canReact = true,
  pending = false,
  onToggle,
  className,
}: ClubEngagementBarProps) {
  const { t } = useTranslation();
  // Rozwinięcie pełnej palety jest LOKALNE dla karty. Sześć przycisków pod
  // każdą z kilkunastu kart to ściana szumu, więc domyślnie widać wyłącznie
  // reakcje już postawione, a pełny wybór otwiera się na żądanie.
  const [picking, setPicking] = useState(false);
  const placed = tallies.some((r) => r.total > 0 || r.mine);
  const interactive = canReact && onToggle !== undefined;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border/60 pt-2",
        className,
      )}
      data-testid="club-engagement-bar"
    >
      {/* `compact`: pod kartą w strumieniu pokazujemy tylko reakcje już
          postawione. Sześć pustych przycisków pod każdą z kilkunastu kart to
          ściana szumu, przez którą nie widać treści. */}
      <ClubReactionBar
        tallies={tallies}
        variant={picking ? "full" : "compact"}
        disabled={!interactive || pending}
        onToggle={(kind, active) => {
          // Wybór reakcji jest gestem jednorazowym: po kliknięciu paleta
          // zwija się z powrotem do reakcji faktycznie postawionych, żeby
          // karta nie została na stałe rozpięta na sześć przycisków.
          setPicking(false);
          onToggle?.(kind, active);
        }}
      />

      {actors !== undefined && actors.length > 0 ? (
        <ClubReactionAvatars
          actors={actors}
          total={tallies.reduce((sum, r) => sum + r.total, 0)}
          maxVisible={4}
        />
      ) : null}

      {interactive && !picking ? (
        <button
          type="button"
          onClick={() => setPicking(true)}
          aria-label={placed ? t("club.hub.feed.addReactionShort") : t("club.hub.feed.addReaction")}
          className={clubHoverActionClass()}
          data-testid="club-add-reaction"
        >
          <ClubHoverActionBody
            icon={SmilePlus}
            label={placed ? t("club.hub.feed.addReactionShort") : t("club.hub.feed.addReaction")}
          />
        </button>
      ) : null}

      <Link
        to="/club/$clubSlug/t/$threadSlug"
        params={{ clubSlug, threadSlug }}
        search={{ reply: true }}
        aria-label={
          replyCount > 0
            ? t("club.hub.feed.commentWithCount", { n: replyCount })
            : t("club.hub.feed.comment")
        }
        className={clubHoverActionClass({ className: "ml-auto" })}
        data-testid="club-comment-link"
      >
        <ClubHoverActionBody
          icon={MessageSquarePlus}
          label={t("club.hub.feed.comment")}
          count={replyCount}
        />
      </Link>
    </div>
  );
}
