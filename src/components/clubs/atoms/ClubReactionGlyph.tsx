// Atom: glif reakcji - kolorowy krążek z piktogramem.
//
// PO CO KOLOR. W pasku liczników pod kartą stoją obok siebie dwie, trzy
// najczęstsze reakcje. Szary piktogram na szarym tle trzeba PRZECZYTAĆ, żeby
// wiedzieć, czy pod tekstem przeważa „wnosi wiedzę", czy „nie zgadzam się";
// kolor mówi to obwodowo. Krążek jest tu ikoną (jak emoji), a nie etykietą,
// dlatego wyjątkowo jest okrągły - etykiety huba zostają przy promieniu 6 px.
//
// JEDNO ŹRÓDŁO KSZTAŁTÓW. Mapa rodzaj -> piktogram żyje TUTAJ i z niej czyta
// też `ClubReactionBar`, więc paleta pod postem otwierającym, wybór reakcji
// w strumieniu i licznik pod kartą zawsze mówią tym samym znakiem.
import {
  BookOpenCheck,
  Heart,
  HelpCircle,
  Lightbulb,
  ThumbsDown,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { ClubReactionKind } from "@/lib/clubs/types";

export const CLUB_REACTION_ICONS: Record<ClubReactionKind, LucideIcon> = {
  insightful: Lightbulb,
  evidence: BookOpenCheck,
  question: HelpCircle,
  thanks: Heart,
  agree: ThumbsUp,
  disagree: ThumbsDown,
};

// Tło krążka: pełne nasycenie, biały znak - kontrast działa w obu motywach,
// więc wariant ciemny nie potrzebuje osobnych odcieni.
const FILL: Record<ClubReactionKind, string> = {
  insightful: "bg-amber-500",
  evidence: "bg-teal-600",
  question: "bg-sky-600",
  thanks: "bg-rose-500",
  agree: "bg-blue-600",
  disagree: "bg-slate-500",
};

// Kolor TEKSTU akcji, gdy reakcja jest postawiona - akcja przejmuje barwę
// wybranej reakcji, tak jak przejmuje jej piktogram.
const INK: Record<ClubReactionKind, string> = {
  insightful: "text-amber-600 dark:text-amber-400",
  evidence: "text-teal-700 dark:text-teal-300",
  question: "text-sky-700 dark:text-sky-300",
  thanks: "text-rose-600 dark:text-rose-400",
  agree: "text-blue-700 dark:text-blue-300",
  disagree: "text-slate-600 dark:text-slate-300",
};

const SIZES = {
  xs: { box: "h-4 w-4", icon: "h-2.5 w-2.5" },
  sm: { box: "h-[18px] w-[18px]", icon: "h-[11px] w-[11px]" },
  lg: { box: "h-9 w-9", icon: "h-[18px] w-[18px]" },
} as const;

/** Klasa koloru tekstu dla postawionej reakcji. */
export function clubReactionInkClass(kind: ClubReactionKind): string {
  return INK[kind];
}

export function ClubReactionGlyph({
  kind,
  size = "sm",
  className,
  style,
}: {
  kind: ClubReactionKind;
  size?: keyof typeof SIZES;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon = CLUB_REACTION_ICONS[kind];
  const dims = SIZES[size];
  return (
    <span
      aria-hidden="true"
      data-reaction-glyph={kind}
      style={style}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full text-white",
        FILL[kind],
        dims.box,
        className,
      )}
    >
      <Icon className={dims.icon} strokeWidth={2.4} aria-hidden="true" />
    </span>
  );
}
