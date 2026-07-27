import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block } from "@/lib/blocks/types";
import { HeadingWidgetToolbar } from "../HeadingWidgetToolbar";

interface Props {
  block: Block;
  isActive?: boolean;
  onChange: (next: Block) => void;
}

export function HeadingBlock({ block, isActive, onChange }: Props) {
  const bt = useBlocksI18n();
  const level = Number(block.data.level ?? 2);
  const text = String(block.data.text ?? "");
  const align = String(block.data.align ?? "left");
  const sizeClass =
    level === 1
      ? "text-3xl"
      : level === 2
        ? "text-2xl"
        : level === 3
          ? "text-xl"
          : "text-lg";
  const alignClass =
    align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";

  return (
    <div className="relative">
      {isActive && <HeadingWidgetToolbar block={block} onChange={onChange} />}
      <input
        type="text"
        value={text}
        placeholder={bt.editor("heading", "placeholder", { level })}
        onChange={(e) => onChange({ ...block, data: { ...block.data, text: e.target.value } })}
        className={`w-full bg-transparent font-bold border-none outline-none focus:ring-0 p-0 ${sizeClass} ${alignClass}`}
      />
    </div>
  );
}
