// Węzeł TipTap odwołania do encji inline (firma / osoba).
//
// Węzeł jest ATOMEM: w treści akapitu zapisuje się wyłącznie
//   <span data-nes-entity="ie_…" data-nes-entity-kind="company">Nazwa</span>
// a wszystkie dane encji żyją w rejestrze dokumentu. Kopiuj-wklej (Ctrl+C/V,
// przeciąganie) przenosi więc samo odwołanie - wklejone w drugie miejsce
// materiału wskazuje TEN SAM rekord i zmienia się razem z oryginałem.
//
// Tekst w środku to etykieta zastępcza (RSS, wyszukiwarka, TTS); edytor
// wyrównuje ją przy każdej zmianie nazwy (`syncInlineEntityLabels`).

import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { INLINE_ENTITY_ATTR, INLINE_ENTITY_KIND_ATTR } from "@/lib/blocks/inlineEntities/registry";
import {
  inlineEntityDisplayName,
  type InlineEntity,
  type InlineEntityKind,
} from "@/lib/blocks/inlineEntities/model";
import { InlineEntityNodeView } from "./InlineEntityNodeView";

export const INLINE_ENTITY_NODE = "inlineEntity";

export interface InlineEntityNodeAttrs {
  id: string | null;
  kind: InlineEntityKind;
  label: string;
}

/** Treść do `insertContent` - odwołanie i spacja za nim (pisanie płynie dalej). */
export function inlineEntityContent(entity: InlineEntity) {
  return [
    {
      type: INLINE_ENTITY_NODE,
      attrs: {
        id: entity.id,
        kind: entity.kind,
        label: inlineEntityDisplayName(entity),
      } satisfies InlineEntityNodeAttrs,
    },
    { type: "text", text: " " },
  ];
}

export const InlineEntityNode = Node.create({
  name: INLINE_ENTITY_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute(INLINE_ENTITY_ATTR),
        renderHTML: (attrs: { id?: string | null }) =>
          attrs.id ? { [INLINE_ENTITY_ATTR]: attrs.id } : {},
      },
      kind: {
        default: "company",
        parseHTML: (el: HTMLElement): InlineEntityKind =>
          el.getAttribute(INLINE_ENTITY_KIND_ATTR) === "person" ? "person" : "company",
        renderHTML: (attrs: { kind?: InlineEntityKind }) => ({
          [INLINE_ENTITY_KIND_ATTR]: attrs.kind === "person" ? "person" : "company",
        }),
      },
      label: {
        default: "",
        parseHTML: (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim(),
        // Etykieta jest treścią węzła (tekst w spanie), nie atrybutem.
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    // Wyżej niż `TextStyle` (span ze stylem) - odwołanie nie może stać się
    // zwykłym spanem z kolorem przy wklejeniu z innego akapitu.
    return [{ tag: `span[${INLINE_ENTITY_ATTR}]`, priority: 100 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), String(node.attrs.label ?? "")];
  },

  renderText({ node }) {
    return String(node.attrs.label ?? "");
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineEntityNodeView, { as: "span" });
  },
});
