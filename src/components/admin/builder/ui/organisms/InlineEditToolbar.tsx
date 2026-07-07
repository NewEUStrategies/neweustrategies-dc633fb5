// Floating inline edit toolbar for the builder canvas.
//
// Detects elements marked with data-edit-target="<schemaKey>" inside the
// currently selected widget and shows a small floating panel with a font-size
// stepper and a shortcut to focus the matching field in the properties panel.
//
// Communication is decoupled via CustomEvents:
//  - "lovable:inline-edit-set"    { widgetId, key, value | null }  (Builder listens)
//  - "lovable:focus-field"        { key }                          (WidgetProperties listens)
//
// This keeps the toolbar self-contained (no prop drilling) and undo/redo works
// because Builder routes the change through the same updateWidget() mutation
// used by the panel.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, PanelRightOpen, X } from "lucide-react";

interface EditTarget {
  key: string;
  el: HTMLElement;
  rect: DOMRect;
}

const LABELS: Record<string, string> = {
  titleSize: "Tytuł",
  descriptionSize: "Opis",
  perkSize: "Bulletpointy",
  labelSize: "Etykiety",
  placeholderSize: "Pola / placeholder",
  buttonSize: "Przycisk",
  buttonFontSize: "Przycisk",
  consentSize: "Zgody",
};

// Reasonable fallback sizes when the widget content has no explicit value yet.
const DEFAULTS: Record<string, number> = {
  titleSize: 24,
  descriptionSize: 14,
  perkSize: 14,
  labelSize: 12,
  placeholderSize: 14,
  buttonSize: 14,
  buttonFontSize: 14,
  consentSize: 11,
};

const RANGES: Record<string, [number, number]> = {
  titleSize: [10, 96],
  descriptionSize: [8, 48],
  perkSize: [8, 32],
  labelSize: [8, 24],
  placeholderSize: [8, 24],
  buttonSize: [8, 28],
  buttonFontSize: [8, 28],
  consentSize: [8, 20],
};

export function InlineEditToolbar({
  selectedWidgetId,
  canvasRef,
}: {
  selectedWidgetId: string | null;
  canvasRef: React.RefObject<HTMLElement | null>;
}) {
  const [target, setTarget] = useState<EditTarget | null>(null);
  const rafRef = useRef<number | null>(null);

  // Track element geometry so the floating panel follows scroll / layout shifts.
  // If the element unmounts (widget re-render after a size change), re-resolve
  // by data-edit-target key inside the currently selected widget so the toolbar
  // stays open across updates.
  useEffect(() => {
    if (!target) return;
    const tick = () => {
      let el: HTMLElement | null = target.el;
      if (!document.contains(el)) {
        const canvas = canvasRef.current;
        const widget = canvas?.querySelector<HTMLElement>(
          `[data-widget-id="${selectedWidgetId}"]`,
        );
        el = widget?.querySelector<HTMLElement>(
          `[data-edit-target="${target.key}"]`,
        ) ?? null;
        if (!el) {
          setTarget(null);
          return;
        }
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setTarget(null);
        return;
      }
      const nextEl = el;
      setTarget((prev) => (prev ? { ...prev, el: nextEl, rect } : prev));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target?.key, selectedWidgetId, canvasRef]);

  // Click-based detection: pick the innermost [data-edit-target] within the
  // currently selected widget. Hover would be noisier while dragging/typing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedWidgetId) {
      setTarget(null);
      return;
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const editable = t.closest<HTMLElement>("[data-edit-target]");
      if (!editable) return;
      const widget = editable.closest<HTMLElement>("[data-widget-id]");
      if (!widget || widget.dataset.widgetId !== selectedWidgetId) return;
      const key = editable.getAttribute("data-edit-target") ?? "";
      if (!key || !LABELS[key]) return;
      setTarget({ key, el: editable, rect: editable.getBoundingClientRect() });
    };
    // Keep hint alive when user clicks input / button by not stopping propagation.
    canvas.addEventListener("click", onClick, true);
    return () => canvas.removeEventListener("click", onClick, true);
  }, [canvasRef, selectedWidgetId]);

  // Dismiss when the widget selection changes or Escape is pressed.
  useEffect(() => {
    setTarget(null);
  }, [selectedWidgetId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!target) return;
      if (e.key === "Escape") {
        setTarget(null);
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if ((e.target as HTMLElement)?.tagName === "INPUT") return;
        e.preventDefault();
        const dir = e.key === "ArrowUp" ? 1 : -1;
        const step = e.shiftKey ? 4 : 1;
        bump(dir * step);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Read current px value from the DOM (source of truth is CSS since the widget
  // may not have an explicit override yet — we fall back to computed style).
  const current = useMemo(() => {
    if (!target) return 0;
    const cs = window.getComputedStyle(target.el);
    const px = parseFloat(cs.fontSize);
    return Number.isFinite(px) ? Math.round(px) : DEFAULTS[target.key] || 14;
  }, [target?.el, target?.rect.width, target?.rect.height]);

  if (!target || !selectedWidgetId) return null;

  const [min, max] = RANGES[target.key] || [8, 96];

  function setValue(next: number | null) {
    if (!target) return;
    const clamped =
      next === null ? null : Math.max(min, Math.min(max, Math.round(next)));
    window.dispatchEvent(
      new CustomEvent("lovable:inline-edit-set", {
        detail: { widgetId: selectedWidgetId, key: target.key, value: clamped },
      }),
    );
  }

  function bump(delta: number) {
    setValue(current + delta);
  }

  function openInPanel() {
    if (!target) return;
    window.dispatchEvent(
      new CustomEvent("lovable:focus-field", { detail: { key: target.key } }),
    );
  }

  // Position above the element, clamped to viewport.
  const top = Math.max(8, target.rect.top - 44);
  const left = Math.max(
    8,
    Math.min(window.innerWidth - 340, target.rect.left + target.rect.width / 2 - 170),
  );

  return createPortal(
    <>
      {/* Element outline */}
      <div
        style={{
          position: "fixed",
          top: target.rect.top - 2,
          left: target.rect.left - 2,
          width: target.rect.width + 4,
          height: target.rect.height + 4,
          border: "2px solid hsl(var(--brand))",
          borderRadius: 4,
          pointerEvents: "none",
          zIndex: 9998,
          boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
        }}
      />
      {/* Toolbar */}
      <div
        role="toolbar"
        aria-label={`Edytuj rozmiar: ${LABELS[target.key]}`}
        style={{ position: "fixed", top, left, zIndex: 9999 }}
        className="flex items-center gap-0.5 rounded-md border border-border bg-popover px-1 py-0.5 shadow-lg animate-in fade-in slide-in-from-top-1"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="px-1 text-[9px] font-medium text-muted-foreground">
          {LABELS[target.key]}
        </span>
        <button
          type="button"
          onClick={() => bump(-1)}
          className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted"
          title="Zmniejsz (↓ / Shift+↓ = 4)"
          aria-label="Zmniejsz rozmiar"
        >
          <Minus className="h-2.5 w-2.5" />
        </button>
        <input
          type="number"
          value={current}
          min={min}
          max={max}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) setValue(n);
          }}
          className="h-5 w-10 rounded border border-input bg-background px-1 text-center text-[9px] tabular-nums"
        />
        <span className="pr-0.5 text-[8px] text-muted-foreground">px</span>
        <button
          type="button"
          onClick={() => bump(1)}
          className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted"
          title="Zwiększ (↑ / Shift+↑ = 4)"
          aria-label="Zwiększ rozmiar"
        >
          <Plus className="h-2.5 w-2.5" />
        </button>
        <span className="mx-0.5 h-3 w-px bg-border" />
        <button
          type="button"
          onClick={openInPanel}
          className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Otwórz w panelu Styl"
        >
          <PanelRightOpen className="h-2.5 w-2.5" />
          Panel
        </button>
        <button
          type="button"
          onClick={() => setValue(null)}
          className="inline-flex items-center rounded px-1 py-0.5 text-[9px] text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Przywróć domyślny"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => setTarget(null)}
          className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted"
          title="Zamknij"
          aria-label="Zamknij"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    </>,
    document.body,
  );
}
