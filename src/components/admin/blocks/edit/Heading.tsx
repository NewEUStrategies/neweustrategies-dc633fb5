import type { Block } from "@/lib/blocks/types";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function HeadingBlock({ block, onChange }: Props) {
  const level = Number(block.data.level ?? 2);
  const text = String(block.data.text ?? "");
  const sizeClass = level === 2 ? "text-2xl" : level === 3 ? "text-xl" : "text-lg";

  return (
    <input
      type="text"
      value={text}
      placeholder={`Nagłówek H${level}…`}
      onChange={(e) => onChange({ ...block, data: { ...block.data, text: e.target.value } })}
      className={`w-full bg-transparent font-bold border-none outline-none focus:ring-0 p-0 ${sizeClass}`}
    />
  );
}
