import { parse, type HTMLElement } from "node-html-parser";

const LIST_TAGS = new Set(["UL", "OL"]);

function meaningfulChildren(element: HTMLElement) {
  return element.childNodes.filter((child) => {
    if (child.nodeType === 3) return child.text.trim().length > 0;
    return child.nodeType === 1;
  });
}

/**
 * Removes accidental list shells produced by imported WordPress/Elementor HTML
 * and repeated `insertUnorderedList` commands:
 *
 *   <ul><li><ul><li>Real item</li></ul></li></ul>
 *   -> <ul><li>Real item</li></ul>
 *
 * A genuine nested list is preserved because its parent `<li>` also contains
 * text or another element. The function is universal (browser + Worker SSR),
 * so the builder canvas and the published PL/EN pages receive identical HTML.
 */
export function normalizeBuilderRichHtml(html: string): string {
  if (!html || !/<(?:ul|ol)\b/i.test(html)) return html;

  const root = parse(html);
  let changed = true;
  let pass = 0;

  while (changed && pass < 20) {
    changed = false;
    pass += 1;

    const lists = root.querySelectorAll("ul, ol").reverse();
    for (const list of lists) {
      const listChildren = meaningfulChildren(list);
      if (listChildren.length !== 1) continue;

      const onlyItem = listChildren[0];
      if (onlyItem.nodeType !== 1) continue;
      const item = onlyItem as HTMLElement;
      if (item.rawTagName.toUpperCase() !== "LI") continue;

      const itemChildren = meaningfulChildren(item);
      if (itemChildren.length !== 1 || itemChildren[0].nodeType !== 1) continue;
      const nestedList = itemChildren[0] as HTMLElement;
      if (!LIST_TAGS.has(nestedList.rawTagName.toUpperCase())) continue;

      list.replaceWith(nestedList.toString());
      changed = true;
    }
  }

  return root.innerHTML;
}