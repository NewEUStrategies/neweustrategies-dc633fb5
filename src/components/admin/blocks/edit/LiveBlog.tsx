import { Link } from "@tanstack/react-router";
import { Radio } from "lucide-react";
import type { Block } from "@/lib/blocks/types";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

/**
 * In-editor config for a Live Blog block. Previously this block had no editor
 * (it fell through to the generic `[liveblog]` placeholder), so its title and
 * behaviour flags were uneditable and there was no path to entry moderation.
 * Entries themselves are posted/moderated in Admin → Live blog (realtime),
 * reachable from the deep link below.
 */
export function LiveBlogBlock({ block, onChange }: Props) {
  const data = block.data ?? {};
  const title = typeof data.title === "string" ? data.title : "";
  const reverse = data.reverseChronological !== false; // domyślnie najnowsze na górze
  const autoRefresh = data.autoRefresh !== false; // realtime domyślnie włączony

  return (
    <div className="rounded-md border border-border p-3 space-y-3 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Radio className="w-4 h-4 text-red-500" />
        <span className="font-medium">Live Blog</span>
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Tytuł bloku (opcjonalny)</span>
        <input
          type="text"
          value={title}
          onChange={(e) => onChange({ ...block, data: { ...data, title: e.target.value } })}
          placeholder="np. Relacja na żywo"
          className="w-full rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary/40"
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span className="text-xs">Najnowsze wpisy na górze</span>
        <input
          type="checkbox"
          checked={reverse}
          onChange={(e) =>
            onChange({ ...block, data: { ...data, reverseChronological: e.target.checked } })
          }
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span className="text-xs">Aktualizacja na żywo (realtime)</span>
        <input
          type="checkbox"
          checked={autoRefresh}
          onChange={(e) => onChange({ ...block, data: { ...data, autoRefresh: e.target.checked } })}
        />
      </label>

      <div className="pt-1 border-t border-border">
        <Link
          to="/admin/live-blog"
          search={{ blockId: block.id }}
          className="text-xs text-primary hover:underline"
        >
          Moderuj wpisy tego bloku →
        </Link>
        <p className="text-[11px] text-muted-foreground mt-1">
          Wpisy dodajesz i edytujesz w panelu Live blog. Zapisz najpierw ten post, aby blok był
          dostępny do wyboru.
        </p>
      </div>
    </div>
  );
}
