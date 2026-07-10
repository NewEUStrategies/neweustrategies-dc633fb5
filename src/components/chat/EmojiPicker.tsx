// Molecule: emoji picker popover content - category tabs + PL/EN search.
// Dependency-free (curated dataset in @/lib/chat/emoji), matches popover chrome.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { EMOJI_CATEGORIES, searchEmoji, type EmojiEntry } from "@/lib/chat/emoji";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<string, string> = {
  smileys: "😀",
  gestures: "👍",
  hearts: "❤️",
  animals: "🐱",
  food: "🍕",
  activities: "⚽",
  travel: "✈️",
  objects: "💡",
};

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(EMOJI_CATEGORIES[0]?.id ?? "smileys");

  const hits = useMemo(() => (query.trim() ? searchEmoji(query) : null), [query]);
  const active = EMOJI_CATEGORIES.find((c) => c.id === category) ?? EMOJI_CATEGORIES[0];

  const renderGrid = (emojis: ReadonlyArray<EmojiEntry>) => (
    <div className="grid grid-cols-8 gap-0.5 p-2" role="listbox" aria-label={t("chat.emoji")}>
      {emojis.map((entry) => (
        <button
          key={entry.e}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => onPick(entry.e)}
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-lg leading-none hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={entry.k.split(" ").slice(0, 2).join(" ")}
        >
          {entry.e}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex w-[288px] max-w-[calc(100vw-32px)] flex-col">
      <div className="relative border-b border-border/60 p-2">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("chat.emojiSearch")}
          aria-label={t("chat.emojiSearch")}
          className="h-8 w-full rounded-[6px] border border-input bg-background pl-8 pr-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="h-[216px] overflow-y-auto overscroll-contain">
        {hits ? (
          hits.length > 0 ? (
            renderGrid(hits)
          ) : (
            <p className="p-4 text-center text-xs text-muted-foreground">
              {t("chat.emojiNoResults")}
            </p>
          )
        ) : (
          renderGrid(active?.emojis ?? [])
        )}
      </div>

      {!hits && (
        <div
          className="flex items-center justify-between border-t border-border/60 px-1.5 py-1"
          role="tablist"
          aria-label={t("chat.emoji")}
        >
          {EMOJI_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === category}
              aria-label={t(`chat.emojiCategories.${c.id}`)}
              title={t(`chat.emojiCategories.${c.id}`)}
              onClick={() => setCategory(c.id)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-[6px] text-sm leading-none transition-colors",
                c.id === category ? "bg-muted" : "opacity-60 hover:opacity-100 hover:bg-muted/60",
              )}
            >
              {CATEGORY_ICONS[c.id]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
