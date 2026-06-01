// Organism: tabbed content block with per-language HTML panels.
import { useState } from "react";
import { sanitizeHtml } from "@/lib/sanitize";

type Lang = "pl" | "en";

export function TabsBlock({ tabs, lang, nodeId }: { tabs: Array<Record<string, string>>; lang: Lang; nodeId: string }) {
  const [active, setActive] = useState(0);
  if (!tabs.length) return <div className="text-xs text-muted-foreground">Brak zakładek</div>;
  const safe = Math.min(active, tabs.length - 1);
  const cur = tabs[safe];
  return (
    <div role="tablist" aria-label="Tabs" className="space-y-3">
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((t, i) => (
          <button
            key={`${nodeId}-${i}`}
            role="tab"
            aria-selected={i === safe}
            type="button"
            onClick={() => setActive(i)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              i === safe ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t[`label_${lang}`] || t.label_pl}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="prose prose-sm max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(cur[`html_${lang}`] || cur.html_pl || "") }} />
    </div>
  );
}
