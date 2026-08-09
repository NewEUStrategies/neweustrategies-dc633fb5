// Atom: kolor i ikona działu klubu.
//
// Dział ma w bazie własny `accent_color` i `icon`, ale do tej pory interfejs
// nie używał ani jednego, ani drugiego - lista działów była kolumną
// identycznych linijek tekstu. Ten atom jest JEDYNYM miejscem, które zamienia
// te dwie kolumny na wygląd, więc szyna, panel działu i chipy w strumieniu
// mówią o tym samym dziale tym samym kolorem.
//
// KOLOR JEST DELIKATNY Z ZAŁOŻENIA. Akcent wchodzi wyłącznie przez
// `color-mix` (8-16 % tła, 40 % krawędzi), nigdy jako pełne wypełnienie:
// sześć działów w pełnych kolorach zamienia szynę w paletę farb i psuje
// kontrast w obu motywach. Bez akcentu w bazie dział dziedziczy `--primary`.
import type { CSSProperties } from "react";
import { Folder, FolderTree, Layers } from "lucide-react";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { cn } from "@/lib/utils";

/** Zmienna CSS z akcentem działu. `--club-accent` czyta reszta klas poniżej. */
export function clubGroupAccentVars(accent: string | null): CSSProperties {
  const value = accent === null ? "" : accent.trim();
  return { ["--club-accent" as string]: value === "" ? "var(--primary)" : value } as CSSProperties;
}

export const CLUB_GROUP_TINT =
  "border-[color-mix(in_oklab,var(--club-accent)_40%,transparent)] bg-[color-mix(in_oklab,var(--club-accent)_8%,transparent)]";

export const CLUB_GROUP_DOT = "bg-[color-mix(in_oklab,var(--club-accent)_75%,transparent)]";

export const CLUB_GROUP_TEXT = "text-[color-mix(in_oklab,var(--club-accent)_80%,var(--foreground))]";

export function ClubGroupIcon({
  icon,
  depth = 0,
  className,
}: {
  icon: string | null;
  depth?: number;
  className?: string;
}) {
  const cls = cn("h-4 w-4 shrink-0", className);
  const name = icon === null ? "" : icon.trim();
  if (name !== "") return <DynamicIcon name={name} className={cls} aria-hidden="true" />;
  const Fallback = depth === 0 ? Layers : depth === 1 ? FolderTree : Folder;
  return <Fallback className={cls} aria-hidden="true" />;
}
