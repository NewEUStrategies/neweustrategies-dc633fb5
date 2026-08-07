// Pasek reakcji semantycznych.
//
// Sześć przycisków w dwóch grupach oddzielonych wizualnie, bo znaczą co innego:
// jakość ocenia WYPOWIEDŹ, stanowisko deklaruje ZDANIE autora reakcji. Bez tego
// rozdzielenia "zgadzam się" czyta się jak jeszcze jeden lajk, a wtedy mapa
// stanowisk przestaje cokolwiek znaczyć.
//
// Reakcje z zerowym licznikiem, których użytkownik nie postawił, pokazują się
// tylko w trybie pełnym (post otwierający). Przy odpowiedziach pasek jest
// zwinięty do reakcji już postawionych plus jednego przycisku "dodaj" - sześć
// pustych przycisków pod każdą z trzydziestu odpowiedzi to ściana szumu.
import { useTranslation } from "react-i18next";
import {
  BookOpenCheck,
  Heart,
  HelpCircle,
  Lightbulb,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CLUB_QUALITY_REACTIONS,
  CLUB_STANCE_REACTIONS,
  type ClubReactionKind,
  type ClubReactionTally,
} from "@/lib/clubs/types";

type IconType = typeof Lightbulb;

const ICONS: Record<ClubReactionKind, IconType> = {
  insightful: Lightbulb,
  evidence: BookOpenCheck,
  question: HelpCircle,
  thanks: Heart,
  agree: ThumbsUp,
  disagree: ThumbsDown,
};

interface ClubReactionBarProps {
  tallies: readonly ClubReactionTally[];
  disabled?: boolean;
  /** `full` pokazuje wszystkie sześć; `compact` tylko postawione. */
  variant?: "full" | "compact";
  onToggle: (kind: ClubReactionKind, active: boolean) => void;
}

export function ClubReactionBar({
  tallies,
  disabled,
  variant = "full",
  onToggle,
}: ClubReactionBarProps) {
  const { t } = useTranslation();

  const find = (kind: ClubReactionKind) => tallies.find((r) => r.kind === kind);

  const renderGroup = (kinds: readonly ClubReactionKind[]) => {
    const visible =
      variant === "full"
        ? kinds
        : kinds.filter((k) => {
            const tally = find(k);
            return tally !== undefined && tally.total > 0;
          });
    if (visible.length === 0) return null;

    return (
      <div className="flex flex-wrap items-center gap-1">
        {visible.map((kind) => {
          const tally = find(kind);
          const active = tally?.mine === true;
          const total = tally?.total ?? 0;
          const Icon = ICONS[kind];
          return (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              // aria-pressed, bo to przycisk przełączany - czytnik ekranu musi
              // powiedzieć, czy reakcja jest już postawiona.
              aria-pressed={active}
              title={t(`club.reaction.${kind}`)}
              className={cn(
                "h-7 gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
                active
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onToggle(kind, active)}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t(`club.reaction.${kind}`)}</span>
              {total > 0 ? <span className="tabular-nums">{total}</span> : null}
            </Button>
          );
        })}
      </div>
    );
  };

  const quality = renderGroup(CLUB_QUALITY_REACTIONS);
  const stance = renderGroup(CLUB_STANCE_REACTIONS);
  if (quality === null && stance === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {quality}
      {/* Separator niesie znaczenie: po lewej ocena wypowiedzi, po prawej
          deklaracja własnego zdania. */}
      {quality !== null && stance !== null ? (
        <span aria-hidden="true" className="h-4 w-px bg-border" />
      ) : null}
      {stance}
    </div>
  );
}
