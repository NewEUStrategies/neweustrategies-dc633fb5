import type { Block } from "@/lib/blocks/types";
import { AlertTriangle, Info, CheckCircle2, OctagonAlert } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";

type Variant = "info" | "warning" | "success" | "danger";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

const CALLOUT_STYLES: Record<Variant, { cls: string; Icon: typeof Info }> = {
  info:    { cls: "bg-muted border-border text-foreground", Icon: Info },
  warning: { cls: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300", Icon: AlertTriangle },
  success: { cls: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300", Icon: CheckCircle2 },
  danger:  { cls: "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300", Icon: OctagonAlert },
};

export function CalloutBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const variant = (String(block.data.variant ?? "info") as Variant);
  const text = String(block.data.text ?? "");
  const { cls, Icon } = CALLOUT_STYLES[variant] ?? CALLOUT_STYLES.info;

  return (
    <div className={`rounded-md border px-3 py-2 flex gap-2 ${cls}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <textarea
        value={text}
        onChange={(e) => onChange({ ...block, data: { ...block.data, text: e.target.value } })}
        placeholder={i18n.editor("callout","textPh")}
        className="flex-1 bg-transparent outline-none border-none resize-none text-sm min-h-[1.5em]"
        rows={Math.max(1, text.split("\n").length)}
      />
    </div>
  );
}
