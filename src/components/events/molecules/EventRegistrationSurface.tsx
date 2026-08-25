// Molekula: blok zapisow na publicznej stronie wydarzenia.
//
// DOSTAJE GOTOWE NAPISY, NIE KLUCZE. Decyzje podejmuje regula czysta
// (`lib/events/registrationSurface.ts`), napisy sklada trasa, ksztalt kontrolki
// wylicza `eventRegistrationAction.ts`, a ten plik WYLACZNIE rysuje. Dlatego
// nie ma tu ani `useTranslation`, ani jednego warunku na kolumnie wydarzenia -
// i dlatego test tej molekuly nie potrzebuje ani klienta Supabase, ani slownika.
//
// DLACZEGO `src/components/events/`, A NIE `community/`. Front wydarzenia ma
// juz w tym katalogu swoje komponenty (`EventSpeakersSection`, `SpeakerChip`,
// `speakerAvatarSizes.ts`), a `components/community/` trzyma powierzchnie
// wspolne calego modulu (wejsciowki, kalendarz, ankiety), ktore z trybem
// zapisow nie maja nic wspolnego. Podkatalog `molecules/` powstaje tutaj po raz
// pierwszy i jest zgodny z konwencja atomowa z `careers/`, `clubs/`, `network/`.
//
// JEDNA KONTROLKA ALBO ZADNA. Wariant reguly niesie co najwyzej jedna
// kontrolke, wiec ten komponent nie ma jak wyrenderowac przycisku zapisu obok
// zdania o zamknietych zapisach. To jest cala pointa unii wariantow.
import { Check, ExternalLink, ListPlus, XCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import type {
  EventRegistrationAction,
  EventRegistrationActionIcon,
} from "@/components/events/eventRegistrationAction";

const ICONS: Record<EventRegistrationActionIcon, typeof Check> = {
  check: Check,
  listPlus: ListPlus,
  xCircle: XCircle,
};

export function EventRegistrationSurface({
  message,
  note,
  action,
  onAction,
  groupLabel,
  eventSlug,
}: {
  /** Zdanie o stanie zapisow - zawsze obecne, zawsze prawdziwe. */
  message: string;
  /** Zdanie dodatkowe (pozycja w kolejce) albo brak. */
  note: string | null;
  /** Kontrolka albo `null`, gdy wariant jest wylacznie zdaniem. */
  action: EventRegistrationAction | null;
  /** Wolane wylacznie przez kontrolke typu `button`. */
  onAction?: () => void;
  /** Dostepna nazwa grupy - blok jest regionem zywym (zmienia sie po akcji). */
  groupLabel: string;
  /** Slug wydarzenia - adres trasy formularza zgloszenia sklada sie z niego. */
  eventSlug: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-3"
      role="group"
      aria-label={groupLabel}
      aria-live="polite"
    >
      {action !== null && (
        <ActionControl action={action} onAction={onAction} eventSlug={eventSlug} />
      )}
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{message}</p>
        {note !== null && <p className="mt-1 text-sm text-primary">{note}</p>}
      </div>
    </div>
  );
}

function ActionControl({
  action,
  onAction,
  eventSlug,
}: {
  action: EventRegistrationAction;
  onAction?: () => void;
  eventSlug: string;
}) {
  if (action.kind === "externalLink") {
    // Adres organizatora, NIE nasze RPC. `noreferrer noopener` odcina obcej
    // stronie zarowno referrer, jak i uchwyt `window.opener` do naszej karty.
    return (
      <Button asChild variant="secondary">
        <a href={action.href} target="_blank" rel="noreferrer noopener">
          <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
          {action.label}
        </a>
      </Button>
    );
  }
  if (action.kind === "internalLink") {
    // Formularz zgloszenia stoi na WLASNEJ trasie (`/events/$slug/register`),
    // bo wola inne RPC niz szybki zapis i ma wlasny stan wypelniania - wciagniecie
    // go w stronę wydarzenia kazaloby uczestnikowi tracic dane przy kazdym
    // odswiezeniu naglowka.
    if (action.target === "registrationForm") {
      return (
        <Button asChild>
          <Link to="/events/$slug/register" params={{ slug: eventSlug }}>
            {action.label}
          </Link>
        </Button>
      );
    }
    return (
      <Button asChild size="sm">
        <Link to="/pricing">{action.label}</Link>
      </Button>
    );
  }
  const Icon = ICONS[action.icon];
  return (
    <Button
      variant={action.icon === "xCircle" ? "ghost" : "default"}
      onClick={onAction}
      disabled={!action.enabled}
    >
      <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
      {action.label}
    </Button>
  );
}
