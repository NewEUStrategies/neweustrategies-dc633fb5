// Atom: renders the chosen meta-info separator glyph (or nothing).
import type { ThemeDesign } from "@/lib/theme/themeDesign";

type SeparatorKind = ThemeDesign["metaInfo"]["separator"];

const GLYPH: Record<Exclude<SeparatorKind, "none">, string> = {
  dot: "•",
  slash: "/",
  pipe: "|",
};

export function MetaSeparator({ kind }: { kind: SeparatorKind }) {
  if (kind === "none") return null;
  return (
    <span aria-hidden className="cms-meta-sep opacity-60">
      {GLYPH[kind]}
    </span>
  );
}
