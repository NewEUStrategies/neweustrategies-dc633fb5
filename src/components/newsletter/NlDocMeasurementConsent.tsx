// OSOBNE POLE ZGODY NA POMIAR W DOKUMENCIE BUILDERA NEWSLETTERA (NlDoc;
// I9d-Y2b, decyzja właściciela 2026-10-23, wariant (b): każda zgoda ma osobne
// pole; rozstrzygnięcia R1.17 i R1.21).
//
// Jedno źródło dla renderu publicznego (`NewsletterDocRenderer` - formularz
// inline i popup „document") i podglądu na płótnie buildera
// (`NewsletterBuilder`): pole nie jest widżetem dokumentu (schemat bez zmian),
// tylko stałym wierszem, który formularz dokłada sam.
//
// MIEJSCE (R1.17): osobny wiersz na PEŁNĄ szerokość, na końcu sekcji
// z pierwszym przyciskiem wysyłki - pod jej widżetami (także pod obiema
// kolumnami układu 1-1), w jej kolorach i odstępach. Nie wstawiamy pola
// przed sam przycisk: w układach, w których przycisk stoi w wierszu z polem
// e-mail, rozbiłoby to rząd. Dokument bez przycisku: koniec ostatniej sekcji
// (koniec formularza).
//
// GEOMETRIA: TEN SAM tor co sąsiednie pola wyboru dokumentu (`field.checkbox`
// w `NewsletterDocRenderer` i `WidgetPreview`) - natywny `<input
// type="checkbox">` w tej samej etykiecie i tych samych klasach, więc wiersz
// wygląda w widżecie jak pozostałe zgody (reguła AGENTS o wspólnej geometrii
// widżetów). Wymiana natywnych pól NlDoc na atom `Checkbox` platformy to
// osobna zmiana dla wszystkich pól naraz (projekt §11).
//
// LIMIT (R1.21): ładunek `consents` dokumentu = zaznaczone pola zgody +
// zgoda na newsletter + (po zaznaczeniu) deklaracja pomiaru; najwięcej
// `CONSENT_ENTRIES_MAX` - tyle przyjmuje serwer. Formularz nie wysyła
// ładunku ponad limit (komunikat zamiast obcinania - dowód zgody nie może
// zgubić pozycji).
//
// Klucze zastrzeżone (`RESERVED_CONSENT_KEYS`): widżet `field.checkbox`
// z takim kluczem nie jest renderowany ani zbierany - jedyną drogą
// deklaracji pomiaru jest to pole (`isReservedConsentKey`).
//
// Czyste reguły (miejsce, licznik, komunikat limitu) żyją obok, w
// `./nlDocMeasurement.ts` - ten plik eksportuje wyłącznie komponent.
import type { NlLang } from "@/lib/newsletter-builder/types";
import { MeasurementConsentText } from "@/components/newsletter/NewsletterConsentText";
import { EMAIL_MEASUREMENT_CONSENT_KEY } from "@/lib/newsletter/measurementConsentText";

export interface NlDocMeasurementConsentProps {
  lang: NlLang;
  checked: boolean;
  /** Brak = podgląd na płótnie buildera (pole tylko do odczytu). */
  onCheckedChange?: (checked: boolean) => void;
}

/** Wiersz pola pomiaru - tor i klasy jak `field.checkbox` dokumentu. */
export function NlDocMeasurementConsent({
  lang,
  checked,
  onCheckedChange,
}: NlDocMeasurementConsentProps) {
  return (
    <label
      data-consent={EMAIL_MEASUREMENT_CONSENT_KEY}
      className="flex items-start gap-2 text-xs opacity-95"
    >
      {onCheckedChange ? (
        <input
          type="checkbox"
          className="mt-0.5"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
      ) : (
        <input type="checkbox" className="mt-0.5" checked={checked} readOnly />
      )}
      <span className="[&_a]:underline">
        <MeasurementConsentText lang={lang} />
      </span>
    </label>
  );
}
