// Atom: znacznik ŹRÓDŁA karty - dział klubu, z którego pochodzi wpis.
//
// PO CO OSOBNY ATOM. Dział pojawia się dziś na trzech powierzchniach naraz:
// w karcie wątku, w karcie wpisu ze ściany i w panelu źródeł w prawej szynie.
// Dopóki każda z nich rysowała go po swojemu (raz szary tekst, raz nazwa bez
// ikony), użytkownik nie miał jak zauważyć, że to ZA KAŻDYM RAZEM ten sam byt.
// Jeden atom = jeden kolor, jedna ikona i jeden kształt dla tego samego działu
// wszędzie tam, gdzie się pojawia.
//
// CHIP JEST KLIKALNY, GDY MA DOKĄD PROWADZIĆ. Znacznik pochodzenia, który nic
// nie robi, jest etykietą; ten sam znacznik z `onSelect` zawęża strumień do
// swojego działu, czyli zamienia informację "skąd to jest" w narzędzie "pokaż
// mi tylko to". Chip bez identyfikatora działu (wpis poza działami) zostaje
// etykietą - nie ma czego zawęzić.
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  CLUB_GROUP_TEXT,
  CLUB_GROUP_TINT,
  ClubGroupIcon,
  clubGroupAccentVars,
} from "@/components/clubs/atoms/ClubGroupAccent";
import { HUB_LABEL } from "@/components/clubs/atoms/ClubHubPrimitives";
import type { ClubSourceMark } from "@/lib/clubs/threadSources";

// Kształt i stopień pisma etykiety huba (`HUB_LABEL`): ten sam co rodzaj,
// obszar i kotwica obok, a długa nazwa działu zawija się zamiast ucinać.
const SHAPE = HUB_LABEL;

export function ClubSourceChip({
  source,
  onSelect,
  active = false,
  className,
}: {
  source: ClubSourceMark;
  /** Gdy podane - chip zawęża strumień do tego działu (ponowne kliknięcie zdejmuje). */
  onSelect?: (groupId: string | null) => void;
  active?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const id = source.id;
  const body = (
    <>
      <ClubGroupIcon icon={source.icon} className="h-3 w-3 shrink-0" />
      <span className="min-w-0">{source.name}</span>
    </>
  );
  const shape = cn(SHAPE, CLUB_GROUP_TINT, CLUB_GROUP_TEXT, className);

  if (onSelect === undefined || id === null) {
    return (
      <span style={clubGroupAccentVars(source.accent)} className={shape}>
        {body}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      title={t("club.hub.sources.filterHint")}
      onClick={() => onSelect(active ? null : id)}
      style={clubGroupAccentVars(source.accent)}
      className={cn(
        shape,
        "transition-colors hover:bg-[color-mix(in_oklab,var(--club-accent)_18%,transparent)]",
        active && "ring-1 ring-[color-mix(in_oklab,var(--club-accent)_45%,transparent)]",
      )}
    >
      {body}
    </button>
  );
}
