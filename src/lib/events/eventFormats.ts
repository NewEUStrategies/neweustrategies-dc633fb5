// Format wydarzenia (`events.format`) - lisc wydzielony z `eventTypes.ts`.
//
// PO CO OSOBNY PLIK. Walidator adresu listy wydarzen w panelu
// (`eventListSearch.parseEventListParams`) sprawdza `?f=` tym zbiorem, a jedzie
// w `validateSearch` trasy `/admin/events/list`, czyli w NIEDZIELONEJ czesci
// pliku trasy - w chunku WEJSCIOWYM kazdej strony serwisu. Import z
// `eventTypes` ciagnal tam caly katalog rodzajow (cztery enumy przeplywu, mapy
// etykiet, reguly klucza rodzaju) dla jednego `includes` (kronika
// `scripts/check-bundle-size.ts`, wpis XX). `eventTypes` re-eksportuje ten
// zbior, wiec pozostali importerzy sie nie zmieniaja.

/** GDZIE sie dzieje. Rozdzielone od `kind`, ktore mowi CZYM jest wydarzenie. */
export const EVENT_FORMATS = ["onsite", "online", "hybrid"] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];

export function isEventFormat(value: string): value is EventFormat {
  return (EVENT_FORMATS as readonly string[]).includes(value);
}
