// Atom: regulaminy i zgody wydarzenia (`event_terms`).
//
// WERSJA JEST CZESCIA AKCEPTACJI. `event_term_acceptances` zapisuje wersje
// dokumentu, wiec pokazujemy ja obok etykiety - inaczej uczestnik nie wie,
// pod czym sie podpisal, a organizator nie ma jak tego wykazac.
//
// TRESC ALBO ADRES, NIGDY OBIE NARAZ NA SILE: krotki regulamin stoi w
// `body_*`, dluzszy pod `external_url`. Adres otwieramy w nowej karcie z
// `noreferrer noopener`, bo to dokument organizatora, a nie nasza podstrona.
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { RegistrationFormTerm } from "@/lib/events/registrationFormSurface";
import { Checkbox } from "@/components/ui/checkbox";

export function RegistrationTermsList({
  terms,
  accepted,
  onToggle,
  lang,
  error,
}: {
  terms: RegistrationFormTerm[];
  accepted: string[];
  onToggle: (termId: string, next: boolean) => void;
  lang: "pl" | "en";
  /** Gotowe zdanie o brakujacych zgodach obowiazkowych albo `null`. */
  error: string | null;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      {terms.map((term) => {
        const label = (lang === "en" ? term.labelEn : term.labelPl) || term.key;
        // TRESC NIE ZNIKA RAZEM Z TLUMACZENIEM. Brak `body_en` znaczyl do tej
        // pory „bez akapitu", wiec uczestnik ogladajacy strone po angielsku
        // widzial pole wyboru z gwiazdka i numer wersji - ani jednego zdania
        // regulaminu (`external_url` tez bywa pusty) - a `event_term_acceptances`
        // zapisywalo to jako pelnoprawna akceptacje. Spadamy wiec do drugiego
        // jezyka, tak samo jak etykieta spada do klucza. `lang` na akapicie
        // mowi czytnikowi ekranu, ze zdanie jest w innym jezyku niz strona.
        const ownBody = lang === "en" ? term.bodyEn : term.bodyPl;
        const otherBody = lang === "en" ? term.bodyPl : term.bodyEn;
        const body = ownBody || otherBody;
        const bodyLang = ownBody === "" ? (lang === "en" ? "pl" : "en") : lang;
        return (
          <div key={term.id} className="space-y-1">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={accepted.includes(term.id)}
                onCheckedChange={(next) => onToggle(term.id, next === true)}
              />
              <span className="text-foreground">
                {label}
                {term.isRequired ? " *" : ""}
              </span>
            </label>
            <p className="ml-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{t("eventRegistration.labels.version", { version: term.version })}</span>
              {term.externalUrl !== null && (
                <a
                  href={term.externalUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  {t("eventRegistration.labels.readTerms")}
                </a>
              )}
            </p>
            {body !== "" && (
              <p lang={bodyLang} className="ml-6 whitespace-pre-line text-xs text-muted-foreground">
                {body}
              </p>
            )}
          </div>
        );
      })}
      {error !== null && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
