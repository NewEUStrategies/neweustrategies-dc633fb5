import type { Block } from "@/lib/blocks/types";
import { Textarea } from "@/components/ui/textarea";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import { readText } from "./dataVizShared";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function DetailsBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const summary = readText(block.data.summary);
  const body = readText(block.data.body);
  return (
    <details open className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
      <summary className="cursor-pointer outline-none">
        <input
          type="text"
          value={summary}
          placeholder={i18n.editor("details", "summaryPh")}
          // Klik w pole wewnątrz `<summary>` uruchamia AKTYWACJĘ summary
          // (zwinięcie `<details>`) - tę zatrzymuje wyłącznie `preventDefault`,
          // nie `stopPropagation` (React deleguje zdarzenie z korzenia, a
          // aktywacja i tak biegnie po przejściu zdarzenia). Bez tego każdy
          // klik w tytuł chował edytowaną treść; tekstowemu polu fokus i
          // karetkę daje `mousedown`, więc nic poza zwijaniem nie ginie.
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onChange={(e) => onChange({ ...block, data: { ...block.data, summary: e.target.value } })}
          className="bg-transparent font-medium text-sm border-none outline-none w-[calc(100%-2rem)] ml-1"
        />
      </summary>
      <Textarea
        value={body}
        placeholder={i18n.editor("details", "contentPh")}
        rows={4}
        onChange={(e) => onChange({ ...block, data: { ...block.data, body: e.target.value } })}
        className="mt-2"
      />
    </details>
  );
}
