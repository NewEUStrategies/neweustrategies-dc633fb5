import type { Block } from "@/lib/blocks/types";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function ButtonBlock({ block, onChange }: Props) {
  const label = String(block.data.label ?? "");
  const variant = String(block.data.variant ?? "default");
  const cls =
    variant === "outline"
      ? "border border-foreground text-foreground hover:bg-foreground/10"
      : variant === "ghost"
        ? "text-foreground hover:bg-foreground/10"
        : "bg-foreground text-background hover:bg-foreground/90";

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center px-4 py-2 rounded-md text-sm font-medium ${cls}`}>
        <input
          type="text"
          value={label}
          onChange={(e) => onChange({ ...block, data: { ...block.data, label: e.target.value } })}
          placeholder="Etykieta…"
          className="bg-transparent outline-none border-none p-0 placeholder:opacity-60 min-w-[6ch]"
          style={{ width: `${Math.max(label.length, 8)}ch` }}
        />
      </span>
      <span className="text-xs text-muted-foreground">- link i wariant w panelu po prawej</span>
    </div>
  );
}
