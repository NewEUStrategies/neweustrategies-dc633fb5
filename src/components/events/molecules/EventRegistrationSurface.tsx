// Molekula: blok zapisow na publicznej stronie wydarzenia.
//
// DOSTAJE GOTOWE NAPISY, NIE KLUCZE. Decyzje podejmuje regula czysta
// (`lib/events/registrationSurface.ts`), napisy sklada trasa, a ten plik
// wyłącznie rysuje. Dlatego nie ma tu ani `useTranslation`, ani jednego
// warunku na kolumnie wydarzenia - i dlatego test tej molekuly nie potrzebuje
// ani klienta Supabase, ani slownika.
//
// DLACZEGO `src/components/events/`, A NIE `community/`. Front wydarzenia ma
// juz w tym katalogu swoje organy (`EventSpeakersSection`, `SpeakerChip`),
// a `components/community/` trzyma powierzchnie wspolne calego modulu
// (wejsciowki, kalendarz, ankiety), ktore z rodzajem wydarzenia nie maja nic
// wspolnego. Podkatalog `molecules/` powstaje tutaj po raz pierwszy i jest
// zgodny z konwencja atomowa uzywana w `careers/`, `clubs/`, `network/`.
//
// JEDNA KONTROLKA ALBO ZADNA. Wariant reguly niesie co najwyzej jedna
// kontrolke, wiec ten komponent nie ma jak wyrenderowac przycisku zapisu obok
// zdania o zamknietych zapisach. To jest cala pointa unii wariantow.
import { Check, ExternalLink, ListPlus, XCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import type { RegistrationControl } from "@/lib/events/registrationSurface";

/** Ikona przycisku - wybor nalezy do wariantu, nie do tego pliku. */
export type EventRegistrationActionIcon = "check" | "listPlus" | "xCircle";

/**
 * Kontrolka do wyrenderowania. Trzy rozlaczne ksztalty, bo trzy rozne cele:
 * nasze RPC (przycisk), obce narzedzie organizatora (adres zewnetrzny)
 * i wlasna trasa cennika (nawigacja wewnetrzna).
 */
export type EventRegistrationAction =
  | {
      readonly kind: "button";
      readonly label: string;
      readonly enabled: boolean;
      readonly icon: EventRegistrationActionIcon;
    }
  | { readonly kind: "externalLink"; readonly label: string; readonly href: string }
  | { readonly kind: "internalLink"; readonly label: string };

const ICONS: Record<EventRegistrationActionIcon, typeof Check> = {
  check: Check,
  listPlus: ListPlus,
  xCircle: XCircle,
};

/**
 * Kontrolka wariantu -> ksztalt do wyrenderowania. `switch` bez `default`
 * domyka kompletnosc po stronie kompilatora, a `label` przychodzi JUZ ZLOZONY -
 * ten modul nie zna ani klucza i18n, ani jezyka.
 *
 * Mapowanie zyje tutaj, a nie w ciele trasy, z jednego powodu: test komponentu
 * ma przejsc dokladnie ta sama sciezka, ktora przechodzi trasa. Mapowanie
 * przepisane w tescie sprawdzalo by kopie, nie kod.
 */
export function eventRegistrationActionFrom(
  control: RegistrationControl | null,
  label: string,
  pending: boolean,
): EventRegistrationAction | null {
  if (control === null) return null;
  switch (control.action) {
    case "external":
      return { kind: "externalLink", label, href: control.url };
    case "membership":
      return { kind: "internalLink", label };
    case "rsvp":
      return { kind: "button", label, enabled: control.enabled && !pending, icon: "check" };
    case "waitlist":
      return { kind: "button", label, enabled: control.enabled && !pending, icon: "listPlus" };
    case "cancel":
      return { kind: "button", label, enabled: control.enabled && !pending, icon: "xCircle" };
  }
}

export function EventRegistrationSurface({
  message,
  note,
  action,
  onAction,
  groupLabel,
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
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-3"
      role="group"
      aria-label={groupLabel}
      aria-live="polite"
    >
      {action !== null && <ActionControl action={action} onAction={onAction} />}
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
}: {
  action: EventRegistrationAction;
  onAction?: () => void;
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
