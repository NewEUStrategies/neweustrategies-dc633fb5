// Floating font-size toolbar for the builder canvas (v2, stability-first).
//
// Lessons from the removed InlineEditToolbar (commit 4dafb5b) baked in:
//  1. VALUE IS REACTIVE — read from the builder document (widget.content[key]),
//     with the DOM's computed font-size only as the "auto" fallback. The old
//     toolbar polled getComputedStyle every animation frame, which fought the
//     input while React re-rendered and could briefly show a stale number.
//  2. NEVER COVERS CONTENT — positioned above the WIDGET frame (not above the
//     clicked element), so it cannot hide the widget's own title/description
//     the way the old `rect.top - 38` placement did.
//  3. THEME-PROOF — the panel is portaled to <body>, outside the admin theme
//     scopes, so it uses only explicit inline colors (no Tailwind tokens like
//     bg-background that resolve differently on <body> and made the value
//     render white-on-white in the recording).
//  4. PREDICTABLE LIFECYCLE — opens on click of a [data-edit-target] element,
//     closes on Escape / ✕ / selecting a different widget / deleting the
//     widget. Re-renders of the canvas (doc mutations) do NOT close it; the
//     target element is re-resolved by (widgetId, key) with a grace period.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";
import { Minus, Plus, PanelRightOpen, X } from "lucide-react";
import type { BuilderDocument, WidgetNode, Json } from "@/lib/builder/types";
import { findWidget } from "@/lib/builder/operations";
import {
  EDIT_TARGET_META,
  FOCUS_SIZE_FIELD_EVENT,
  clampEditTarget,
  findEditTargetElement,
  isEditTargetKey,
} from "@/lib/builder/editTargets";
import type { Selection } from "./builder/types";

interface Props {
  doc: BuilderDocument;
  selection: Selection;
  setSelection: (s: Selection) => void;
  updateWidget: (id: string, mut: (w: WidgetNode) => void) => void;
}

interface Target {
  widgetId: string;
  key: string;
}

interface Rects {
  el: { top: number; left: number; width: number; height: number };
  widget: { top: number; left: number; width: number; height: number };
}

const TOOLBAR_W = 292;
const TOOLBAR_H = 30;
const GAP = 8;
/** Keep the toolbar alive across canvas re-renders while the element remounts. */
const MISSING_GRACE_MS = 1200;

const chrome = {
  bg: "#141414",
  border: "rgba(250, 147, 70, 0.9)",
  text: "#f8fafc",
  dim: "#cbd5e1",
  inputBg: "#1f1f1f",
  inputBorder: "rgba(255,255,255,0.22)",
} as const;

function readOverride(doc: BuilderDocument, t: Target | null): number | undefined {
  if (!t) return undefined;
  const w = findWidget(doc, t.widgetId)?.widget;
  const raw = (w?.content as Record<string, unknown> | undefined)?.[t.key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function sameRect(a: Rects["el"], b: Rects["el"]) {
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

export function InlineSizeToolbar({ doc, selection, setSelection, updateWidget }: Props) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<Target | null>(null);
  const [rects, setRects] = useState<Rects | null>(null);
  const [effectivePx, setEffectivePx] = useState<number | null>(null);
  // Draft = what the user is typing right now; committed on blur / Enter.
  const [draft, setDraft] = useState<string | null>(null);

  const targetRef = useRef<Target | null>(null);
  targetRef.current = target;
  const missingSinceRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const override = readOverride(doc, target);
  const widgetExists = useMemo(
    () => (target ? !!findWidget(doc, target.widgetId) : false),
    [doc, target],
  );

  // ---- open on click of any [data-edit-target] inside the canvas ----
  // Attached on document CAPTURE so it runs before VisualCanvas' navigation
  // killer (which stopPropagation()s clicks at the canvas root).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest("[data-cms-size-toolbar]")) return; // clicks inside the toolbar
      const editable = t.closest<HTMLElement>("[data-visual-canvas] [data-edit-target]");
      if (!editable) return;
      const key = editable.getAttribute("data-edit-target");
      if (!isEditTargetKey(key)) return;
      const widget = editable.closest<HTMLElement>("[data-widget-id]");
      const widgetId = widget?.dataset.widgetId;
      if (!widgetId) return;
      missingSinceRef.current = null;
      setDraft(null);
      setSelection({ kind: "widget", id: widgetId });
      setTarget({ widgetId, key });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [setSelection]);

  // ---- close when the selection moves to a different widget / nothing ----
  useEffect(() => {
    setTarget((prev) => {
      if (!prev) return prev;
      if (selection.kind === "widget" && selection.id === prev.widgetId) return prev;
      return null;
    });
  }, [selection]);

  // ---- close when the widget is removed from the document ----
  useEffect(() => {
    if (target && !widgetExists) setTarget(null);
  }, [target, widgetExists]);

  // ---- geometry loop: follow scroll / layout; survive element remounts ----
  useEffect(() => {
    if (!target) {
      setRects(null);
      return;
    }
    const tick = () => {
      const active = targetRef.current;
      if (!active) return;
      const el = findEditTargetElement(active.widgetId, active.key);
      const widgetEl = el?.closest<HTMLElement>("[data-widget-id]") ?? null;
      const now = performance.now();
      if (!el || !widgetEl) {
        if (missingSinceRef.current === null) missingSinceRef.current = now;
        if (now - missingSinceRef.current > MISSING_GRACE_MS) {
          setTarget(null);
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      missingSinceRef.current = null;
      const er = el.getBoundingClientRect();
      const wr = widgetEl.getBoundingClientRect();
      if (er.width === 0 && er.height === 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const next: Rects = {
        el: { top: er.top, left: er.left, width: er.width, height: er.height },
        widget: { top: wr.top, left: wr.left, width: wr.width, height: wr.height },
      };
      setRects((prev) =>
        prev && sameRect(prev.el, next.el) && sameRect(prev.widget, next.widget) ? prev : next,
      );
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  // ---- effective (computed) size: measured on open and after doc changes ----
  // Deliberately NOT in the rAF loop — the document is the source of truth for
  // the input; the DOM only supplies the "auto" fallback value.
  useEffect(() => {
    if (!target) {
      setEffectivePx(null);
      return;
    }
    let raf = 0;
    // Wait one frame so a just-committed change is already painted.
    raf = requestAnimationFrame(() => {
      const el = findEditTargetElement(target.widgetId, target.key);
      if (!el) return; // keep the previous measurement during remounts
      const px = parseFloat(window.getComputedStyle(el).fontSize);
      if (Number.isFinite(px)) setEffectivePx(Math.round(px));
    });
    return () => cancelAnimationFrame(raf);
  }, [target, doc, override]);

  // ---- keyboard: Escape closes; ↑/↓ nudge when focus is not in our input ----
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTarget(null);
        return;
      }
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const focused = document.activeElement as HTMLElement | null;
      if (focused?.closest("[data-cms-size-toolbar]")) return; // input handles its own keys
      if (focused && /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName)) return;
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? 1 : -1;
      bump(dir * (e.shiftKey ? 4 : 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!target || !rects) return null;
  const meta = EDIT_TARGET_META[target.key];
  const shown = draft ?? String(override ?? effectivePx ?? meta.fallbackPx);
  const isAuto = override === undefined;

  function commitValue(next: number | null) {
    const active = targetRef.current;
    if (!active) return;
    updateWidget(active.widgetId, (w) => {
      const content = { ...(w.content ?? {}) } as Record<string, Json>;
      if (next === null) delete content[active.key];
      else content[active.key] = clampEditTarget(active.key, next);
      w.content = content as typeof w.content;
    });
  }

  function bump(delta: number) {
    const active = targetRef.current;
    if (!active) return;
    const base =
      readOverride(doc, active) ?? effectivePx ?? EDIT_TARGET_META[active.key].fallbackPx;
    setDraft(null);
    commitValue(base + delta);
  }

  function commitDraft() {
    if (draft === null) return;
    const trimmed = draft.trim();
    setDraft(null);
    if (trimmed === "") {
      commitValue(null); // cleared → back to auto
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n)) commitValue(n);
  }

  function openInPanel() {
    const active = targetRef.current;
    if (!active) return;
    window.dispatchEvent(new CustomEvent(FOCUS_SIZE_FIELD_EVENT, { detail: { key: active.key } }));
  }

  // ---- placement: centered over the clicked element, ABOVE the widget box ----
  const vw = window.innerWidth;
  const left = Math.max(
    GAP,
    Math.min(vw - TOOLBAR_W - GAP, rects.el.left + rects.el.width / 2 - TOOLBAR_W / 2),
  );
  // Above the widget frame → never covers the widget's own content. Falls back
  // to below the widget when the widget touches the viewport top.
  let top = rects.widget.top - TOOLBAR_H - GAP;
  if (top < GAP) {
    const below = rects.widget.top + rects.widget.height + GAP;
    top = below + TOOLBAR_H < window.innerHeight - GAP ? below : GAP;
  }

  const iconBtn: React.CSSProperties = {
    width: 22,
    height: 22,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    color: chrome.text,
    background: "transparent",
    border: 0,
    padding: 0,
    cursor: "pointer",
    flex: "0 0 auto",
  };
  const textBtn: React.CSSProperties = {
    minHeight: 22,
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    borderRadius: 4,
    color: chrome.dim,
    background: "transparent",
    border: 0,
    padding: "0 5px",
    cursor: "pointer",
    fontSize: 10,
    lineHeight: 1,
    fontWeight: 700,
    whiteSpace: "nowrap",
    flex: "0 0 auto",
  };

  return createPortal(
    <>
      {/* Outline of the edited element (never intercepts pointer events). */}
      <div
        style={{
          position: "fixed",
          top: rects.el.top - 2,
          left: rects.el.left - 2,
          width: rects.el.width + 4,
          height: rects.el.height + 4,
          border: `2px solid ${chrome.border}`,
          borderRadius: 4,
          pointerEvents: "none",
          zIndex: 2147483646,
        }}
      />
      <div
        data-cms-size-toolbar
        data-builder-chrome="size-toolbar"
        role="toolbar"
        aria-label={t("builder.inlineSize.fontSizeAria", { label: meta.label })}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top,
          left,
          zIndex: 2147483647,
          width: TOOLBAR_W,
          height: TOOLBAR_H,
          display: "flex",
          alignItems: "center",
          gap: 4,
          borderRadius: 6,
          border: `1px solid ${chrome.border}`,
          background: chrome.bg,
          color: chrome.text,
          boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
          padding: "0 5px",
          fontFamily: "system-ui, sans-serif",
          colorScheme: "dark",
        }}
      >
        <span
          style={{
            fontSize: 10,
            lineHeight: 1,
            fontWeight: 800,
            color: chrome.text,
            maxWidth: 86,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: "0 0 auto",
          }}
          title={meta.label}
        >
          {meta.label}
        </span>
        <button
          type="button"
          onClick={() => bump(-1)}
          style={iconBtn}
          title={t("builder.inlineSize.decreaseTitle")}
          aria-label={t("builder.inlineSize.decreaseSize")}
        >
          <Minus size={12} strokeWidth={2.4} />
        </button>
        <input
          type="text"
          inputMode="numeric"
          aria-label={t("builder.inlineSize.pxSizeAria", { label: meta.label })}
          value={shown}
          onFocus={() => setDraft(String(override ?? effectivePx ?? meta.fallbackPx))}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              setDraft(null);
              bump((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 4 : 1));
            }
          }}
          style={{
            width: 40,
            height: 22,
            borderRadius: 4,
            border: `1px solid ${chrome.inputBorder}`,
            background: chrome.inputBg,
            color: chrome.text,
            WebkitTextFillColor: chrome.text,
            caretColor: chrome.text,
            padding: "0 3px",
            textAlign: "center",
            fontSize: 12,
            lineHeight: "22px",
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
            outline: "none",
            flex: "0 0 auto",
            appearance: "textfield",
          }}
        />
        <span style={{ color: chrome.dim, fontSize: 9, lineHeight: 1, flex: "0 0 auto" }}>px</span>
        {isAuto && (
          <span
            title={t("builder.inlineSize.noOverride")}
            style={{
              color: "#fbbf77",
              fontSize: 9,
              lineHeight: 1,
              fontWeight: 800,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              flex: "0 0 auto",
            }}
          >
            auto
          </span>
        )}
        <button
          type="button"
          onClick={() => bump(1)}
          style={iconBtn}
          title={t("builder.inlineSize.increaseTitle")}
          aria-label={t("builder.inlineSize.increaseSize")}
        >
          <Plus size={12} strokeWidth={2.4} />
        </button>
        <span
          style={{
            width: 1,
            height: 14,
            background: "rgba(255,255,255,0.18)",
            flex: "0 0 auto",
          }}
        />
        <button
          type="button"
          onClick={openInPanel}
          style={textBtn}
          title={t("builder.inlineSize.openInStyle")}
        >
          <PanelRightOpen size={12} strokeWidth={2.4} />
          Panel
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(null);
            commitValue(null);
          }}
          style={{ ...textBtn, opacity: isAuto ? 0.45 : 1 }}
          title={t("builder.inlineSize.resetSize")}
          disabled={isAuto}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => setTarget(null)}
          style={iconBtn}
          title={t("builder.inlineSize.closeTitle")}
          aria-label={t("builder.inlineSize.close")}
        >
          <X size={12} strokeWidth={2.4} />
        </button>
      </div>
    </>,
    document.body,
  );
}
