// Right-click context menu for the CMS Builder canvas.
// Renders a floating menu anchored at the cursor position, with options
// scoped to the kind of node that was right-clicked (section / inner / column /
// widget / empty area).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";
import {
  Copy,
  Trash2,
  Plus,
  ChevronUp,
  ChevronDown,
  Eye,
  Save,
  Columns2,
  Settings,
  X,
  Globe,
  Link2Off,
  FlaskConical,
} from "@/lib/lucide-shim";

type CtxKind = "section" | "inner-section" | "column" | "widget" | "empty";

export interface CtxTarget {
  kind: CtxKind;
  id: string | null;
  x: number;
  y: number;
}

interface BuilderContextMenuActions {
  openProperties?: () => void;
  duplicate?: () => void;
  copy?: () => void;
  cut?: () => void;
  paste?: () => void;
  hasClipboard?: boolean;
  toggleHidden?: () => void;
  hiddenOnDevice?: boolean;
  moveUp?: () => void;
  moveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  addColumn?: () => void;
  addInnerSection?: () => void;
  addSection?: () => void;
  saveAsTemplate?: () => void;
  /** Widget: promote to a global widget synchronized across pages. */
  saveAsGlobal?: () => void;
  /** Widget: detach a global instance into a local copy. */
  unlinkGlobal?: () => void;
  /** Section: create an A/B test (duplicates the section as variant B). */
  startAbTest?: () => void;
  /** Section: this section's variant when it is part of an A/B test. */
  abVariant?: "a" | "b";
  endAbTestKeepA?: () => void;
  endAbTestKeepB?: () => void;
  endAbTestKeepBoth?: () => void;
  remove?: () => void;
}

interface Props {
  target: CtxTarget | null;
  actions: BuilderContextMenuActions;
  onClose: () => void;
}

export function BuilderContextMenu({ target, actions, onClose }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!target) return;
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("contextmenu", onDocDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("contextmenu", onDocDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [target, onClose]);

  // Position after mount so we can flip when overflowing.
  useLayoutEffect(() => {
    if (!target || !ref.current) return;
    const el = ref.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = target.x;
    let top = target.y;
    if (left + w + pad > vw) left = Math.max(pad, vw - w - pad);
    if (top + h + pad > vh) top = Math.max(pad, vh - h - pad);
    setPos({ left, top });
  }, [target]);

  if (!target) return null;

  const kindLabel =
    target.kind === "section"
      ? t("builder.contextMenu.kindSection")
      : target.kind === "inner-section"
        ? t("builder.contextMenu.kindInnerSection")
        : target.kind === "column"
          ? t("builder.contextMenu.kindColumn")
          : target.kind === "widget"
            ? t("builder.contextMenu.kindWidget")
            : t("builder.contextMenu.kindArea");

  const run = (fn?: () => void) => {
    if (!fn) return;
    onClose();
    fn();
  };

  const Item = ({
    icon,
    label,
    shortcut,
    onClick,
    disabled,
    danger,
  }: {
    icon?: ReactNode;
    label: string;
    shortcut?: string;
    onClick?: () => void;
    disabled?: boolean;
    danger?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled || !onClick}
      onClick={() => run(onClick)}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded text-left transition
        ${
          disabled || !onClick
            ? "opacity-40 cursor-not-allowed text-muted-foreground"
            : danger
              ? "text-destructive hover:bg-destructive/10"
              : "text-foreground hover:bg-muted"
        }`}
    >
      <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {shortcut && <span className="text-[10px] text-muted-foreground font-mono">{shortcut}</span>}
    </button>
  );

  const Sep = () => <div className="h-px bg-border my-1" />;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-[200] min-w-[220px] rounded-md border border-border bg-popover shadow-2xl py-1 animate-in fade-in zoom-in-95 duration-100"
      style={{
        left: pos?.left ?? target.x,
        top: pos?.top ?? target.y,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
        <span>{kindLabel}</span>
        <button
          type="button"
          aria-label={t("builder.contextMenu.close")}
          onClick={onClose}
          className="p-0.5 hover:bg-muted rounded"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <Sep />

      {actions.openProperties && (
        <Item
          icon={<Settings className="w-3.5 h-3.5" />}
          label={t("builder.contextMenu.properties")}
          onClick={actions.openProperties}
        />
      )}

      {(actions.canMoveUp !== undefined || actions.canMoveDown !== undefined) && (
        <>
          <Item
            icon={<ChevronUp className="w-3.5 h-3.5" />}
            label={t("builder.contextMenu.moveUp")}
            onClick={actions.moveUp}
            disabled={!actions.canMoveUp}
          />
          <Item
            icon={<ChevronDown className="w-3.5 h-3.5" />}
            label={t("builder.contextMenu.moveDown")}
            onClick={actions.moveDown}
            disabled={!actions.canMoveDown}
          />
        </>
      )}

      {(actions.addColumn || actions.addInnerSection || actions.addSection) && <Sep />}
      {actions.addSection && (
        <Item
          icon={<Plus className="w-3.5 h-3.5" />}
          label={t("builder.contextMenu.addSection")}
          onClick={actions.addSection}
        />
      )}
      {actions.addColumn && (
        <Item
          icon={<Columns2 className="w-3.5 h-3.5" />}
          label={t("builder.contextMenu.addColumn")}
          onClick={actions.addColumn}
        />
      )}
      {actions.addInnerSection && (
        <Item
          icon={<Plus className="w-3.5 h-3.5" />}
          label={t("builder.contextMenu.addInnerSection")}
          onClick={actions.addInnerSection}
        />
      )}

      {(actions.copy || actions.cut || actions.paste || actions.duplicate) && <Sep />}
      {actions.duplicate && (
        <Item
          icon={<Copy className="w-3.5 h-3.5" />}
          label={t("builder.contextMenu.duplicate")}
          shortcut="⌘D"
          onClick={actions.duplicate}
        />
      )}
      {actions.copy && (
        <Item label={t("builder.contextMenu.copy")} shortcut="⌘C" onClick={actions.copy} />
      )}
      {actions.cut && (
        <Item label={t("builder.contextMenu.cut")} shortcut="⌘X" onClick={actions.cut} />
      )}
      {actions.paste && (
        <Item
          label={t("builder.contextMenu.paste")}
          shortcut="⌘V"
          onClick={actions.paste}
          disabled={!actions.hasClipboard}
        />
      )}

      {actions.toggleHidden && (
        <>
          <Sep />
          <Item
            icon={<Eye className="w-3.5 h-3.5" />}
            label={
              actions.hiddenOnDevice
                ? t("builder.contextMenu.showOnDevice")
                : t("builder.contextMenu.hideOnDevice")
            }
            onClick={actions.toggleHidden}
          />
        </>
      )}

      {actions.saveAsTemplate && (
        <Item
          icon={<Save className="w-3.5 h-3.5" />}
          label={t("builder.contextMenu.saveAsTemplate")}
          onClick={actions.saveAsTemplate}
        />
      )}

      {actions.saveAsGlobal && (
        <Item
          icon={<Globe className="w-3.5 h-3.5" />}
          label={t("builder.contextMenu.saveAsGlobal")}
          onClick={actions.saveAsGlobal}
        />
      )}
      {actions.unlinkGlobal && (
        <Item
          icon={<Link2Off className="w-3.5 h-3.5" />}
          label={t("builder.contextMenu.unlinkGlobal")}
          onClick={actions.unlinkGlobal}
        />
      )}

      {actions.startAbTest && (
        <>
          <Sep />
          <Item
            icon={<FlaskConical className="w-3.5 h-3.5" />}
            label={t("builder.contextMenu.startAbTest")}
            onClick={actions.startAbTest}
          />
        </>
      )}
      {actions.abVariant && (
        <>
          <Sep />
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("builder.contextMenu.abVariantHeader", {
              variant: actions.abVariant.toUpperCase(),
            })}
          </div>
          <Item
            icon={<FlaskConical className="w-3.5 h-3.5" />}
            label={t("builder.contextMenu.endAbKeepA")}
            onClick={actions.endAbTestKeepA}
          />
          <Item
            icon={<FlaskConical className="w-3.5 h-3.5" />}
            label={t("builder.contextMenu.endAbKeepB")}
            onClick={actions.endAbTestKeepB}
          />
          <Item
            icon={<FlaskConical className="w-3.5 h-3.5" />}
            label={t("builder.contextMenu.endAbKeepBoth")}
            onClick={actions.endAbTestKeepBoth}
          />
        </>
      )}

      {actions.remove && (
        <>
          <Sep />
          <Item
            icon={<Trash2 className="w-3.5 h-3.5" />}
            label={t("builder.contextMenu.remove")}
            shortcut="Del"
            onClick={actions.remove}
            danger
          />
        </>
      )}
    </div>,
    document.body,
  );
}
