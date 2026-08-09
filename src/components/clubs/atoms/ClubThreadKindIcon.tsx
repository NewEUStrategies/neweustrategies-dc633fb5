// Atom: ikona RODZAJU wątku klubu.
//
// Rodzaj (dyskusja, pytanie, stanowisko, materiał, ogłoszenie, sondaż) był do
// tej pory rozpoznawalny wyłącznie po kolorze grzbietu i etykiecie tekstowej -
// wszystkie wiersze dostawały tę samą „dymkową" ikonę. Ten atom jest JEDYNYM
// miejscem, które mapuje rodzaj na kształt, więc strumień, listy tematów i
// nagłówek wątku zawsze mówią o tym samym rodzaju tą samą ikoną.
//
// Ikona własna wątku (kolumna `icon`, wybierana przez prowadzenie) ma
// pierwszeństwo - dopiero jej brak degraduje się do kształtu rodzaju.
import {
  Gavel,
  HelpCircle,
  Library,
  Megaphone,
  MessagesSquare,
  ScrollText,
  Vote,
  type LucideIcon,
} from "lucide-react";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";

const KIND_ICONS: Record<string, LucideIcon> = {
  discussion: MessagesSquare,
  question: HelpCircle,
  position: Gavel,
  resource: Library,
  announcement: Megaphone,
  poll: Vote,
  post: ScrollText,
};

/** Komponent ikony dla rodzaju; nieznany rodzaj wraca do dymka dyskusji. */
export function clubThreadKindIcon(kind: string | null | undefined): LucideIcon {
  if (typeof kind !== "string") return MessagesSquare;
  return KIND_ICONS[kind] ?? MessagesSquare;
}

export function ClubThreadKindIcon({
  kind,
  icon = null,
  className = "h-3.5 w-3.5",
}: {
  kind: string | null | undefined;
  /** Ikona własna wątku (nazwa lucide) - ma pierwszeństwo nad rodzajem. */
  icon?: string | null;
  className?: string;
}) {
  const custom = typeof icon === "string" ? icon.trim() : "";
  if (custom !== "") return <DynamicIcon name={custom} size={14} aria-hidden="true" />;
  const Icon = clubThreadKindIcon(kind);
  return <Icon className={className} aria-hidden="true" />;
}
