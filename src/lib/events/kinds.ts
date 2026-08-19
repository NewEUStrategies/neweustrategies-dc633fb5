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

/**
 * Etykieta rodzaju wydarzenia; nieznany kind wraca bez zmian.
 *
 * `Object.hasOwn`, a nie samo `KIND_LABELS[kind]`: dla `kind` kolidującego
 * z nazwą z prototypu obiektu (`constructor`, `toString`) odczyt trafiał
 * w `Object.prototype`, warunek widział wartość PRAWDZIWĄ (funkcję), a
 * `entry[lang]` dawało `undefined` - czyli funkcja łamała własną obietnicę
 * i zwracała pustkę zamiast surowej wartości. Kolumna `events.kind` jest dziś
 * ograniczona CHECK-iem, więc nie było to osiągalne z UI, ale kontrakt
 * publicznej funkcji nie ma zależeć od cudzego CHECK-a.
 */
export function eventKindLabel(kind: string, lang: Lang): string {
  if (!Object.hasOwn(KIND_LABELS, kind)) return kind;
  return KIND_LABELS[kind]![lang];
}
