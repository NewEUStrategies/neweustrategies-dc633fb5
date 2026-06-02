// Główny edytor wpisów w stylu Gutenberg / Foxiz.
// - history (undo/redo) z debouncem
// - skróty klawiszowe Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z
// - dwie zakładki językowe (PL/EN) z izolowanymi stosami historii
// - sidebar po prawej z zakładkami Blok / Dokument

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Block, BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { EMPTY_BLOCKS_DOC } from "@/lib/blocks/types";
import { BlockCanvas } from "./BlockCanvas";
import { BlockSidebar } from "./BlockSidebar";
import { useBlocksHistory } from "./hooks/useBlocksHistory";
import { IconButton } from "./atoms/IconButton";
import { Undo, Redo } from "@/lib/lucide-shim";

interface Props {
  value: LocalizedBlocks | null;
  onChange: (next: LocalizedBlocks) => void;
  documentPane: React.ReactNode;
}

export function PostBlockEditor({ value, onChange, documentPane }: Props) {
  const { t } = useTranslation();
  const [lang, setLang] = useState<"pl" | "en">("pl");
  const [activeId, setActiveId] = useState<string | null>(null);

  const safe: LocalizedBlocks = {
    pl: value?.pl ?? EMPTY_BLOCKS_DOC,
    en: value?.en ?? EMPTY_BLOCKS_DOC,
  };

  const history = useBlocksHistory(safe[lang]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const safeRef = useRef(safe);
  safeRef.current = safe;

  // Reset history when switching languages or when external value identity changes per-lang.
  const lastSyncRef = useRef<{ lang: "pl" | "en"; doc: BlocksDoc } | null>(null);
  useEffect(() => {
    const current = safeRef.current[lang];
    if (lastSyncRef.current?.lang !== lang || lastSyncRef.current.doc !== current) {
      history.reset(current);
      lastSyncRef.current = { lang, doc: current };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, safe.pl, safe.en]);

  // Propagate history.doc upstream whenever it diverges from the parent value.
  useEffect(() => {
    const current = safeRef.current[lang];
    if (history.doc !== current) {
      onChangeRef.current({ ...safeRef.current, [lang]: history.doc });
    }
  }, [history.doc, lang]);

  // Keyboard: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (or Y), Alt+ArrowUp/Down to move active block.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const inEditable = !!target?.closest('[contenteditable="true"], input, textarea');

      // Alt+Arrow to reorder the active block (works even inside editable text).
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && activeId) {
        const idx = history.doc.blocks.findIndex((b) => b.id === activeId);
        if (idx < 0) return;
        const dir = e.key === "ArrowUp" ? -1 : 1;
        const j = idx + dir;
        if (j < 0 || j >= history.doc.blocks.length) return;
        e.preventDefault();
        const next = [...history.doc.blocks];
        const [moved] = next.splice(idx, 1);
        next.splice(j, 0, moved);
        history.setDoc({ ...history.doc, blocks: next }, true);
        return;
      }

      if (!mod) return;
      if (e.key === "z" || e.key === "Z") {
        if (e.shiftKey) {
          e.preventDefault();
          history.redo();
        } else if (!inEditable) {
          // Inside contenteditable we let TipTap handle its own undo first.
          e.preventDefault();
          history.undo();
        }
      } else if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        history.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history, activeId]);

  const activeBlock: Block | null =
    activeId ? history.doc.blocks.find((b) => b.id === activeId) ?? null : null;

  const updateActive = useCallback((next: Block | null) => {
    if (!next) return;
    history.setDoc({
      ...history.doc,
      blocks: history.doc.blocks.map((b) => (b.id === next.id ? next : b)),
    }, true);
  }, [history]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 min-h-[600px]">
      <div className="bg-background border border-border rounded-lg p-4 lg:p-6">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <Tabs value={lang} onValueChange={(v) => { setLang(v as "pl" | "en"); setActiveId(null); }}>
            <TabsList>
              <TabsTrigger value="pl">🇵🇱 PL</TabsTrigger>
              <TabsTrigger value="en">🇬🇧 EN</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-1 rounded-md border border-border bg-card px-1 py-1">
            <IconButton
              onClick={history.undo}
              disabled={!history.canUndo}
              title={`${t("blocks.actions.undo")} (Ctrl+Z)`}
              aria-label={t("blocks.actions.undo")}
            >
              <Undo className="w-3.5 h-3.5" />
            </IconButton>
            <IconButton
              onClick={history.redo}
              disabled={!history.canRedo}
              title={`${t("blocks.actions.redo")} (Ctrl+Shift+Z)`}
              aria-label={t("blocks.actions.redo")}
            >
              <Redo className="w-3.5 h-3.5" />
            </IconButton>
          </div>
        </div>

        <Tabs value={lang}>
          <TabsContent value={lang} className="mt-0">
            <BlockCanvas
              doc={history.doc}
              activeId={activeId}
              onSelect={setActiveId}
              onChange={(next, immediate) => history.setDoc(next, immediate)}
            />
          </TabsContent>
        </Tabs>
      </div>

      <aside className="bg-card border border-border rounded-lg lg:sticky lg:top-4 self-start max-h-[calc(100vh-2rem)] flex flex-col">
        <BlockSidebar
          doc={history.doc}
          activeBlock={activeBlock}
          onChangeBlock={updateActive}
          documentPane={documentPane}
        />
      </aside>
    </div>
  );
}
