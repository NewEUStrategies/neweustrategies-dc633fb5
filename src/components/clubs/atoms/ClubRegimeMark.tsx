// Atom: znacznik reżimu działu.
//
// REŻIM TO CZWARTA OŚ KLUBU i do tej pory jedyna, której nie było widać nigdzie
// poza ustawieniami. Dział „Kuluary" chodzi pod regułą Chatham House i jest
// prywatny wewnątrz klubu, który pisze pod nazwiskiem - to jest najważniejsza
// informacja przed napisaniem czegokolwiek, a stała trzy ekrany dalej,
// w panelu administracyjnym.
//
// POKAZUJEMY WYŁĄCZNIE ODSTĘPSTWO. Dział dziedziczący ustawienia klubu nie
// dostaje żadnego znacznika: gdyby dostał, znacznik pojawiłby się przy każdym
// dziale i przestałby cokolwiek znaczyć. Kolumny `*_inherited` z
// `club_groups_list` niosą tę różnicę wprost - nie trzeba jej zgadywać
// z porównania wartości.
import { useTranslation } from "react-i18next";
import { EyeOff, VenetianMask } from "lucide-react";
import { cn } from "@/lib/utils";
import { toGroupSettings, type ClubGroupRow } from "@/lib/clubs/types";

/** Czy dział nadpisuje regułę atrybucji klubu na Chatham House. */
export function isChathamGroup(group: ClubGroupRow): boolean {
  const { attributionMode } = toGroupSettings(group);
  return !attributionMode.inherited && attributionMode.value === "chatham";
}

/** Czy dział zawęża widoczność wobec klubu (prywatny lub ukryty dział). */
export function isRestrictedGroup(group: ClubGroupRow): boolean {
  const { visibility } = toGroupSettings(group);
  return !visibility.inherited && (visibility.value === "private" || visibility.value === "secret");
}

export function hasOwnRegime(group: ClubGroupRow): boolean {
  return isChathamGroup(group) || isRestrictedGroup(group);
}

export function ClubRegimeMark({ group, className }: { group: ClubGroupRow; className?: string }) {
  const { t } = useTranslation();
  const chatham = isChathamGroup(group);
  const restricted = isRestrictedGroup(group);
  if (!chatham && !restricted) return null;

  // Chatham wygrywa nad zawężeniem widoczności, gdy dział ma oba: to reguła
  // WYPOWIEDZI, więc zmienia sposób pisania, a nie tylko krąg czytających.
  const Icon = chatham ? VenetianMask : EyeOff;
  const label = chatham
    ? t("club.attribution.chatham")
    : t(`club.visibility.${toGroupSettings(group).visibility.value}`);

  // Ikona zostaje `aria-hidden`, a nazwę niesie opakowanie: `title` daje
  // natywną podpowiedź pod kursorem, a `aria-label` na elemencie z rolą `img`
  // czyta się w czytniku ekranu jako jedna rzecz, nie jako grafika bez nazwy.
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-flex shrink-0 text-muted-foreground", className)}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  );
}
