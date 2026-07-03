import { toJson } from "@/lib/builder/types";
import type { Block } from "@/lib/blocks/types";
import { newBlockId } from "@/lib/blocks/types";
import { Plus } from "lucide-react";
import { ParagraphBlock } from "./Paragraph";
import { HeadingBlock } from "./Heading";
import { ImageBlock } from "./Image";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

type Side = "left" | "right";

function readSide(block: Block, side: Side): Block[] {
  const raw = block.data[side];
  if (!Array.isArray(raw)) return [];
  return (raw as unknown as Block[]).filter((b) => b && typeof b === "object" && "type" in b);
}

export function ColumnsBlock({ block, onChange }: Props) {
  const left = readSide(block, "left");
  const right = readSide(block, "right");

  const setSide = (side: Side, next: Block[]) => {
    onChange({ ...block, data: { ...block.data, [side]: toJson(next) } });
  };

  const updateInSide = (side: Side, id: string, next: Block) => {
    const arr = side === "left" ? left : right;
    setSide(
      side,
      arr.map((b) => (b.id === id ? next : b)),
    );
  };

  const addParagraph = (side: Side) => {
    const arr = side === "left" ? left : right;
    setSide(side, [...arr, { id: newBlockId(), type: "paragraph", data: { html: "" } }]);
  };

  const Cell = ({ side, items }: { side: Side; items: Block[] }) => (
    <div className="rounded-md border border-dashed border-border p-2 space-y-2 min-h-[80px]">
      {items.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">Pusta kolumna</p>
      )}
      {items.map((b) => (
        <div key={b.id} className="rounded border border-border p-2">
          <InnerBlock block={b} onChange={(n) => updateInSide(side, b.id, n)} />
        </div>
      ))}
      <button
        type="button"
        onClick={() => addParagraph(side)}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        <Plus className="w-3 h-3" /> Dodaj akapit
      </button>
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <Cell side="left" items={left} />
      <Cell side="right" items={right} />
    </div>
  );
}

function InnerBlock({ block, onChange }: { block: Block; onChange: (n: Block) => void }) {
  switch (block.type) {
    case "paragraph":
      return <ParagraphBlock block={block} isActive={true} onChange={onChange} />;
    case "heading":
      return <HeadingBlock block={block} onChange={onChange} />;
    case "image":
      return <ImageBlock block={block} onChange={onChange} />;
    default:
      return <div className="text-xs text-muted-foreground italic">[{block.type}]</div>;
  }
}
