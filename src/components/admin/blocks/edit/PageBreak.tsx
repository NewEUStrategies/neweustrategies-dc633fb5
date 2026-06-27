export function PageBreakBlock() {
  return (
    <div className="flex items-center gap-3 py-2 select-none">
      <div className="flex-1 border-t-2 border-dashed border-border" />
      <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Podział strony</span>
      <div className="flex-1 border-t-2 border-dashed border-border" />
    </div>
  );
}
