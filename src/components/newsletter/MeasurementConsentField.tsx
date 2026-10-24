// OSOBNE POLE ZGODY NA POMIAR OTWARĆ I KLIKNIĘĆ (I9d-Y2b, decyzja właściciela
// 2026-10-23, wariant (b): każda zgoda ma osobne pole).
//
// Jeden komponent dla wszystkich formularzy ze zgodą na newsletter
// (NewsletterForm, NlDoc, „Dołącz do nas", kontakt, popup rejestracji, widżet
// rejestracji, bramka klubu): atom `Checkbox` platformy i treść
// `MeasurementConsentText` z jednego źródła (`@/lib/newsletter/measurementConsentText`).
//
// KONTRAKT Z HOSTEM:
//   * Stan trzyma host (`checked`, start `false` - pole DOMYŚLNIE
//     NIEZAZNACZONE) i po zaznaczeniu dokłada do `consents`
//     `measurementConsentPayload(lang)` (deklaracja, nie zgoda); po sukcesie
//     wraca do `false`.
//   * `disabled` - np. dopóki opcjonalny newsletter jest niezaznaczony (host
//     czyści wtedy także `checked`).
//   * GEOMETRIA I TYPOGRAFIA OD HOSTA: `className` = klasy wiersza sąsiedniego
//     pola zgody, `checkboxClassName` = rozmiar atomu jak w sąsiednim polu;
//     `style` i `editTarget` - gdy sąsiednie pole niesie rozmiar z widżetu
//     buildera w stylu wiersza i znacznik `data-edit-target` (np. „Dołącz do
//     nas": `consentSize`) - wiersz pomiaru dostaje TE SAME, bo globalna
//     reguła `label` widżetów nie pozwala odziedziczyć rozmiaru z rodzica.
//     Komponent nie ma własnych rozmiarów, odstępów, czcionek ani kolorów,
//     więc wiersz wygląda tak samo w jasnym i ciemnym motywie (reguła AGENTS
//     o wspólnej geometrii widżetów).
//
// Klik w link „szczegóły" nie przełącza pola: link to treść interaktywna
// wewnątrz etykiety (HTML: aktywacja etykiety nic nie robi dla takiego celu),
// a zatrzymanie propagacji chroni przed handlerami kliknięć wyżej (wzorzec
// `NewsletterForm.tsx`).
import type { CSSProperties, MouseEvent } from "react";

import { ConsentSegmentsText } from "@/components/newsletter/NewsletterConsentText";
import { Checkbox } from "@/components/ui/checkbox";
import type { ConsentLang } from "@/lib/newsletter/consentSegments";
import {
  EMAIL_MEASUREMENT_CONSENT_KEY,
  measurementConsentFieldAccessibleName,
  measurementConsentSummarySegments,
} from "@/lib/newsletter/measurementConsentText";
import { cn } from "@/lib/utils";

export interface MeasurementConsentFieldProps {
  lang: ConsentLang;
  /** Host trzyma stan; start `false`. */
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Np. dopóki opcjonalny newsletter jest niezaznaczony. */
  disabled?: boolean;
  /** `id` atomu (przycisk `role="checkbox"`). */
  id?: string;
  /** Klasy WIERSZA hosta (te same co sąsiednie pole zgody). */
  className?: string;
  /** Rozmiar atomu jak w sąsiednim polu zgody. */
  checkboxClassName?: string;
  /** Styl WIERSZA hosta (np. rozmiar tekstu z widżetu buildera). */
  style?: CSSProperties;
  /** `data-edit-target` wiersza (ten sam co sąsiedniego pola zgody). */
  editTarget?: string;
}

function keepLinkClickFromToggling(event: MouseEvent<HTMLSpanElement>) {
  if ((event.target as HTMLElement).closest("a")) event.stopPropagation();
}

export function MeasurementConsentField({
  lang,
  checked,
  onCheckedChange,
  disabled = false,
  id,
  className,
  checkboxClassName,
  style,
  editTarget,
}: MeasurementConsentFieldProps) {
  return (
    <label
      data-consent={EMAIL_MEASUREMENT_CONSENT_KEY}
      data-disabled={disabled ? "" : undefined}
      data-edit-target={editTarget}
      className={cn(className, disabled ? "cursor-not-allowed" : "cursor-pointer")}
      style={style}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className={checkboxClassName}
        aria-label={measurementConsentFieldAccessibleName(lang)}
      />
      <span className={cn("min-w-0", disabled && "opacity-60")} onClick={keepLinkClickFromToggling}>
        <ConsentSegmentsText segments={measurementConsentSummarySegments(lang)} />
      </span>
    </label>
  );
}
