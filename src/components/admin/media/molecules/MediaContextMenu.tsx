import { cn } from "@/lib/utils";
import type { ContextMenuItem } from "../types";

interface MediaContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Molecule: the right-click menu. Clamps itself to the viewport so it never
 * spills off-screen, and closes after an item fires.
 */
export function MediaContextMenu({ x, y, items, onClose }: MediaContextMenuProps) {
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - items.length * 32 - 8),
  };
  return (
    <div
      role="menu"
      className="fixed z-[100] min-w-[200px] bg-popover text-popover-foreground border border-border rounded-md shadow-lg py-1 text-xs"
      style={style}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((it, i) => {
        if (it.separator) return <div key={i} className="h-px bg-border my-1" />;
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              it.onSelect?.();
              onClose();
            }}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed",
              it.danger && "text-destructive",
            )}
          >
            {it.icon ?? <span className="w-3.5 h-3.5" />}
            <span className="flex-1">{it.label}</span>
            {it.shortcut && (
              <span className="text-muted-foreground text-[10px]">{it.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
