// Organism: tabbed content block with per-language HTML panels.
// Zakładki wspierają opcjonalną ikonę (Lucide, nazwa kebab-case) oraz
// pogrubione etykiety. Ikona renderowana przez DynamicIcon (tree-shakable).
//
// Dostępność - wzorzec WAI-ARIA „Tabs" (od 2026-10-18): `role="tablist"` ma
// sam wiersz zakładek (wcześniej opakowanie z panelem w środku), zakładka
// wskazuje panel przez `aria-controls`, panel nazywa się etykietą zakładki
// (`aria-labelledby`), w kolejności Tab jest tylko aktywna zakładka (roving
// tabindex), a strzałki (poziomo Lewo/Prawo, pionowo Góra/Dół) z Home/End
// przenoszą fokus i wybór. ID z `useId` są takie same w SSR i po hydratacji.
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { sanitizeHtml } from "@/lib/sanitize";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";

type Lang = "pl" | "en";
type Orientation = "horizontal" | "vertical";
export type TabAlign = "left" | "center" | "right" | "justify";

function TabLabel({ tab, lang }: { tab: Record<string, string>; lang: Lang }) {
  const icon = typeof tab.icon === "string" ? tab.icon.trim() : "";
  const label = tab[`label_${lang}`] || tab.label_pl || "";
  // Mobile: ikona wycentrowana nad etykietą (kolumna), desktop: ikona obok.
  // min-w-0 + overflow-wrap pozwalają długiej etykiecie złamać wiersz zamiast
  // zostać przyciętą przy wąskim ekranie.
  return (
    <span className="flex w-full min-w-0 flex-col items-center justify-center gap-1 text-center font-bold leading-tight sm:w-auto sm:flex-row sm:gap-2 sm:text-left">
      {icon ? (
        <span className="flex w-full shrink-0 justify-center sm:w-auto" aria-hidden={true}>
          <DynamicIcon name={icon} size={16} aria-hidden={true} />
        </span>
      ) : null}
      <span className="min-w-0 max-w-full [overflow-wrap:anywhere]">{label}</span>
    </span>
  );
}

const ALIGN_JUSTIFY: Record<TabAlign, string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
  justify: "justify-between",
};

// Klawisze nawigacji per orientacja: krok -1/+1 albo skok na brzeg.
const NAV_KEYS: Record<Orientation, Record<string, "prev" | "next">> = {
  horizontal: { ArrowLeft: "prev", ArrowRight: "next" },
  vertical: { ArrowUp: "prev", ArrowDown: "next" },
};

export function TabsBlock({
  tabs: rawTabs,
  lang,
  nodeId,
  orientation = "horizontal",
  tabAlign = "left",
}: {
  tabs: Array<Record<string, string>>;
  lang: Lang;
  nodeId: string;
  orientation?: Orientation;
  tabAlign?: TabAlign;
}) {
  const [active, setActive] = useState(0);
  const idBase = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Wpis `null`/nie-obiekt (import, ręczna edycja JSON) wywracał render
  // (`tab.icon` z null) - pomijamy go, reszta zakładek działa.
  const tabs = rawTabs.filter(
    (t): t is Record<string, string> => typeof t === "object" && t !== null,
  );
  if (!tabs.length)
    return <div className="cms-meta">{lang === "pl" ? "Brak zakładek" : "No tabs"}</div>;
  const safe = Math.min(active, tabs.length - 1);
  const cur = tabs[safe];
  const tabId = (i: number) => `${idBase}-tab-${i}`;
  const panelId = `${idBase}-panel`;

  const select = (i: number) => {
    setActive(i);
    tabRefs.current[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = tabs.length - 1;
    const dir = NAV_KEYS[orientation][e.key];
    let next: number | null = null;
    if (dir === "next") next = safe >= last ? 0 : safe + 1;
    else if (dir === "prev") next = safe <= 0 ? last : safe - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    select(next);
  };
  // Wspólne atrybuty zakładki - ten sam kontrakt w obu orientacjach.
  const tabProps = (i: number) => ({
    id: tabId(i),
    role: "tab" as const,
    "aria-selected": i === safe,
    "aria-controls": panelId,
    tabIndex: i === safe ? 0 : -1,
    type: "button" as const,
    onClick: () => setActive(i),
    onKeyDown,
    ref: (el: HTMLButtonElement | null) => {
      tabRefs.current[i] = el;
    },
  });
  const listLabel = lang === "pl" ? "Zakładki" : "Tabs";

  // min-w-0 + overflow-wrap: treść panelu łamie wiersze zamiast wystawać
  // poza ekran na mobile (żadnego poziomego przycinania tekstu).
  const panel = (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={tabId(safe)}
      tabIndex={0}
      className="prose prose-sm w-full max-w-full min-w-0 overflow-x-auto break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_*]:text-inherit [&_iframe]:w-full [&_img]:h-auto"
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(cur[`html_${lang}`] || cur.html_pl || "") }}
    />
  );

  if (orientation === "vertical") {
    // Alignment applies only to horizontal tab rows - pionowa lista zawsze
    // wyrównana do lewej dla czytelnosci.
    return (
      <div className="flex w-full min-w-0 max-w-full flex-col gap-4 md:flex-row md:gap-6">
        <div
          role="tablist"
          aria-label={listLabel}
          aria-orientation="vertical"
          className="grid w-full min-w-0 grid-cols-2 gap-1 md:flex md:w-56 md:shrink-0 md:flex-col md:gap-0 md:overflow-visible md:border-r md:border-border"
        >
          {tabs.map((t, i) => (
            <button
              key={`${nodeId}-${i}`}
              {...tabProps(i)}
              className={`w-full min-w-0 px-3 py-2 text-center text-sm font-bold transition md:flex-none md:px-4 md:text-left md:border-r-2 md:-mr-px border-b-2 md:border-b-0 ${
                i === safe
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <TabLabel tab={t} lang={lang} />
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-0">{panel}</div>
      </div>
    );
  }

  const rowJustify = ALIGN_JUSTIFY[tabAlign] ?? ALIGN_JUSTIFY.left;
  const isJustify = tabAlign === "justify";
  // Mobile: stabilna siatka dwóch równych kolumn gwarantuje pełną szerokość
  // każdej zakładki. Od sm wraca ustawiony przez redaktora układ poziomy.
  return (
    <div className="w-full min-w-0 max-w-full space-y-3">
      <div
        role="tablist"
        aria-label={listLabel}
        className={`grid w-full min-w-0 grid-cols-2 gap-1 border-b border-border sm:flex sm:flex-wrap sm:overflow-x-auto ${rowJustify}`}
      >
        {tabs.map((t, i) => (
          <button
            key={`${nodeId}-${i}`}
            {...tabProps(i)}
            className={`w-full min-w-0 px-3 py-2 text-sm font-bold border-b-2 -mb-px transition sm:w-auto sm:basis-auto sm:px-4 ${
              isJustify ? "sm:flex-1 text-center" : "sm:flex-none"
            } ${
              i === safe
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <TabLabel tab={t} lang={lang} />
          </button>
        ))}
      </div>
      {panel}
    </div>
  );
}
