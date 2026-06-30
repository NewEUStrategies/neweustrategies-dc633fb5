// Publiczne renderery dla Phase 4 batch 9:
// accordion, tabs, countdown, progress.

import { useEffect, useId, useMemo, useState, useCallback } from "react";
import type { Json } from "@/lib/blocks/types";
import { sanitizeHtml } from "@/lib/sanitize";
import { ChevronDown } from "lucide-react";

type Lang = "pl" | "en";

const L = {
  pl: { days: "dni", hours: "godz.", minutes: "min", seconds: "s", expired: "Zakończono" },
  en: { days: "days", hours: "hrs", minutes: "min", seconds: "s", expired: "Ended" },
} as const;

// Shared HTML policy (forbids iframe/form/script/style + inline handlers),
// identical to the rest of the blocks engine - see lib/sanitize.
function clean(html: string): string {
  return sanitizeHtml(html);
}

interface ItemLite { label: string; body: string }

function parseItems(raw: Json[] | undefined, key: "title" | "label"): ItemLite[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return { label: String(o[key] ?? ""), body: String(o.body ?? "") };
  });
}

// ===== Accordion =====

interface AccordionProps {
  items?: Json[];
  allowMultiple?: boolean;
  cls?: string;
}

export function AccordionView({ items, allowMultiple = false, cls }: AccordionProps) {
  const parsed = useMemo(() => parseItems(items, "title"), [items]);
  const [open, setOpen] = useState<Set<number>>(() => new Set());

  const toggle = useCallback((idx: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        if (!allowMultiple) next.clear();
        next.add(idx);
      }
      return next;
    });
  }, [allowMultiple]);

  if (parsed.length === 0) return null;

  return (
    <div className={`divide-y divide-border rounded-lg border border-border bg-card ${cls ?? ""}`}>
      {parsed.map((it, idx) => {
        const isOpen = open.has(idx);
        return (
          <div key={idx}>
            <button
              type="button"
              onClick={() => toggle(idx)}
              aria-expanded={isOpen}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
            >
              <span>{it.label || `Sekcja ${idx + 1}`}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {isOpen ? (
              <div
                className="px-4 pb-4 pt-1 text-sm text-muted-foreground prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: clean(it.body) }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ===== Tabs =====

interface TabsProps {
  items?: Json[];
  orientation?: "horizontal" | "vertical";
  cls?: string;
}

export function TabsView({ items, orientation = "horizontal", cls }: TabsProps) {
  const parsed = useMemo(() => parseItems(items, "label"), [items]);
  const [active, setActive] = useState(0);
  const uid = useId();
  if (parsed.length === 0) return null;

  const vert = orientation === "vertical";

  return (
    <div className={`${vert ? "flex gap-4" : "space-y-3"} ${cls ?? ""}`}>
      <div
        role="tablist"
        aria-orientation={orientation}
        className={vert ? "flex flex-col border-r border-border min-w-[140px]" : "flex flex-wrap gap-1 border-b border-border"}
      >
        {parsed.map((it, idx) => {
          const selected = idx === active;
          return (
            <button
              key={idx}
              role="tab"
              type="button"
              id={`${uid}-tab-${idx}`}
              aria-selected={selected}
              aria-controls={`${uid}-panel-${idx}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(idx)}
              className={[
                "text-sm font-medium px-3 py-2 transition-colors",
                vert ? "text-left border-r-2" : "border-b-2 -mb-px",
                selected
                  ? "text-primary border-primary"
                  : "text-muted-foreground border-transparent hover:text-foreground",
              ].join(" ")}
            >
              {it.label || `Tab ${idx + 1}`}
            </button>
          );
        })}
      </div>
      <div className="flex-1">
        {parsed.map((it, idx) => (
          <div
            key={idx}
            role="tabpanel"
            id={`${uid}-panel-${idx}`}
            aria-labelledby={`${uid}-tab-${idx}`}
            hidden={idx !== active}
            className="text-sm text-foreground prose prose-sm max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: clean(it.body) }}
          />
        ))}
      </div>
    </div>
  );
}

// ===== Countdown =====

interface CountdownProps {
  targetAt?: string;
  label?: string;
  expiredText?: string;
  lang?: Lang;
  cls?: string;
}

function diff(target: number, now: number): { d: number; h: number; m: number; s: number; done: boolean } {
  const delta = Math.max(0, target - now);
  const done = delta === 0;
  const totalSec = Math.floor(delta / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return { d, h, m, s, done };
}

export function CountdownView({ targetAt, label, expiredText, lang = "pl", cls }: CountdownProps) {
  const t = L[lang];
  const target = useMemo(() => {
    if (!targetAt) return null;
    const ms = new Date(targetAt).getTime();
    return Number.isFinite(ms) ? ms : null;
  }, [targetAt]);

  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (target === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [target]);

  if (target === null) return null;
  const { d, h, m, s, done } = diff(target, now);
  const finished = expiredText && expiredText.trim() ? expiredText : t.expired;

  if (done) {
    return (
      <div className={`inline-flex items-center justify-center px-4 py-3 rounded-lg bg-muted text-sm font-medium text-foreground ${cls ?? ""}`}>
        {finished}
      </div>
    );
  }

  const Cell = ({ value, unit }: { value: number; unit: string }) => (
    <div className="flex flex-col items-center px-3 py-2 rounded-lg bg-card border border-border min-w-[64px]">
      <span className="text-2xl font-bold tabular-nums text-foreground">{value.toString().padStart(2, "0")}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{unit}</span>
    </div>
  );

  return (
    <div className={`flex flex-col items-start gap-2 ${cls ?? ""}`}>
      {label ? <span className="text-sm text-muted-foreground">{label}</span> : null}
      <div className="flex items-center gap-2" aria-live="polite">
        <Cell value={d} unit={t.days} />
        <Cell value={h} unit={t.hours} />
        <Cell value={m} unit={t.minutes} />
        <Cell value={s} unit={t.seconds} />
      </div>
    </div>
  );
}

// ===== Progress =====

interface ProgressProps {
  value?: number;
  label?: string;
  showValue?: boolean;
  color?: "primary" | "success" | "warning" | "danger";
  cls?: string;
}

const PROGRESS_COLORS: Record<NonNullable<ProgressProps["color"]>, string> = {
  primary: "bg-primary",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-destructive",
};

export function ProgressView({ value = 0, label, showValue = true, color = "primary", cls }: ProgressProps) {
  const v = Math.max(0, Math.min(100, value));
  const fill = PROGRESS_COLORS[color];
  return (
    <div className={`w-full space-y-1.5 ${cls ?? ""}`}>
      {(label || showValue) ? (
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-foreground">{label}</span>
          {showValue ? <span className="tabular-nums text-muted-foreground">{v}%</span> : null}
        </div>
      ) : null}
      <div
        className="w-full h-2 rounded-full bg-muted overflow-hidden"
        role="progressbar"
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || undefined}
      >
        <div className={`h-full ${fill} transition-[width] duration-500`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
