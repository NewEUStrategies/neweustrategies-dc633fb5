import type { Block } from "@/lib/blocks/types";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function SeparatorBlock({ block }: Props) {
  const variant = String(block.data.variant ?? "line");
  if (variant === "dots") {
    return (
      <div className="text-center text-2xl tracking-[0.5em] text-muted-foreground py-3 select-none">
        ···
      </div>
    );
  }
  if (variant === "wide") {
    return (
      <hr className="border-0 h-px bg-gradient-to-r from-transparent via-border to-transparent my-4" />
    );
  }
  return <hr className="border-border my-4" />;
}
