// Language-aware bridge between the parent form state (LocalizedBlocks) and
// the per-language undo/redo stack (useBlocksHistory).
//
// Contract:
//   * switching language resets the stack to that language's doc;
//   * a genuinely EXTERNAL value replacement (load from server, revision
//     restore) resets the stack;
//   * the parent's echo of a doc the editor itself just propagated must NOT
//     reset the stack - this was the "dead undo" bug: every keystroke's
//     onChange -> parent setState -> new value identity -> reset() wiped
//     past/future, so canUndo never became true.
//
// Extracted from PostBlockEditor so the sync rules are unit-testable without
// rendering the whole canvas/sidebar tree.
import { useEffect, useRef, useState } from "react";
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { EMPTY_BLOCKS_DOC } from "@/lib/blocks/types";
import { useBlocksHistory, type BlocksHistory } from "./useBlocksHistory";

export type BlocksLang = "pl" | "en";

export interface LocalizedBlocksHistory {
  lang: BlocksLang;
  setLang: (lang: BlocksLang) => void;
  history: BlocksHistory;
  safe: LocalizedBlocks;
}

export function useLocalizedBlocksHistory(
  value: LocalizedBlocks | null,
  onChange: (next: LocalizedBlocks) => void,
): LocalizedBlocksHistory {
  const [lang, setLang] = useState<BlocksLang>("pl");

  const safe: LocalizedBlocks = {
    pl: value?.pl ?? EMPTY_BLOCKS_DOC,
    en: value?.en ?? EMPTY_BLOCKS_DOC,
  };

  const history = useBlocksHistory(safe[lang]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const safeRef = useRef(safe);
  safeRef.current = safe;

  // Reset history ONLY on a language switch or an external value replacement.
  // Docs the editor itself propagated are remembered in lastSyncRef, so the
  // parent echo (same object identity) leaves the undo/redo stacks intact.
  const lastSyncRef = useRef<{ lang: BlocksLang; doc: BlocksDoc } | null>(null);
  useEffect(() => {
    const current = safeRef.current[lang];
    if (lastSyncRef.current?.lang !== lang || lastSyncRef.current.doc !== current) {
      history.reset(current);
      lastSyncRef.current = { lang, doc: current };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, safe.pl, safe.en]);

  // Propagate history.doc upstream whenever the user actually edits.
  // Guard against propagating the previous language's doc right after a
  // lang switch (history.reset is asynchronous, so history.doc briefly
  // still points at the old language's content during the next render).
  // Recording the propagated doc in lastSyncRef marks the upcoming parent
  // echo as "already seen" for the reset effect above.
  useEffect(() => {
    const current = safeRef.current[lang];
    const lastSynced = lastSyncRef.current;
    if (!lastSynced || lastSynced.lang !== lang) return;
    if (history.doc === current) return;
    lastSyncRef.current = { lang, doc: history.doc };
    onChangeRef.current({ ...safeRef.current, [lang]: history.doc });
  }, [history.doc, lang]);

  return { lang, setLang, history, safe };
}
