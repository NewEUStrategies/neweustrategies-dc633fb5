// Bliźniak przeglądarkowy `normalizeRichHtml.ts`: te same cztery przebiegi na
// natywnym parserze zamiast node-html-parser. Chunk `normalizeRichHtml` był
// w 98,7% parserem (46,7 KB gzip) i był publiczny przez `Editable` (kanwa)
// i `RichHtmlListView` (leniwy renderer list); trzeci konsument to
// `RichHtmlField` (panel). Serwer zostaje przy node-html-parser (Worker nie
// ma DOM-u); reguły są wspólne
// (`normalizeRichHtmlRules.ts`), a `normalizeRichHtml.test.ts` biegnie każdym
// przypadkiem przez OBA silniki.
//
// TYLKO PRZEGLĄDARKA: funkcja dotyka `document` przy wywołaniu (nie przy
// imporcie), więc moduł można bezpiecznie zaimportować w grafie SSR, ale wołać
// wolno wyłącznie w efektach, handlerach albo w gałęzi `.client()`.
//
// RÓŻNICE WZGLĘDEM SERWERA - wyłącznie serializacja, to samo drzewo po
// sparsowaniu przez przeglądarkę (dowód: test parytetu w
// `normalizeRichHtml.test.ts`):
//   * nazwy znaczników małymi literami (`<UL>` -> `<ul>`),
//   * encje w postaci kanonicznej przeglądarki (`&#160;` -> `&nbsp;`,
//     `&quot;` w tekście -> `"`, `&eacute;` -> `é`),
//   * atrybuty zawsze w cudzysłowach `"`.
// Na wejściu NIEPOPRAWNYM wg HTML5 przeglądarka naprawia drzewo inaczej niż
// node-html-parser: niedomknięte `<ul><li>tekst` serwer gubi razem z tekstem,
// a DOM zachowuje punkt; lista w `<p>` (HTML5 zamyka akapit przed `<ul>`)
// po usunięciu zostawia tekst za nią na serwerze w akapicie, w DOM-ie poza
// nim; listę w `<pre>` serwer czyta jako tekst. Edytory buildera zapisują
// serializację DOM-u, więc takie wejście przychodzi tylko z importu albo
// ręcznego kodu - a pierwsze wejście i tak pokazuje wersję serwera
// (`RichHtmlListView.tsx`). Przypadki spisane w teście „ZNANE RÓŻNICE”.
import {
  isBlankListText,
  LIST_ITEM_KEEPERS,
  LIST_MARKUP,
  LIST_TAGS,
  MAX_PASSES,
  SOCIAL_LIST_CLASS,
} from "./normalizeRichHtmlRules";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

function meaningfulChildren(element: Element): Node[] {
  return Array.from(element.childNodes).filter((child) => {
    if (child.nodeType === TEXT_NODE) return (child.textContent ?? "").trim().length > 0;
    return child.nodeType === ELEMENT_NODE;
  });
}

/** Zachowanie serwera: node-html-parser domyślnie gubi komentarze przy parsowaniu. */
function dropComments(root: DocumentFragment) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const comment of comments) comment.parentNode?.removeChild(comment);
}

/** Przeglądarkowa wersja `normalizeBuilderRichHtml` - kontrakt i przebiegi te same. */
export function normalizeBuilderRichHtmlDom(html: string): string {
  if (!html || !LIST_MARKUP.test(html)) return html;

  // `<template>`, nigdy `<div>` z `document`: wejście NIE jest tu jeszcze
  // sanityzowane, a treść szablonu trafia do inertnego dokumentu - obrazy się
  // nie pobierają, więc `<img onerror>` nie odpala (w `<div>` odpaliłby).
  // Przy okazji parser nie wyrzuca `<td>`/`<tr>` spoza tabeli, jak serwer.
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  dropComments(root);

  let changed = true;
  let pass = 0;

  while (changed && pass < MAX_PASSES) {
    changed = false;
    pass += 1;

    // 1) Puste <li> (białe znaki, <br>, &nbsp;) bez linku ani nośnika.
    for (const item of Array.from(root.querySelectorAll("li"))) {
      if (!isBlankListText(item.textContent)) continue;
      if (item.querySelector(LIST_ITEM_KEEPERS)) continue;
      item.remove();
      changed = true;
    }

    // 2) Listy, które straciły wszystkie punkty.
    for (const list of Array.from(root.querySelectorAll("ul, ol"))) {
      if (!list.querySelector("li")) {
        list.remove();
        changed = true;
      }
    }

    // 3) Skorupy: lista z jednym punktem, którego jedynym dzieckiem jest lista.
    //    Od najgłębszej (odwrócona kolejność dokumentu), jak na serwerze.
    //    Serwer wstawia kopię przez serializację; tu przenosimy sam węzeł.
    for (const list of Array.from(root.querySelectorAll("ul, ol")).reverse()) {
      const listChildren = meaningfulChildren(list);
      if (listChildren.length !== 1) continue;

      const item = listChildren[0];
      if (!isElement(item) || item.tagName.toUpperCase() !== "LI") continue;

      const itemChildren = meaningfulChildren(item);
      if (itemChildren.length !== 1) continue;
      const nestedList = itemChildren[0];
      if (!isElement(nestedList) || !LIST_TAGS.has(nestedList.tagName.toUpperCase())) continue;

      list.replaceWith(nestedList);
      changed = true;
    }

    // 4) Rząd ikon: wszystkie punkty bez tekstu i każdy z linkiem.
    for (const list of Array.from(root.querySelectorAll("ul, ol"))) {
      const cls = list.getAttribute("class") ?? "";
      if (cls.includes(SOCIAL_LIST_CLASS)) continue;
      const lis = Array.from(list.querySelectorAll("li"));
      if (lis.length === 0) continue;
      const allAnchorOnly = lis.every(
        (li) => isBlankListText(li.textContent) && li.querySelector("a[href]") !== null,
      );
      if (!allAnchorOnly) continue;
      list.setAttribute("class", `${cls} ${SOCIAL_LIST_CLASS}`.trim());
      changed = true;
    }
  }

  return template.innerHTML;
}
