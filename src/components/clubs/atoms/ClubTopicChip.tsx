// Atom: chip obszaru tematycznego.
//
// Jedno miejsce, w którym zapada decyzja "jak wygląda obszar tematyczny".
// Wcześniej hub rysował pigułkę z obramowaniem, karta klubu - szary tekst
// wersalikami, a minisite jeszcze co innego; ten sam obszar wyglądał na trzy
// sposoby i nie dawał się rozpoznać jako ten sam byt. Chip jest teraz
// wspólny dla huba, strony klubu i wątku - łącznie ze skalą na mobile.
//
// CHIP JEST KLIKALNY, GDY MA DOKĄD PROWADZIĆ - ten sam wzorzec, co
// `ClubSourceChip` dla działu. Statyczny chip na stronie wątku (obszar JEST
// ustalony, nie ma czego przełączać) i klikalny chip na karcie strumienia
// (obszar zawęża listę) to jeden komponent, nie dwa wyglądy tego samego bytu.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { topicLabel, type ClubLang, type ClubTopicOption } from "@/lib/clubs/topicCatalog";

export type ClubTopicChipSize = "sm" | "md";

const BASE =
  "inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-lg border font-medium leading-none transition-colors";

const SIZES: Record<ClubTopicChipSize, string> = {
  // Mobile schodzi o stopień niżej, ale nigdy poniżej 11 px - poniżej tej
  // wartości etykieta przestaje być czytelna na telefonie.
  sm: "px-2 py-1 text-[11px]",
  md: "px-2.5 py-1 text-[11px] sm:text-xs",
};

const TONES = {
  quiet: "border-border/60 bg-muted/40 text-muted-foreground",
  active: "border-primary bg-primary text-primary-foreground",
  outline: "border-primary/40 bg-primary/5 text-foreground",
} as const;

export type ClubTopicChipTone = keyof typeof TONES;

export function clubTopicChipClass(
  size: ClubTopicChipSize = "md",
  tone: ClubTopicChipTone = "quiet",
): string {
  return cn(BASE, SIZES[size], TONES[tone]);
}

/**
 * Chip obszaru - statyczny bez `onSelect`, klikalny z nim.
 *
 * `active` wygrywa nad `tone`: obszar aktualnie wybrany jako filtr ma wyglądać
 * TAK SAMO niezależnie od tego, czy świeci się na pasku filtrów, czy na karcie
 * wątku, którego akurat czytamy - jeden stan, jeden wygląd, wszędzie.
 */
export function ClubTopicChip({
  topic,
  lang,
  catalog,
  size = "md",
  tone = "quiet",
  showIcon = true,
  onSelect,
  active = false,
  className,
}: {
  topic: string | null | undefined;
  lang: ClubLang;
  catalog?: readonly ClubTopicOption[];
  size?: ClubTopicChipSize;
  tone?: ClubTopicChipTone;
  showIcon?: boolean;
  /** Gdy podane - chip zawęża strumień do tego obszaru (ponowne kliknięcie zdejmuje). */
  onSelect?: (topic: string | null) => void;
  active?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  if (topic === null || topic === undefined || topic.trim() === "") return null;
  const label = topicLabel(topic, lang, catalog ?? []);
  if (label === "") return null;
  const shape = cn(clubTopicChipClass(size, active ? "active" : tone), className);

  const body = (
    <>
      {showIcon ? <Tag className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{label}</span>
    </>
  );

  if (onSelect === undefined) {
    return (
      <span className={shape} data-club-topic={topic}>
        {body}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      title={t("club.topic.filterHint")}
      onClick={() => onSelect(active ? null : topic)}
      data-club-topic={topic}
      className={cn(shape, "hover:border-primary/40")}
    >
      {body}
    </button>
  );
}

/** Klikalny chip - filtry na hubie i w klubie. Ten sam kształt co statyczny. */
export function ClubTopicFilterChip({
  active,
  onClick,
  children,
  size = "md",
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  size?: ClubTopicChipSize;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        clubTopicChipClass(size, active ? "active" : "quiet"),
        "hover:border-primary/40",
        className,
      )}
    >
      {children}
    </button>
  );
}
