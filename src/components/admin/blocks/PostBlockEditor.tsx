// Główny edytor wpisów w stylu Gutenberg / Foxiz.
// - history (undo/redo) z debouncem
// - skróty klawiszowe Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z
// - dwie zakładki językowe (PL/EN) z izolowanymi stosami historii
// - sidebar po prawej z zakładkami Blok / Dokument

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Block, LocalizedBlocks } from "@/lib/blocks/types";
import { BlockCanvas } from "./BlockCanvas";
import { BlockSidebar } from "./BlockSidebar";
import { useLocalizedBlocksHistory } from "./hooks/useLocalizedBlocksHistory";
import { IconButton } from "./atoms/IconButton";
import { Undo, Redo, PanelLeft } from "@/lib/lucide-shim";
import { useOnboardingTour } from "@/lib/onboarding/useOnboardingTour";
import { CoachmarkTour } from "@/components/admin/onboarding/CoachmarkTour";
import { BLOCK_TOUR_STEPS } from "@/lib/onboarding/tours";

interface Props {
  value: LocalizedBlocks | null;
  onChange: (next: LocalizedBlocks) => void;
  documentPane: React.ReactNode;
  /** Owija kanwę bloków (np. wireframem layoutu wpisu). Otrzymuje aktywny język. */
  canvasWrap?: (canvas: React.ReactNode, lang: "pl" | "en") => React.ReactNode;
}

export function PostBlockEditor({ value, onChange, documentPane, canvasWrap }: Props) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Per-language undo/redo with parent-echo protection (dead-undo fix) -
  // see useLocalizedBlocksHistory for the sync contract.
  const { lang, setLang, history } = useLocalizedBlocksHistory(value, onChange);

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

  const activeBlock: Block | null = activeId
    ? (history.doc.blocks.find((b) => b.id === activeId) ?? null)
    : null;

  const updateActive = useCallback(
    (next: Block | null) => {
      if (!next) return;
      history.setDoc(
        {
          ...history.doc,
          blocks: history.doc.blocks.map((b) => (b.id === next.id ? next : b)),
        },
        true,
      );
    },
    [history],
  );

  const tour = useOnboardingTour({ id: "blocks", steps: BLOCK_TOUR_STEPS });

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 min-h-[600px]",
        sidebarCollapsed ? "lg:grid-cols-[1fr_48px]" : "lg:grid-cols-[1fr_320px]",
      )}
    >
      <CoachmarkTour controller={tour} />
      <div
        data-tour="blocks-canvas"
        className="bg-background border border-border rounded-lg p-4 lg:p-6"
      >
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <Tabs
            value={lang}
            onValueChange={(v) => {
              setLang(v as "pl" | "en");
              setActiveId(null);
            }}
          >
            <TabsList data-tour="blocks-lang">
              <TabsTrigger value="pl">🇵🇱 PL</TabsTrigger>
              <TabsTrigger value="en">🇬🇧 EN</TabsTrigger>
            </TabsList>
          </Tabs>
          <div
            data-tour="blocks-history"
            className="flex items-center gap-1 rounded-md border border-border bg-card px-1 py-1"
          >
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
            {(() => {
              const canvas = (
                <BlockCanvas
                  doc={history.doc}
                  activeId={activeId}
                  onSelect={setActiveId}
                  onChange={(next, immediate) => history.setDoc(next, immediate)}
                />
              );
              return canvasWrap ? canvasWrap(canvas, lang) : canvas;
            })()}
          </TabsContent>
        </Tabs>
      </div>

      <aside
        data-tour="blocks-sidebar"
        className={cn(
          "bg-card border border-border rounded-lg lg:sticky lg:top-4 self-start max-h-[80vh] lg:max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden transition-all duration-300",
          sidebarCollapsed ? "w-12" : "w-full",
        )}
      >
        <BlockSidebar
          doc={history.doc}
          activeBlock={activeBlock}
          activeId={activeId}
          onSelect={setActiveId}
          onChangeBlock={updateActive}
          documentPane={documentPane}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />
      </aside>
    </div>
  );
}
