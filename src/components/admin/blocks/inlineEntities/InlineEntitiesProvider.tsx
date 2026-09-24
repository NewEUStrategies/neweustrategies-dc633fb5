// Provider encji inline dla jednego edytora bloków (PostBlockEditor).
//
// Trzyma okna (edycja, menedżer), liczy użycia w OBU wersjach językowych
// i zapewnia synchronizację kopiuj-wklej:
//   * w obrębie materiału wklejone odwołanie wskazuje ten sam rekord - nie ma
//     czego kopiować;
//   * do innego materiału (inny wpis, inna karta) rekordy jadą w schowku
//     (`application/x-nes-inline-entities` + localStorage) i po wklejeniu są
//     dopisywane do rejestru materiału docelowego jako jego własna kopia.
//
// Wszystkie zmiany rejestru idą przez `update` = funkcyjna aktualizacja
// historii (undo/redo obejmuje także edycję encji).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { BlocksDoc } from "@/lib/blocks/types";
import type { BlocksDocUpdate } from "../hooks/useBlocksHistory";
import type { InlineEntity, InlineEntityLang } from "@/lib/blocks/inlineEntities/model";
import {
  collectInlineEntityIdsFromHtml,
  countInlineEntityUsage,
  importInlineEntities,
  readInlineEntities,
  removeInlineEntity,
  upsertInlineEntity,
} from "@/lib/blocks/inlineEntities/registry";
import {
  INLINE_ENTITY_CLIPBOARD_MIME,
  parseInlineEntityClipboard,
  recallCopiedInlineEntities,
  rememberCopiedInlineEntities,
  serializeInlineEntityClipboard,
} from "@/lib/blocks/inlineEntities/clipboard";
import {
  InlineEntitiesContext,
  type InlineEntitiesContextValue,
  type InlineEntityEditorRequest,
} from "./InlineEntitiesContext";
import { InlineEntityDialog } from "./InlineEntityDialog";
import { InlineEntitiesManagerDialog } from "./InlineEntitiesManagerDialog";

interface Props {
  /** Dokument aktywnej wersji językowej (z historii). */
  activeDoc: BlocksDoc;
  /** Dokument drugiej wersji językowej (tylko do liczenia użyć). */
  otherDoc: BlocksDoc;
  lang: InlineEntityLang;
  update: (next: BlocksDocUpdate) => void;
  /** Korzeń edytora - schowek obsługujemy tylko dla zdarzeń z jego wnętrza. */
  rootRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}

function mergeUsage(...maps: Map<string, number>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const map of maps) for (const [id, n] of map) out.set(id, (out.get(id) ?? 0) + n);
  return out;
}

/** Identyfikatory encji w bieżącym zaznaczeniu DOM (fallback, gdy HTML schowka jest pusty). */
function idsInSelection(): string[] {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  if (!selection || selection.rangeCount === 0) return [];
  const holder = document.createElement("div");
  for (let i = 0; i < selection.rangeCount; i += 1) {
    holder.appendChild(selection.getRangeAt(i).cloneContents());
  }
  return collectInlineEntityIdsFromHtml(holder.innerHTML);
}

export function InlineEntitiesProvider({
  activeDoc,
  otherDoc,
  lang,
  update,
  rootRef,
  children,
}: Props) {
  const [request, setRequest] = useState<InlineEntityEditorRequest | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);

  const entities = useMemo(() => readInlineEntities(activeDoc), [activeDoc.meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const usage = useMemo(
    () =>
      mergeUsage(countInlineEntityUsage(activeDoc.blocks), countInlineEntityUsage(otherDoc.blocks)),
    [activeDoc.blocks, otherDoc.blocks],
  );

  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const updateRef = useRef(update);
  updateRef.current = update;

  const upsert = useCallback((entity: InlineEntity) => {
    updateRef.current((doc) => upsertInlineEntity(doc, entity));
  }, []);
  const remove = useCallback((id: string) => {
    updateRef.current((doc) => removeInlineEntity(doc, id));
  }, []);
  const importEntities = useCallback((list: readonly InlineEntity[]) => {
    if (list.length === 0) return;
    updateRef.current((doc) => importInlineEntities(doc, list));
  }, []);

  // Schowek: kopiowanie dokłada rekordy, wklejanie je importuje.
  useEffect(() => {
    const inside = (target: EventTarget | null): boolean => {
      const root = rootRef.current;
      return Boolean(root && target instanceof Node && root.contains(target));
    };

    // Faza bąbelkowania na `window` - po TipTapie i po schowku bloków, które
    // wypełniają `text/html`; tu tylko DOKŁADAMY własny typ MIME.
    const onCopy = (event: ClipboardEvent) => {
      if (!inside(event.target)) return;
      const html = event.clipboardData?.getData("text/html") ?? "";
      const ids = new Set([...collectInlineEntityIdsFromHtml(html), ...idsInSelection()]);
      const copied = [...ids]
        .map((id) => entitiesRef.current[id])
        .filter((entity): entity is InlineEntity => Boolean(entity));
      if (copied.length === 0) return;
      rememberCopiedInlineEntities(copied);
      try {
        event.clipboardData?.setData(
          INLINE_ENTITY_CLIPBOARD_MIME,
          serializeInlineEntityClipboard(copied),
        );
      } catch {
        /* przeglądarka bez własnych typów MIME - zostaje localStorage */
      }
    };

    // Faza przechwytywania - czytamy schowek, zanim zrobi to TipTap. Import
    // odkładamy do następnego zadania: wklejka zapisuje dokument SYNCHRONICZNIE
    // (z propsa kanwy), więc rejestr musi wejść dopiero na ten stan.
    const onPaste = (event: ClipboardEvent) => {
      if (!inside(event.target)) return;
      const html = event.clipboardData?.getData("text/html") ?? "";
      const missing = collectInlineEntityIdsFromHtml(html).filter((id) => !entitiesRef.current[id]);
      if (missing.length === 0) return;
      const wanted = new Set(missing);
      let incoming = parseInlineEntityClipboard(
        event.clipboardData?.getData(INLINE_ENTITY_CLIPBOARD_MIME),
      ).filter((entity) => wanted.has(entity.id));
      if (incoming.length < missing.length) {
        const known = new Set(incoming.map((e) => e.id));
        incoming = [
          ...incoming,
          ...recallCopiedInlineEntities(missing.filter((id) => !known.has(id))),
        ];
      }
      if (incoming.length === 0) return;
      window.setTimeout(() => importEntities(incoming), 0);
    };

    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCopy);
    window.addEventListener("paste", onPaste, true);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCopy);
      window.removeEventListener("paste", onPaste, true);
    };
  }, [rootRef, importEntities]);

  const value = useMemo<InlineEntitiesContextValue>(
    () => ({
      lang,
      entities,
      usage,
      upsert,
      remove,
      importEntities,
      openEditor: setRequest,
      openManager: () => setManagerOpen(true),
    }),
    [lang, entities, usage, upsert, remove, importEntities],
  );

  return (
    <InlineEntitiesContext.Provider value={value}>
      {children}
      <InlineEntityDialog
        request={request}
        entities={entities}
        usage={usage}
        lang={lang}
        onClose={() => setRequest(null)}
        onSave={upsert}
      />
      <InlineEntitiesManagerDialog
        open={managerOpen}
        entities={entities}
        usage={usage}
        lang={lang}
        onOpenChange={setManagerOpen}
        onEdit={(id) => {
          setManagerOpen(false);
          setRequest({ mode: "edit", id });
        }}
        onRemove={remove}
      />
    </InlineEntitiesContext.Provider>
  );
}
