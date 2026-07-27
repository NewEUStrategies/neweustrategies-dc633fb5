// Live preview of the currently edited widget - rendered inside the
// properties sidebar so color/gradient/icon/variant changes are visible
// immediately, without hunting for the widget on the canvas.
//
// Reuses the canonical WidgetView so the miniatura is byte-identical to
// what the canvas paints; wraps it in BuilderModeProvider so the editor's
// light/dark toggle drives the preview too.
import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { BuilderModeProvider } from "@/lib/builder/modeContext";
import type { Device, Mode, WidgetNode } from "@/lib/builder/types";
import { WidgetView } from "../../WidgetView";

const STORAGE_KEY = "builder.widget-live-preview.open";

function readInitialOpen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v == null ? true : v === "1";
  } catch {
    return true;
  }
}

interface Props {
  widget: WidgetNode;
  lang: "pl" | "en";
  device: Device;
  mode: Mode;
}

export function WidgetLivePreview({ widget, lang, device, mode }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<boolean>(readInitialOpen);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {
      /* storage unavailable - preference is best-effort only */
    }
  }, [open]);

  const stageStyle: CSSProperties = {
    background:
      mode === "dark"
        ? "linear-gradient(135deg, #141313 0%, #01112F 100%)"
        : "linear-gradient(135deg, #F8F6F4 0%, #ffffff 100%)",
    colorScheme: mode,
  };

  return (
    <section
      className="mb-2 rounded-md border border-border/70 bg-muted/20"
      aria-label={t("builder.widgetProps.livePreview", { defaultValue: "Podgląd na żywo" })}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Eye className="h-3 w-3" />
          {t("builder.widgetProps.livePreview", { defaultValue: "Podgląd na żywo" })}
        </span>
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", open ? "" : "-rotate-90")}
        />
      </button>
      {open && (
        <div
          className={cn(
            "cms-widget max-h-[280px] overflow-auto rounded-b-md border-t border-border/60 p-3",
            mode === "dark" ? "dark" : "light",
          )}
          style={stageStyle}
          data-builder-renderer="widget-props-preview"
          data-device={device}
        >
          <BuilderModeProvider mode={mode}>
            <WidgetView node={widget} lang={lang} device={device} editable={false} />
          </BuilderModeProvider>
        </div>
      )}
    </section>
  );
}
