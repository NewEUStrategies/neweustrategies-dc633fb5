import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { BlockInserter } from "./BlockInserter";
import { ParagraphBlock } from "./edit/Paragraph";
import { HeadingBlock } from "./edit/Heading";
import { ImageBlock } from "./edit/Image";
import { ListBlockEdit } from "./edit/ListBlock";
import { QuoteBlock } from "./edit/Quote";
import { CodeBlock } from "./edit/Code";
import { EmbedBlock } from "./edit/Embed";
import { VideoBlock } from "./edit/Video";
import { GalleryBlock } from "./edit/Gallery";
import { SeparatorBlock } from "./edit/Separator";
import { CalloutBlock } from "./edit/Callout";
import { TableBlockEdit } from "./edit/Table";
import { ButtonBlock } from "./edit/Button";
import { ColumnsBlock } from "./edit/Columns";
import { HtmlBlock } from "./edit/Html";
import { ChevronUp as ArrowUp, ChevronDown as ArrowDown, Copy, Trash2 } from "@/lib/lucide-shim";

interface Props {
  doc: BlocksDoc;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (doc: BlocksDoc) => void;
}

export function BlockCanvas({ doc, activeId, onSelect, onChange }: Props) {
  const blocks = doc.blocks;

  const insertAt = (idx: number, block: Block) => {
    const next = [...blocks];
    next.splice(idx, 0, block);
    onChange({ ...doc, blocks: next });
    onSelect(block.id);
  };

  const updateBlock = (id: string, next: Block) => {
    onChange({ ...doc, blocks: blocks.map((b) => (b.id === id ? next : b)) });
  };

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange({ ...doc, blocks: next });
  };

  const duplicate = (idx: number) => {
    const orig = blocks[idx];
    const copy: Block = { ...orig, id: "b_" + Math.random().toString(36).slice(2, 10) };
    const next = [...blocks];
    next.splice(idx + 1, 0, copy);
    onChange({ ...doc, blocks: next });
  };

  const remove = (idx: number) => {
    const next = blocks.filter((_, i) => i !== idx);
    onChange({ ...doc, blocks: next });
    if (activeId === blocks[idx]?.id) onSelect(null);
  };

  if (blocks.length === 0) {
    return (
      <div className="py-12">
        <BlockInserter variant="fab" onInsert={(b) => insertAt(0, b)} />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <BlockInserter onInsert={(b) => insertAt(0, b)} />
      {blocks.map((b, idx) => {
        const isActive = b.id === activeId;
        return (
          <div key={b.id}>
            <div
              onClick={() => onSelect(b.id)}
              className={`group relative rounded-md px-3 py-2 border ${
                isActive ? "border-primary ring-1 ring-primary/40 bg-accent/30" : "border-transparent hover:border-border"
              }`}
            >
              {isActive && (
                <div className="absolute -right-1 top-0 -translate-y-full pb-1 flex items-center gap-0.5 z-10">
                  <button type="button" onClick={(e) => { e.stopPropagation(); move(idx, -1); }} className="p-1 rounded bg-popover border border-border hover:bg-accent" title="W górę">
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); move(idx, 1); }} className="p-1 rounded bg-popover border border-border hover:bg-accent" title="W dół">
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); duplicate(idx); }} className="p-1 rounded bg-popover border border-border hover:bg-accent" title="Duplikuj">
                    <Copy className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); remove(idx); }} className="p-1 rounded bg-popover border border-border hover:bg-destructive hover:text-destructive-foreground" title="Usuń">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
              <BlockRenderer block={b} isActive={isActive} onChange={(n) => updateBlock(b.id, n)} />
            </div>
            <BlockInserter onInsert={(blk) => insertAt(idx + 1, blk)} />
          </div>
        );
      })}
    </div>
  );
}

function BlockRenderer({ block, isActive, onChange }: { block: Block; isActive: boolean; onChange: (n: Block) => void }) {
  switch (block.type) {
    case "paragraph": return <ParagraphBlock block={block} isActive={isActive} onChange={onChange} />;
    case "heading":   return <HeadingBlock block={block} onChange={onChange} />;
    case "image":     return <ImageBlock block={block} onChange={onChange} />;
    case "list":      return <ListBlockEdit block={block} onChange={onChange} />;
    case "quote":     return <QuoteBlock block={block} onChange={onChange} />;
    default:
      return (
        <div className="text-xs text-muted-foreground italic py-2">
          [Blok „{block.type}" — edytor wkrótce]
        </div>
      );
  }
}
