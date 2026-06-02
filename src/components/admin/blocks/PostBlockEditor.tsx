// Główny edytor wpisów w stylu Gutenberg / Foxiz.
// Lewa kolumna: zakładki języków + kanwa bloków.
// Prawa kolumna: sidebar z zakładkami Blok / Dokument.

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { EMPTY_BLOCKS_DOC } from "@/lib/blocks/types";
import { BlockCanvas } from "./BlockCanvas";
import { BlockSidebar } from "./BlockSidebar";

interface Props {
  value: LocalizedBlocks | null;
  onChange: (next: LocalizedBlocks) => void;
  documentPane: React.ReactNode;
}

export function PostBlockEditor({ value, onChange, documentPane }: Props) {
  const [lang, setLang] = useState<"pl" | "en">("pl");
  const [activeId, setActiveId] = useState<string | null>(null);

  const safe: LocalizedBlocks = {
    pl: value?.pl ?? EMPTY_BLOCKS_DOC,
    en: value?.en ?? EMPTY_BLOCKS_DOC,
  };
  const doc: BlocksDoc = safe[lang];

  const setDoc = (next: BlocksDoc) => {
    onChange({ ...safe, [lang]: next });
  };

  const activeBlock = activeId ? doc.blocks.find((b) => b.id === activeId) ?? null : null;

  const updateActive = (next: typeof activeBlock) => {
    if (!next) return;
    setDoc({ ...doc, blocks: doc.blocks.map((b) => (b.id === next.id ? next : b)) });
  };

  return (
    <div className="grid grid-cols-[1fr_320px] gap-4 min-h-[600px]">
      {/* Kanwa */}
      <div className="bg-background border border-border rounded-lg p-6">
        <Tabs value={lang} onValueChange={(v) => { setLang(v as "pl" | "en"); setActiveId(null); }}>
          <TabsList className="mb-4">
            <TabsTrigger value="pl">🇵🇱 Polski</TabsTrigger>
            <TabsTrigger value="en">🇬🇧 English</TabsTrigger>
          </TabsList>
          <TabsContent value={lang} className="mt-0">
            <BlockCanvas
              doc={doc}
              activeId={activeId}
              onSelect={setActiveId}
              onChange={setDoc}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Sidebar */}
      <aside className="bg-card border border-border rounded-lg sticky top-4 self-start max-h-[calc(100vh-2rem)] flex flex-col">
        <BlockSidebar
          doc={doc}
          activeBlock={activeBlock}
          onChangeBlock={updateActive}
          documentPane={documentPane}
        />
      </aside>
    </div>
  );
}
