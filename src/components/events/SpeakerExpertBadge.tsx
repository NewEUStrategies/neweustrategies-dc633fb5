// Plakietka EKSPERTA - jeden renderer faktu `is_expert` na wszystkich
// powierzchniach prelegentów.
//
// PO CO OSOBNY PLIK NA JEDNĄ IKONĘ. `is_expert` jest FAKTEM O OSOBIE, a nie
// ozdobą układu, i przez chwilę stał wpisany w tylko jedną z dwóch publicznych
// list tego samego wydarzenia: zapowiedź na przeglądzie (`EventSpeakersSection`)
// pokazywała tarczę, a siatka na zakładce `/events/<slug>/speakers`
// (`EventSpeakersGrid`) tej samej osoby ekspertem już nie nazywała. Dopóki
// plakietka była dwoma kawałkami JSX-a w dwóch plikach, nic nie trzymało ich
// razem. Teraz fakt ma JEDEN rysunek, więc rozjazd wymagałby usunięcia tego
// komponentu z powierzchni - a to widzi bramka
// `__tests__/eventSpeakerFactParity.gate.test.tsx`.
//
// UKŁADY WOLNO RÓŻNIĆ, FAKTÓW NIE. Zapowiedź jest poziomym chipem, siatka kartą
// po cztery w wierszu, a dialog profilu pigułką przy nazwisku - to decyzje
// właściciela i ten komponent ich nie odwraca. Marginesów ani pozycjonowania nie
// ma tu wcale: dostaje je od miejsca wywołania przez `className`, a o tym, czy
// napis jest WIDOCZNY, rozstrzyga `withLabel`. Dwa wyglądy, jeden fakt.
//
// IKONA NIE JEST NAPISEM. Sama tarcza nie mówi czytnikowi ekranu niczego
// (`aria-hidden`), więc w wariancie zwięzłym nazwa faktu jedzie tekstem
// w `sr-only` i w `title`: pierwszy dla czytnika, drugi dla kogoś, kto nie zna
// symbolu. Dzięki temu „ekspert” jest OBECNY w drzewie jako tekst w OBU
// wariantach - bramka parytetu mierzy fakty treścią, nie klasami CSS.
//
// JĘZYK WOLNO WYMUSIĆ. Większość wywołań bierze język z instancji i18n (tak
// robią obie listy), ale dialog profilu jest sterowany PROPSEM `lang` - dostaje
// go od powierzchni, która go otworzyła. Bez `lang` plakietka w dialogu mówiłaby
// językiem instancji, a nagłówek obok - językiem propsa.
import { useTranslation } from "react-i18next";

import { ShieldCheck } from "@/lib/lucide-shim";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

export function SpeakerExpertBadge({
  className,
  withLabel = false,
  lang,
}: {
  /** Odstępy i pozycjonowanie należą do miejsca wywołania, nie do plakietki. */
  className?: string;
  /** `true` = pigułka z WIDOCZNYM napisem; domyślnie sama ikona + `sr-only`. */
  withLabel?: boolean;
  /** Język wymuszony przez wywołującego (powierzchnie sterowane propsem). */
  lang?: "pl" | "en";
}) {
  const { t } = useTranslation();
  const label = t("eventFront.speakers.expertBadge", lang ? { lng: lang } : undefined);
  const extra = className ? ` ${className}` : "";

  // `text-brand-ink`, a nie `text-primary`: `--primary` to prawie-czerń /
  // prawie-biel, więc plakietka marki musi wziąć rolę TEKSTU marki. `--brand`
  // zostaje rolą TŁA - i tylko tak jest tu użyty.
  if (withLabel) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-[6px] bg-[color:var(--speakers-accent,var(--brand))]/10 px-2 py-0.5 text-[11px] font-semibold text-brand-ink${extra}`}
      >
        <ShieldCheck aria-hidden className="h-3 w-3 shrink-0" />
        {label}
      </span>
    );
  }
  return (
    <span title={label} className={`inline-flex shrink-0 items-center text-brand-ink${extra}`}>
      <ShieldCheck aria-hidden className="h-4 w-4 shrink-0" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
