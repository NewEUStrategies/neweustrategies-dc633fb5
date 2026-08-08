// Atom: chip obszaru tematycznego.
//
// Jedno miejsce, w którym zapada decyzja "jak wygląda obszar tematyczny".
// Wcześniej hub rysował pigułkę z obramowaniem, karta klubu - szary tekst
// wersalikami, a minisite jeszcze co innego; ten sam obszar wyglądał na trzy
// sposoby i nie dawał się rozpoznać jako ten sam byt. Chip jest teraz
// wspólny dla huba, strony klubu i wątku - łącznie ze skalą na mobile.
import type { ReactNode } from "react";
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

/** Statyczny chip - karta klubu, nagłówek klubu, nagłówek wątku. */
export function ClubTopicChip({
  topic,
  lang,
  catalog,
  size = "md",
  tone = "quiet",
  showIcon = true,
  className,
}: {
  topic: string | null | undefined;
  lang: ClubLang;
  catalog?: readonly ClubTopicOption[];
  size?: ClubTopicChipSize;
  tone?: ClubTopicChipTone;
  showIcon?: boolean;
  className?: string;
}) {
  if (topic === null || topic === undefined || topic.trim() === "") return null;
  const label = topicLabel(topic, lang, catalog ?? []);
  if (label === "") return null;

  return (
    <span className={cn(clubTopicChipClass(size, tone), className)} data-club-topic={topic}>
      {showIcon ? <Tag className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{label}</span>
    </span>
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
