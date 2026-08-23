import type { Block } from "@/lib/blocks/types";
import { useRef } from "react";
import { InlineHtmlEditable } from "../atoms/InlineHtmlEditable";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

/** Poziomy zagnieżdżenia (1-based) dopasowane długością do listy pozycji. */
function readLevels(block: Block, count: number): number[] {
  const raw = Array.isArray(block.data.levels) ? block.data.levels : [];
  return Array.from({ length: count }, (_, i) =>
    typeof raw[i] === "number" ? Math.max(1, Math.min(6, raw[i])) : 1,
  );
}

export function ListBlockEdit({ block, onChange }: Props) {
  const items = Array.isArray(block.data.items) ? (block.data.items as string[]) : [""];
  const ordered = Boolean(block.data.ordered);
  const levels = readLevels(block, items.length);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  const commit = (nextItems: string[], nextLevels: number[]) => {
    const data: Record<string, typeof block.data.items> = { ...block.data, items: nextItems };
    if (nextLevels.some((l) => l > 1)) data.levels = nextLevels;
    else delete data.levels;
    onChange({ ...block, data });
  };

  const update = (idx: number, value: string) => {
    const next = [...items];
    next[idx] = value;
    commit(next, levels);
  };

  const setLevel = (idx: number, delta: number) => {
    const next = [...levels];
    const max = idx === 0 ? 1 : Math.min(6, (levels[idx - 1] ?? 1) + 1);
    next[idx] = Math.max(1, Math.min(max, (levels[idx] ?? 1) + delta));
    commit(items, next);
  };

  const onKeyDown = (idx: number, e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      setLevel(idx, e.shiftKey ? -1 : 1);
    } else if (e.key === "Enter" && e.shiftKey) {
      // Miękki enter: łamanie wiersza WEWNĄTRZ pozycji listy (parytet z Word/WP)
      // - nie tworzy nowego punktu wypunktowania.
      e.preventDefault();
      document.execCommand("insertLineBreak");
      const el = refs.current[idx];
      if (el) update(idx, el.innerHTML);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const nextItems = [...items];
      const nextLevels = [...levels];
      nextItems.splice(idx + 1, 0, "");
      nextLevels.splice(idx + 1, 0, levels[idx] ?? 1);
      commit(nextItems, nextLevels);
      setTimeout(() => refs.current[idx + 1]?.focus(), 0);
    } else if (e.key === "Backspace" && items[idx] === "" && items.length > 1) {
      e.preventDefault();
      commit(
        items.filter((_, i) => i !== idx),
        levels.filter((_, i) => i !== idx),
      );
      setTimeout(() => refs.current[Math.max(idx - 1, 0)]?.focus(), 0);
    }
  };

  const ListTag = ordered ? "ol" : "ul";
  // Numeracja liczona w obrębie poziomu, żeby import wielopoziomowy z Worda
  // zachowywał porządek 1., 1.1., 1.2., 2. …
  const counters: number[] = [];
  const numberFor = (idx: number): number => {
    const level = levels[idx] ?? 1;
    counters.length = level;
    counters[level - 1] = (counters[level - 1] ?? 0) + 1;
    return counters[level - 1];
  };

  return (
    <ListTag
      className={`cms-block-list-editor ${ordered ? "cms-block-list-editor--ordered" : "cms-block-list-editor--unordered"}`}
    >
      {items.map((it, i) => {
        const level = levels[i] ?? 1;
        const n = ordered ? numberFor(i) : 0;
        return (
          <li
            key={i}
            className="cms-block-list-editor__item"
            style={{ "--cms-list-level": level } as React.CSSProperties}
            data-level={level}
          >
            {ordered ? (
              <span className="cms-list-number" aria-hidden="true">
                <span className="cms-list-number-text">{n}</span>
              </span>
            ) : (
              <span className="cms-list-bullet" aria-hidden="true" />
            )}
            <InlineHtmlEditable
              editableRef={(el) => {
                refs.current[i] = el;
              }}
              value={it}
              placeholder="Pozycja listy…"
              data-field="list-item"
              onChange={(html) => update(i, html)}
              onKeyDown={(e) => onKeyDown(i, e)}
              className="cms-list-content flex-1 bg-transparent border-0 p-0 m-0 text-foreground text-base leading-relaxed"
            />
          </li>
        );
      })}
    </ListTag>
  );
}
