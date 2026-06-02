import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { BLOCK_SPECS } from "@/lib/blocks/registry";

interface Props {
  doc: BlocksDoc;
  activeBlock: Block | null;
  onChangeBlock: (next: Block) => void;
  documentPane: React.ReactNode;
}

export function BlockSidebar({ activeBlock, onChangeBlock, documentPane }: Props) {
  const [tab, setTab] = useState<"block" | "document">("document");

  // Auto-switch to "block" when a block is selected
  const effectiveTab = activeBlock ? tab : "document";

  return (
    <Tabs value={effectiveTab} onValueChange={(v) => setTab(v as "block" | "document")} className="h-full flex flex-col">
      <TabsList className="grid grid-cols-2 m-3 mb-0">
        <TabsTrigger value="block" disabled={!activeBlock}>Blok</TabsTrigger>
        <TabsTrigger value="document">Dokument</TabsTrigger>
      </TabsList>

      <TabsContent value="block" className="flex-1 overflow-y-auto p-3 space-y-3 mt-0">
        {activeBlock ? <BlockSettings block={activeBlock} onChange={onChangeBlock} /> : (
          <p className="text-xs text-muted-foreground italic">Wybierz blok, aby zobaczyć ustawienia.</p>
        )}
      </TabsContent>

      <TabsContent value="document" className="flex-1 overflow-y-auto p-3 space-y-3 mt-0">
        {documentPane}
      </TabsContent>
    </Tabs>
  );
}

function BlockSettings({ block, onChange }: { block: Block; onChange: (n: Block) => void }) {
  const spec = BLOCK_SPECS[block.type];
  const Icon = spec.icon;

  const set = (key: string, value: unknown) => {
    onChange({ ...block, data: { ...block.data, [key]: value as never } });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-semibold">{spec.label}</h3>
          <p className="text-[10px] text-muted-foreground">{spec.description}</p>
        </div>
      </div>

      {/* Per-type fields */}
      {block.type === "heading" && (
        <>
          <div>
            <Label className="text-xs">Poziom</Label>
            <Select value={String(block.data.level ?? 2)} onValueChange={(v) => set("level", Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2">H2</SelectItem>
                <SelectItem value="3">H3</SelectItem>
                <SelectItem value="4">H4</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Anchor (id)</Label>
            <Input value={String(block.data.anchor ?? "")} onChange={(e) => set("anchor", e.target.value)} placeholder="moj-naglowek" />
          </div>
        </>
      )}

      {block.type === "image" && (
        <>
          <div>
            <Label className="text-xs">URL obrazu</Label>
            <Input value={String(block.data.url ?? "")} onChange={(e) => set("url", e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <Label className="text-xs">Alt</Label>
            <Input value={String(block.data.alt ?? "")} onChange={(e) => set("alt", e.target.value)} placeholder="Opis obrazu" />
          </div>
          <div>
            <Label className="text-xs">Link (opcjonalnie)</Label>
            <Input value={String(block.data.href ?? "")} onChange={(e) => set("href", e.target.value)} placeholder="https://…" />
          </div>
        </>
      )}

      {block.type === "list" && (
        <div>
          <Label className="text-xs">Typ listy</Label>
          <Select value={block.data.ordered ? "ordered" : "unordered"} onValueChange={(v) => set("ordered", v === "ordered")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unordered">Punktowana</SelectItem>
              <SelectItem value="ordered">Numerowana</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {block.type === "quote" && (
        <div>
          <Label className="text-xs">Cytowany (cite)</Label>
          <Input value={String(block.data.cite ?? "")} onChange={(e) => set("cite", e.target.value)} placeholder="np. Jan Kowalski" />
        </div>
      )}

      {/* Common style */}
      <div className="pt-2 border-t border-border">
        <Label className="text-xs">Wyrównanie</Label>
        <Select value={block.style?.align ?? "left"} onValueChange={(v) => onChange({ ...block, style: { ...block.style, align: v as "left" } })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="left">Do lewej</SelectItem>
            <SelectItem value="center">Wyśrodkuj</SelectItem>
            <SelectItem value="right">Do prawej</SelectItem>
            <SelectItem value="wide">Szerokie</SelectItem>
            <SelectItem value="full">Pełna szerokość</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
