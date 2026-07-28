// Etykiety i18n rodzajow wydarzen (events.kind) - wspolne dla widgetow
// event-list / event-countdown i sekcji prelegentow. Czysty modul bez React.
export type Lang = "pl" | "en";

const KIND_LABELS: Record<string, { pl: string; en: string }> = {
  webinar: { pl: "Webinar", en: "Webinar" },
  briefing: { pl: "Briefing", en: "Briefing" },
  roundtable: { pl: "Okrągły stół", en: "Roundtable" },
  ama: { pl: "AMA", en: "AMA" },
  in_person: { pl: "Stacjonarne", en: "In person" },
  hybrid: { pl: "Hybrydowe", en: "Hybrid" },
};

/** Etykieta rodzaju wydarzenia; nieznany kind wraca bez zmian. */
export function eventKindLabel(kind: string, lang: Lang): string {
  const entry = KIND_LABELS[kind];
  return entry ? entry[lang] : kind;
}
