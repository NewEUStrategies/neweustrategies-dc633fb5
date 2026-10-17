import { useMemo } from "react";
import { createIsomorphicFn } from "@tanstack/react-start";
import { normalizeBuilderRichHtml } from "@/lib/builder/normalizeRichHtml";
import { normalizeBuilderRichHtmlDom } from "@/lib/builder/normalizeRichHtmlDom";
import { RichHtmlContent, type RichHtmlProps } from "./RichHtmlContent";

// Serwer normalizuje node-html-parserem (Worker nie ma DOM-u), przeglądarka
// natywnym parserem - te same przebiegi i reguły. Kompilator Start wycina
// gałąź serwerową z buildu klienta razem z importem, więc parser (~47 KB gzip)
// nie trafia do żadnego chunku przeglądarki (wzorzec z `RichHtmlView.tsx`).
//
// Hydratacja: React 19 nie łata `dangerouslySetInnerHTML` przy niezgodności,
// a `RichHtmlContent` przepisuje `innerHTML` tylko przy zmianie WARTOŚCI
// `html`, `className` albo `style` (nowy obiekt stylu o tej samej treści nic
// nie zmienia), więc strona wczytana z serwera zostaje przy HTML-u
// znormalizowanym na serwerze; wynik bliźniaka DOM widać dopiero przy
// nawigacji po stronie klienta. Dla HTML z jawnie domkniętymi elementami
// (tak zapisują edytory buildera) oba silniki dają to samo drzewo (test
// parytetu w `normalizeRichHtml.test.ts`); rozjazd jest na wejściu
// niepoprawnym ORAZ na poprawnym HTML5 z pominiętymi opcjonalnymi znacznikami
// końcowymi (`</p>` przed listą, `</li>`/`</p>` przed `</ol>`, `</td>`/`</tr>`):
// node-html-parser skleja akapity, gubi listę albo przestawia ją względem
// tabeli - opis w `normalizeRichHtmlDom.ts`.
const normalizeListHtml = createIsomorphicFn()
  .server((html: string) => normalizeBuilderRichHtml(html))
  .client((html: string) => normalizeBuilderRichHtmlDom(html));

export function RichHtmlListView({ html, ...props }: RichHtmlProps) {
  const normalized = useMemo(() => normalizeListHtml(html), [html]);
  return <RichHtmlContent {...props} html={normalized} />;
}
