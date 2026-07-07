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
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, PanelRightOpen, X } from "lucide-react";

interface EditTarget {
  key: string;
  widgetId: string;
  rect: DOMRect;
}

interface RectLike {
  top: number;
  left: number;
  width: number;
  height: number;
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

const TOOLBAR_W = 254;
const MISSING_GRACE_MS = 800;

function escapeSelector(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function rectChanged(a: RectLike, b: RectLike) {
  return (
    Math.abs(a.top - b.top) > 0.5 ||
    Math.abs(a.left - b.left) > 0.5 ||
    Math.abs(a.width - b.width) > 0.5 ||
    Math.abs(a.height - b.height) > 0.5
  );
}

function readFontSize(el: HTMLElement, key: string) {
  const cs = window.getComputedStyle(el);
  const px = parseFloat(cs.fontSize);
  return Number.isFinite(px) ? Math.round(px) : DEFAULTS[key] || 14;
}

export function InlineEditToolbar({
  selectedWidgetId,
  onSelectWidget,
  canvasRef,
}: {
  selectedWidgetId: string | null;
  onSelectWidget: (widgetId: string) => void;
  canvasRef: React.RefObject<HTMLElement | null>;
}) {
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [current, setCurrent] = useState(0);
  const rafRef = useRef<number | null>(null);
  const targetRef = useRef<EditTarget | null>(null);
  const missingSinceRef = useRef<number | null>(null);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  const resolveTargetElement = (widgetId: string, key: string) => {
    const canvas = canvasRef.current;
    const widget = canvas?.querySelector<HTMLElement>(
      `[data-widget-id="${escapeSelector(widgetId)}"]`,
    );
    return widget?.querySelector<HTMLElement>(`[data-edit-target="${escapeSelector(key)}"]`) ?? null;
  };

  // Track element geometry so the floating panel follows scroll / layout shifts.
  // If the element unmounts (widget re-render after a size change), re-resolve
  // by data-edit-target key inside the currently selected widget so the toolbar
  // stays open across updates.
  useEffect(() => {
    if (!target) return;
    const tick = () => {
      const active = targetRef.current;
      if (!active) return;

      const el = resolveTargetElement(active.widgetId, active.key);
      const now = performance.now();
      if (!el) {
        if (missingSinceRef.current === null) missingSinceRef.current = now;
        if (now - missingSinceRef.current > MISSING_GRACE_MS) setTarget(null);
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        if (missingSinceRef.current === null) missingSinceRef.current = now;
        if (now - missingSinceRef.current > MISSING_GRACE_MS) setTarget(null);
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      missingSinceRef.current = null;
      setCurrent(readFontSize(el, active.key));
      setTarget((prev) => {
        if (!prev || !rectChanged(prev.rect, rect)) return prev;
        return { ...prev, rect };
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target?.key, target?.widgetId, canvasRef]);

  // Click-based detection: pick the innermost [data-edit-target] within the
  // currently selected widget. Hover would be noisier while dragging/typing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      setTarget(null);
      return;
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const editable = t.closest<HTMLElement>("[data-edit-target]");
      if (!editable) return;
      const widget = editable.closest<HTMLElement>("[data-widget-id]");
      const widgetId = widget?.dataset.widgetId;
      if (!widgetId) return;
      const key = editable.getAttribute("data-edit-target") ?? "";
      if (!key || !LABELS[key]) return;
      missingSinceRef.current = null;
      setCurrent(readFontSize(editable, key));
      onSelectWidget(widgetId);
      setTarget({ key, widgetId, rect: editable.getBoundingClientRect() });
    };
    // Keep hint alive when user clicks input / button by not stopping propagation.
    canvas.addEventListener("click", onClick, true);
    return () => canvas.removeEventListener("click", onClick, true);
  }, [canvasRef, onSelectWidget]);

  // Dismiss only when selection moves away from the toolbar's widget. When the
  // user clicks an editable element in a previously unselected widget, we first
  // select that widget and must keep the toolbar open for the same widgetId.
  useEffect(() => {
    setTarget((prev) => {
      if (!prev) return prev;
      if (selectedWidgetId && prev.widgetId === selectedWidgetId) return prev;
      return null;
    });
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
  if (!target) return null;

  const [min, max] = RANGES[target.key] || [8, 96];

  function setValue(next: number | null) {
    if (!target) return;
    const clamped =
      next === null ? null : Math.max(min, Math.min(max, Math.round(next)));
    if (clamped !== null) setCurrent(clamped);
    window.dispatchEvent(
      new CustomEvent("lovable:inline-edit-set", {
        detail: { widgetId: target.widgetId, key: target.key, value: clamped },
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
  const top = Math.max(8, target.rect.top - 38);
  const left = Math.max(
    8,
    Math.min(window.innerWidth - TOOLBAR_W - 8, target.rect.left + target.rect.width / 2 - TOOLBAR_W / 2),
  );

  const toolbarStyle = {
    position: "fixed",
    top,
    left,
    zIndex: 2147483647,
    width: TOOLBAR_W,
    minHeight: 28,
    display: "flex",
    alignItems: "center",
    gap: 3,
    borderRadius: 6,
    border: "1px solid rgba(250, 147, 70, 0.9)",
    background: "rgba(14, 19, 27, 0.98)",
    color: "#f8fafc",
    boxShadow: "0 10px 30px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06)",
    padding: "3px 4px",
    fontFamily: '"Red Hat Display", system-ui, sans-serif',
    pointerEvents: "auto",
  } satisfies React.CSSProperties;

  const iconButtonStyle = {
    width: 20,
    height: 20,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    color: "#f8fafc",
    background: "transparent",
    border: 0,
    padding: 0,
    cursor: "pointer",
    flex: "0 0 auto",
  } satisfies React.CSSProperties;

  const textButtonStyle = {
    minHeight: 20,
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    borderRadius: 4,
    color: "#f8fafc",
    background: "transparent",
    border: 0,
    padding: "0 4px",
    cursor: "pointer",
    fontSize: 10,
    lineHeight: 1,
    fontWeight: 700,
    whiteSpace: "nowrap",
    flex: "0 0 auto",
  } satisfies React.CSSProperties;

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
          border: "2px solid #fa9346",
          borderRadius: 4,
          pointerEvents: "none",
          zIndex: 2147483646,
          boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
        }}
      />
      {/* Toolbar */}
      <div
        data-builder-chrome="inline-edit-toolbar"
        role="toolbar"
        aria-label={`Edytuj rozmiar: ${LABELS[target.key]}`}
        style={toolbarStyle}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          style={{
            color: "#f8fafc",
            fontSize: 10,
            lineHeight: 1,
            fontWeight: 800,
            maxWidth: 62,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: "0 0 auto",
          }}
        >
          {LABELS[target.key]}
        </span>
        <button
          type="button"
          onClick={() => bump(-1)}
          style={iconButtonStyle}
          title="Zmniejsz (↓ / Shift+↓ = 4)"
          aria-label="Zmniejsz rozmiar"
        >
          <Minus size={12} strokeWidth={2.4} />
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
          style={{
            width: 38,
            height: 20,
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.08)",
            color: "#ffffff",
            padding: "0 3px",
            textAlign: "center",
            fontSize: 11,
            lineHeight: "20px",
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
            outline: "none",
            flex: "0 0 auto",
          }}
        />
        <span style={{ color: "#cbd5e1", fontSize: 9, lineHeight: 1, flex: "0 0 auto" }}>px</span>
        <button
          type="button"
          onClick={() => bump(1)}
          style={iconButtonStyle}
          title="Zwiększ (↑ / Shift+↑ = 4)"
          aria-label="Zwiększ rozmiar"
        >
          <Plus size={12} strokeWidth={2.4} />
        </button>
        <span style={{ width: 1, height: 14, background: "rgba(255,255,255,0.18)", flex: "0 0 auto" }} />
        <button
          type="button"
          onClick={openInPanel}
          style={textButtonStyle}
          title="Otwórz w panelu Styl"
        >
          <PanelRightOpen size={12} strokeWidth={2.4} />
          Panel
        </button>
        <button
          type="button"
          onClick={() => setValue(null)}
          style={textButtonStyle}
          title="Przywróć domyślny"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => setTarget(null)}
          style={iconButtonStyle}
          title="Zamknij"
          aria-label="Zamknij"
        >
          <X size={12} strokeWidth={2.4} />
        </button>
      </div>
    </>,
    document.body,
  );
}
