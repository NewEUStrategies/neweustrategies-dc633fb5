// Współdzielony kontrakt markera przypisu dla testów.
//
// Silnik `src/lib/footnotes.ts` produkuje DWA warianty markera:
//
//  - KOTWICZONY (treść dokumentu z sekcją końcową):
//      <sup class="fn-ref"><a href="#fn-N" id="fnref-N" data-fn="N" …>[N]</a></sup>
//  - SAMODZIELNY (globalne widgety, numeracja per-widget; `anchored: false`):
//      <sup class="fn-ref"><span title="…" role="note">[N]</span></sup>
//
// `processWidgetFootnotes` celowo używa wariantu SAMODZIELNEGO: przypisy
// globalnych widgetów nie trafiają do dokumentowej sekcji końcowej, więc
// `id`/`href`/`data-fn` dublowałyby identyfikatory dokumentu i linkowały do
// cudzych not. Testy overlaya asertują właśnie ten wariant - stąd te helpery
// w jednym miejscu, żeby zmiana kontraktu była jedną zmianą, nie pięcioma.

/** Pełny HTML samodzielnego markera (widgety globalne). */
export function standaloneMarker(id: number, title: string): string {
  return `<sup class="fn-ref"><span title="${title}" role="note">[${id}]</span></sup>`;
}

/** Liczba markerów przypisu w kawałku HTML. */
export function countMarkers(html: string): number {
  return (html.match(/<sup class="fn-ref">/g) ?? []).length;
}

/** Czy HTML zawiera samodzielny marker o numerze `id`. */
export function hasMarker(html: string, id: number): boolean {
  return new RegExp(`role="note">\\[${id}\\]</span>`).test(html);
}
