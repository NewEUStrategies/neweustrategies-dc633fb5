// Atom: framed item with title + remove button. Used inside list editors.
export function ItemFrame({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-md p-2 space-y-1.5 bg-background">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-[10px] text-muted-foreground hover:text-destructive"
        >
          Usuń
        </button>
      </div>
      {children}
    </div>
  );
}
