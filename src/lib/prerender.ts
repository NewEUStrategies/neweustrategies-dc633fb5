// Osłony Speculation Rules API: strona wyrenderowana spekulacyjnie
// (prerender) NIE może strzelać beaconami (odsłony, RUM) zanim użytkownik
// faktycznie na nią przejdzie - inaczej sam najazd kursora zawyżałby liczniki
// i telemetrię. `document.prerendering` + zdarzenie `prerenderingchange`
// pochodzą ze specyfikacji Prerender API; przeglądarki bez wsparcia po prostu
// nie prerenderują, więc helper degraduje do natychmiastowego wywołania.

type PrerenderAwareDocument = Document & { prerendering?: boolean };

export function isPrerendering(): boolean {
  if (typeof document === "undefined") return false;
  return (document as PrerenderAwareDocument).prerendering === true;
}

/**
 * Wykonuje `callback` od razu (zwykła nawigacja) albo dopiero przy aktywacji
 * prerenderowanej strony. Zwraca funkcję sprzątającą do cleanupu efektu -
 * odmontowanie przed aktywacją zdejmuje nasłuch i callback nigdy nie strzela.
 */
export function afterPrerendering(callback: () => void): () => void {
  if (!isPrerendering()) {
    callback();
    return () => undefined;
  }
  const onActivated = (): void => callback();
  document.addEventListener("prerenderingchange", onActivated, { once: true });
  return () => document.removeEventListener("prerenderingchange", onActivated);
}
