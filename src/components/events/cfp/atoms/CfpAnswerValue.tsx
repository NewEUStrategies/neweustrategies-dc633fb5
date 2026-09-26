// Atom: odpowiedź na pytanie formularza zgłoszenia, gotowa do przeczytania.
//
// WSPÓLNY DLA PANELU ORGANIZATORA I PANELU RECENZENTA. Obie strony czytają te
// same `answers`, więc jedna reguła (`cfpAnswerDisplay`) mówi, jak pokazać
// „tak/nie", listę opcji i adres - organizator i recenzent widzą to samo.
//
// ADRES JEST ODNOŚNIKIEM TYLKO PRZY `https://`. Inny zapis zostaje tekstem:
// panel nie zamienia w klikalny link niczego, co nie przeszło walidacji bazy.
import { useTranslation } from "react-i18next";

import { cfpAnswerDisplay } from "@/lib/events/cfpRows";
import type { CfpFieldDef } from "@/lib/events/cfpSurface";
import { uiLang } from "@/lib/i18n/format";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";

export function CfpAnswerValue({ field, value }: { field: CfpFieldDef; value: unknown }) {
  ensureEventCfpI18n();
  const { t, i18n } = useTranslation();
  const display = cfpAnswerDisplay(field, value, uiLang(i18n.language));
  switch (display.kind) {
    case "empty":
      return <span className="text-muted-foreground">{t("eventCfp.answers.empty")}</span>;
    case "yes":
      return <span>{t("eventCfp.answers.yes")}</span>;
    case "no":
      return <span>{t("eventCfp.answers.no")}</span>;
    case "url":
      return (
        <a href={display.value} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline">
          {display.value}
        </a>
      );
    case "list":
      return <span>{display.values.join(", ")}</span>;
    default:
      return <span className="whitespace-pre-line">{display.value}</span>;
  }
}
