import type { Block } from "@/lib/blocks/types";
import { useRef } from "react";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function ListBlockEdit({ block, onChange }: Props) {
  const items = Array.isArray(block.data.items) ? (block.data.items as string[]) : [""];
  const ordered = Boolean(block.data.ordered);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const update = (idx: number, value: string) => {
    const next = [...items];
    next[idx] = value;
    onChange({ ...block, data: { ...block.data, items: next } });
  };

  const onKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const next = [...items];
      next.splice(idx + 1, 0, "");
      onChange({ ...block, data: { ...block.data, items: next } });
      setTimeout(() => refs.current[idx + 1]?.focus(), 0);
    } else if (e.key === "Backspace" && items[idx] === "" && items.length > 1) {
      e.preventDefault();
      const next = items.filter((_, i) => i !== idx);
      onChange({ ...block, data: { ...block.data, items: next } });
      setTimeout(() => refs.current[Math.max(idx - 1, 0)]?.focus(), 0);
    }
  };

  const ListTag = ordered ? "ol" : "ul";
  const marker = ordered
    ? (i: number) => <span className="w-6 text-right tabular-nums text-foreground">{i + 1}.</span>
    : () => <span className="w-6 text-center text-foreground">•</span>;

  return (
    <ListTag className="list-none pl-0 m-0 p-0 text-foreground text-base leading-relaxed">
      {items.map((it, i) => (
        <li key={i} className="flex items-baseline gap-2 m-0 p-0">
          {marker(i)}
          <input
            ref={(el) => { refs.current[i] = el; }}
            type="text"
            value={it}
            placeholder="Pozycja listy…"
            onChange={(e) => update(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            className="flex-1 bg-transparent border-0 outline-none focus:ring-0 p-0 m-0 text-foreground text-base leading-relaxed"
          />
        </li>
      ))}
    </ListTag>
  );
}
