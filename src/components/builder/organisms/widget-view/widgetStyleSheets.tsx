// Stałe arkusze widgetów jako ZASOBY React 19 (`<style href precedence>`),
// zamiast bloków `<style>` emitowanych inline przy każdej instancji.
//
// DLACZEGO
// Widok buildera renderuje kilkadziesiąt bloków `<style>` na dokument, a te,
// których treść nie zależy od instancji, jechały tyle razy, ile instancji
// widgetu było na stronie (audyt CWV, F22). React 19 traktuje `<style>`
// z parą `href` + `precedence` jak zasób: hoistuje go do `<head>`, wypisuje
// DOKŁADNIE RAZ na dokument (klucz = `href`) i zachowuje po nawigacji
// klienckiej. Koszt każdej kolejnej instancji spada do zera bajtów.
//
// KASKADA
// Wszystkie arkusze widgetów dzielą jedną warstwę precedencji `nes-widgets`,
// więc React trzyma je obok siebie w `<head>`, w kolejności pierwszego
// napotkania. Arkusze instancji (typografia widgetu, kolory, hover) zostają
// zwykłymi, NIEhoistowanymi blokami `<style>` w `<body>` - w dokumencie stoją
// po `<head>`, więc przy równej specyficzności zawsze wygrywają. Z tego samego
// powodu reguły tutaj NIE używają `!important` ponad to, co miały wcześniej,
// i nie podnoszą specyficzności względem wersji inline.
//
// UWAGA: `href` musi być STAŁY i unikalny dla treści. Arkusz parametryzowany
// (np. klatki animacji zależne od liczby elementów) dokleja parametr do `href`,
// żeby dwie różne treści nie zjadły się nawzajem pod jednym kluczem.
import type { ReactElement } from "react";

/** Jedna warstwa precedencji dla wszystkich stałych arkuszy widgetów. */
export const WIDGET_SHEET_PRECEDENCE = "nes-widgets";

/**
 * Stały arkusz widgetu. `name` staje się kluczem deduplikacji (`href`), więc
 * musi być unikalny w obrębie aplikacji i stabilny między SSR a klientem.
 */
export function WidgetStyleSheet({ name, css }: { name: string; css: string }): ReactElement {
  return (
    <style href={name} precedence={WIDGET_SHEET_PRECEDENCE}>
      {css}
    </style>
  );
}
