// Kontekst edytora bloków - międzymodułowy kanał na wartości, których nie
// opłaca się wiercić przez propsy (język aktywnego dokumentu jest potrzebny
// głęboko: inserter wzorców żyje też w mini-kanwach zagnieżdżeń).

import { createContext, useContext } from "react";
import type { PatternLang } from "@/lib/blocks/patterns";

interface BlockEditorContextValue {
  /** Język AKTYWNEGO dokumentu bloków (nie języka UI) - treść wzorców. */
  lang: PatternLang;
}

const BlockEditorContext = createContext<BlockEditorContextValue>({ lang: "pl" });

export function BlockEditorProvider({
  lang,
  children,
}: {
  lang: PatternLang;
  children: React.ReactNode;
}) {
  return <BlockEditorContext.Provider value={{ lang }}>{children}</BlockEditorContext.Provider>;
}

export function useBlockEditorLang(): PatternLang {
  return useContext(BlockEditorContext).lang;
}
