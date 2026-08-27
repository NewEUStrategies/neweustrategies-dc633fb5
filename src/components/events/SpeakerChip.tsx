// Chip prelegenta (awatar + imie + rola) - wspolny dla agendy (event-schedule),
// sekcji prelegentow na stronie wydarzenia i kart wydarzen. Semantyka:
// przycisk (otwiera dialog profilu), link (href) albo statyczny wpis.
import type { MouseEventHandler, ReactNode } from "react";
import { AppLink } from "@/components/atoms/AppLink";
import { SpeakerAvatar, type SpeakerAvatarSize } from "./SpeakerAvatar";

interface SpeakerChipProps {
  name: string;
  role?: string;
  /**
   * Organizacja prelegenta (`company` z publicznej projekcji profilu).
   *
   * FAKT, NIE OZDOBA. Afiliacja przez chwile istniala tylko na jednej z dwoch
   * publicznych list tego samego wydarzenia - siatka na zakladce ja pokazywala,
   * zapowiedz na przegladzie nie - wiec ta sama osoba miala tam afiliacje,
   * a tu byla anonimowa. Pusty napis NIE rysuje linii: brak organizacji ma
   * czytac sie jak brak danych, a nie jak uszkodzony wiersz.
   */
  organization?: string;
  photoUrl?: string | null;
  size?: SpeakerAvatarSize;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** Dodatkowa tresc po prawej (np. odznaka eksperta). */
  trailing?: ReactNode;
}

function ChipBody({
  name,
  role,
  organization,
  photoUrl,
  size,
  trailing,
}: Pick<SpeakerChipProps, "name" | "role" | "organization" | "photoUrl" | "size" | "trailing">) {
  return (
    <>
      <SpeakerAvatar name={name} photoUrl={photoUrl} size={size ?? "md"} />
      <span className="min-w-0 text-left">
        <span className="block truncate text-sm font-semibold leading-tight text-foreground">
          {name}
        </span>
        {role ? (
          <span className="block truncate text-xs leading-tight text-muted-foreground">{role}</span>
        ) : null}
        {organization ? (
          // Pelna wartosc zostaje w `title` - ucieta nazwa organizacji bez
          // mozliwosci odczytu to strata informacji, dokladnie jak w karcie
          // siatki (`EventSpeakersGrid`).
          <span
            title={organization}
            className="block truncate text-xs leading-tight text-foreground/80"
          >
            {organization}
          </span>
        ) : null}
      </span>
      {trailing}
    </>
  );
}

const BASE_CLASS =
  "group/chip inline-flex max-w-full items-center gap-2.5 rounded-[6px] p-1 pr-2 text-left transition-colors";
const INTERACTIVE_CLASS =
  " hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--speakers-accent,var(--brand))]/50";

export function SpeakerChip({
  name,
  role,
  organization,
  photoUrl,
  size,
  href,
  onClick,
  trailing,
}: SpeakerChipProps) {
  const body = (
    <ChipBody
      name={name}
      role={role}
      organization={organization}
      photoUrl={photoUrl}
      size={size}
      trailing={trailing}
    />
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={BASE_CLASS + INTERACTIVE_CLASS}>
        {body}
      </button>
    );
  }
  if (href) {
    return (
      <AppLink href={href} className={BASE_CLASS + INTERACTIVE_CLASS}>
        {body}
      </AppLink>
    );
  }
  return <span className={BASE_CLASS}>{body}</span>;
}
