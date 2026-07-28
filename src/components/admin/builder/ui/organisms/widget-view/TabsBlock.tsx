// Organism: tabbed content block with per-language HTML panels.
import { useState } from "react";
import { sanitizeHtml } from "@/lib/sanitize";

type Lang = "pl" | "en";
type Orientation = "horizontal" | "vertical";

export function TabsBlock({
  tabs,
  lang,
  nodeId,
  orientation = "horizontal",
}: {
  tabs: Array<Record<string, string>>;
  lang: Lang;
  nodeId: string;
  orientation?: Orientation;
}) {
  const [active, setActive] = useState(0);
  if (!tabs.length)
    return (
      <div className="cms-meta">
        {lang === "pl" ? "Brak zakładek" : "No tabs"}
      </div>
    );
  const safe = Math.min(active, tabs.length - 1);
  const cur = tabs[safe];

  const panel = (
    <div
      role="tabpanel"
      className="prose prose-sm max-w-none [&_*]:text-inherit"
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(cur[`html_${lang}`] || cur.html_pl || "") }}
    />
  );

  if (orientation === "vertical") {
    return (
      <div
        role="tablist"
        aria-label="Tabs"
        aria-orientation="vertical"
        className="flex flex-col gap-4 md:flex-row md:gap-6"
      >
        <div className="flex flex-row overflow-x-auto md:w-56 md:shrink-0 md:flex-col md:overflow-visible md:border-r md:border-border">
          {tabs.map((t, i) => (
            <button
              key={`${nodeId}-${i}`}
              role="tab"
              aria-selected={i === safe}
              type="button"
              onClick={() => setActive(i)}
              className={`px-4 py-2 text-sm font-medium transition text-left md:border-r-2 md:-mr-px border-b-2 md:border-b-0 ${
                i === safe
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t[`label_${lang}`] || t.label_pl}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-0">{panel}</div>
      </div>
    );
  }

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
              i === safe
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t[`label_${lang}`] || t.label_pl}
          </button>
        ))}
      </div>
      {panel}
    </div>
  );
}
