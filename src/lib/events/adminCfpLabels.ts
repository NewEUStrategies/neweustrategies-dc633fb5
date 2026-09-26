// Mapy etykiet PANELU naboru prelegentów: wartość z bazy -> pełny klucz
// `adminEventCfp.*`.
//
// OSOBNO OD KOMPONENTÓW, bo używa ich więcej niż jeden ekran (typ pytania:
// lista pytań i okno pytania), a plik komponentu eksportujący stałą łamie
// szybkie odświeżanie. Osobno od `cfpEnums`, bo tamten moduł jedzie w chunku
// publicznym i niesie wyłącznie klucze `eventCfp.*`.
//
// KLUCZE DOSŁOWNE (`Record<Enum, "pełny.klucz">`), nie składane z szablonu -
// bramka kluczy i18n widzi tylko literały.
import type { CfpFieldType, CfpPhase } from "@/lib/events/cfpEnums";

export const CFP_FIELD_TYPE_LABEL_KEYS: Record<CfpFieldType, string> = {
  text: "adminEventCfp.fieldTypes.text",
  textarea: "adminEventCfp.fieldTypes.textarea",
  select: "adminEventCfp.fieldTypes.select",
  multiselect: "adminEventCfp.fieldTypes.multiselect",
  checkbox: "adminEventCfp.fieldTypes.checkbox",
  url: "adminEventCfp.fieldTypes.url",
  number: "adminEventCfp.fieldTypes.number",
};

export const CFP_PHASE_LABEL_KEYS: Record<CfpPhase, string> = {
  none: "adminEventCfp.phases.none",
  scheduled: "adminEventCfp.phases.scheduled",
  open: "adminEventCfp.phases.open",
  closed: "adminEventCfp.phases.closed",
};
