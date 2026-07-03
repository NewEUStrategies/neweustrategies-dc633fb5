import { useBlocksI18n } from "@/lib/blocks/i18n";
export function PageBreakBlock() {
  const i18n = useBlocksI18n();
  return (
    <div className="flex items-center gap-3 py-2 select-none">
      <div className="flex-1 border-t-2 border-dashed border-border" />
      <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        {i18n.editor("pageBreak", "label")}
      </span>
      <div className="flex-1 border-t-2 border-dashed border-border" />
    </div>
  );
}
