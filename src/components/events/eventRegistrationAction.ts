// Ksztalt kontrolki bloku zapisow - MAPOWANIE, nie uklad.
//
// Plik siedzi OBOK molekuly, a nie w niej, z dwoch powodow. Pierwszy jest
// mechaniczny: modul eksportujacy obok komponentu zwykla funkcje wywraca
// odswiezanie na goraco (`react-refresh/only-export-components`) - to samo
// rozwiazanie co `speakerAvatarSizes.ts` obok komponentow prelegentow.
// Drugi jest merytoryczny: mapowanie jest CZYSTE i ma wlasny test, a testowanie
// go przez montowanie komponentu byloby drozsze i mniej dokladne.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero klienta Supabase. Napis
// przychodzi tu JUZ ZLOZONY - ten modul nie zna ani klucza i18n, ani jezyka.
import type { RegistrationControl } from "@/lib/events/registrationSurface";

/** Ikona przycisku - wybor nalezy do wariantu, nie do molekuly. */
export type EventRegistrationActionIcon = "check" | "listPlus" | "xCircle";

/**
 * Kontrolka do wyrenderowania. Trzy rozlaczne ksztalty, bo trzy rozne cele:
 * nasze RPC (przycisk), obce narzedzie organizatora (adres zewnetrzny)
 * i wlasna trasa cennika (nawigacja wewnetrzna). Rozlaczne, zeby nie dalo sie
 * wyrenderowac przycisku wolajacego RPC z adresem obcej strony.
 */
export type EventRegistrationAction =
  | {
      readonly kind: "button";
      readonly label: string;
      readonly enabled: boolean;
      readonly icon: EventRegistrationActionIcon;
    }
  | { readonly kind: "externalLink"; readonly label: string; readonly href: string }
  // Nawigacja wewnetrzna ma CEL w typie, a nie w komponencie: molekula rysowala
  // wczesniej jeden zapisany na sztywno adres cennika, wiec druga kontrolka
  // wewnetrzna (formularz zgloszenia) trafialaby pod ten sam link.
  | {
      readonly kind: "internalLink";
      readonly label: string;
      readonly target: "membership" | "registrationForm";
    };

/**
 * Kontrolka wariantu -> ksztalt do wyrenderowania. `switch` bez `default`
 * domyka kompletnosc po stronie kompilatora: nowa wartosc `action` w regule
 * oblewa build, a nie ekran uczestnika.
 *
 * Mapowanie zyje tutaj, a nie w ciele trasy, zeby test komponentu przechodzil
 * DOKLADNIE ta sciezka, ktora przechodzi trasa - mapowanie przepisane w tescie
 * sprawdza kopie, nie kod.
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
      return { kind: "internalLink", label, target: "membership" };
    case "registrationForm":
      return { kind: "internalLink", label, target: "registrationForm" };
    case "rsvp":
      return { kind: "button", label, enabled: control.enabled && !pending, icon: "check" };
    case "waitlist":
      return { kind: "button", label, enabled: control.enabled && !pending, icon: "listPlus" };
    case "cancel":
      return { kind: "button", label, enabled: control.enabled && !pending, icon: "xCircle" };
  }
}
