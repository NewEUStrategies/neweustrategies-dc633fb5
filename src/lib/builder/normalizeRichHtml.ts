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

    // 1) Remove empty <li> (whitespace, <br>, &nbsp; only) — silent bullets
    //    from WP/Elementor imports and accidental Enter presses in the editor.
    //    Preserve list items that carry a link or media (social icon lists,
    //    nested lists, embeds), even when their visible text is empty.
    const items = root.querySelectorAll("li");
    for (const item of items) {
      const text = item.text.replace(/\u00a0/g, "").trim();
      if (text.length > 0) continue;
      const hasKeeper = item.querySelectorAll("a[href], ul, ol, img, iframe, video, audio, button").length > 0;
      if (hasKeeper) continue;
      item.remove();
      changed = true;
    }

    // 2) Drop lists that lost all their items.
    const emptyLists = root.querySelectorAll("ul, ol");
    for (const list of emptyLists) {
      if (list.querySelectorAll("li").length === 0) {
        list.remove();
        changed = true;
      }
    }

    // 3) Collapse accidental single-item list shells.
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

    // 4) Tag icon-only anchor lists (WP social row) so CSS can drop the bullet
    //    and lay them out horizontally. We do NOT delete them — the anchor URL
    //    is the actual value; only the bullet is noise.
    const anchorLists = root.querySelectorAll("ul, ol");
    for (const list of anchorLists) {
      const cls = list.getAttribute("class") ?? "";
      if (cls.includes("cms-social-list")) continue;
      const lis = list.querySelectorAll("li");
      if (lis.length === 0) continue;
      const allAnchorOnly = lis.every((li) => {
        if (li.text.replace(/\u00a0/g, "").trim().length > 0) return false;
        return li.querySelectorAll("a[href]").length > 0;
      });
      if (!allAnchorOnly) continue;
      list.setAttribute("class", `${cls} cms-social-list`.trim());
      changed = true;
    }
  }

  return root.innerHTML;
}