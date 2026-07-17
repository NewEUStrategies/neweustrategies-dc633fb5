// Deterministic accent + icon derivation per related post.
// Używamy istniejących tokenów kategorii z src/styles.css (cat-*, brand-ink),
// żeby wizualizacja rekomendacji trzymała się globalnej palety projektu.
import {
  BookOpen,
  Compass,
  Flame,
  Layers,
  Lightbulb,
  Map as MapIcon,
  Radar,
  Sparkle,
  Target,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface RelatedAccent {
  /** CSS variable name (bez `var(...)`), np. `--cat-military`. */
  token: string;
  /** Tailwind class dla tła (mapowana w safelist poniżej). */
  bgClass: string;
  /** Tailwind class dla obramowania. */
  borderClass: string;
  /** Tailwind class dla tekstu. */
  textClass: string;
  Icon: LucideIcon;
}

// Kolejność zsynchronizowana z presetami w :root — 6 slotów.
const PALETTE: ReadonlyArray<Omit<RelatedAccent, "Icon">> = [
  {
    token: "--cat-military",
    bgClass: "bg-cat-military/10",
    borderClass: "border-cat-military/40",
    textClass: "text-cat-military",
  },
  {
    token: "--cat-finance",
    bgClass: "bg-cat-finance/10",
    borderClass: "border-cat-finance/40",
    textClass: "text-cat-finance",
  },
  {
    token: "--cat-transport",
    bgClass: "bg-cat-transport/10",
    borderClass: "border-cat-transport/40",
    textClass: "text-cat-transport",
  },
  {
    token: "--cat-diplomacy",
    bgClass: "bg-cat-diplomacy/10",
    borderClass: "border-cat-diplomacy/40",
    textClass: "text-cat-diplomacy",
  },
  {
    token: "--cat-cyber",
    bgClass: "bg-cat-cyber/10",
    borderClass: "border-cat-cyber/40",
    textClass: "text-cat-cyber",
  },
  {
    token: "--brand-ink",
    bgClass: "bg-brand-ink/10",
    borderClass: "border-brand-ink/40",
    textClass: "text-brand-ink",
  },
];

const ICONS: ReadonlyArray<LucideIcon> = [
  Compass,
  TrendingUp,
  Radar,
  MapIcon,
  Target,
  Flame,
  Lightbulb,
  Layers,
  BookOpen,
  Sparkle,
];

/** Stabilny hash łańcucha znaków (djb2). */
function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function accentFor(postId: string): RelatedAccent {
  const h = hash(postId);
  const preset = PALETTE[h % PALETTE.length];
  const Icon = ICONS[h % ICONS.length];
  return { ...preset, Icon };
}
