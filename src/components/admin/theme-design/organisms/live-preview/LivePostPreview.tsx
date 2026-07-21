// Organism: the "live preview" panel - a self-contained, token-scoped render
// of a real post card that reflects the current draft instantly.
//
// Two parallel token paths are used on purpose:
//  1. A scoped <style> block (rescoped from `:root`/`.dark` to the preview root)
//     so descendant utility classes (`.cms-*`) resolve their `var(--td-*)`.
//  2. Inline style variables on the root, which React diffs and writes on every
//     draft change - bulletproof even if the <style> innerHTML update is stale.
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  themeDesignToCss,
  themeDesignToStyleVars,
  type ThemeDesign,
  type ThemeDesignLang,
} from "@/lib/theme/themeDesign";
import { hardenStyleCss } from "@/lib/sanitize";
import { SegmentedControl, type SegmentedOption } from "../../atoms";
import type { PreviewMode } from "../../types";
import type { PreviewSection } from "../../lib";
import { LivePreviewStage } from "./LivePreviewStage";
import "@/lib/i18n-admin-theme-design";

function iconLabel(icon: ReactNode, text: string): ReactNode {
  return (
    <>
      {icon}
      {text}
    </>
  );
}

const LANG_OPTIONS: readonly SegmentedOption<ThemeDesignLang>[] = [
  { value: "pl", label: "🇵🇱 PL" },
  { value: "en", label: "🇬🇧 EN" },
];

const MODE_OPTIONS: readonly SegmentedOption<PreviewMode>[] = [
  { value: "light", label: iconLabel(<Sun className="h-3 w-3" />, "Light"), ariaLabel: "Light" },
  { value: "dark", label: iconLabel(<Moon className="h-3 w-3" />, "Dark"), ariaLabel: "Dark" },
];

export function LivePostPreview({
  draft,
  previewLang,
  onLangChange,
  previewMode,
  onModeChange,
  activeTab,
}: {
  draft: ThemeDesign;
  previewLang: ThemeDesignLang;
  onLangChange: (lang: ThemeDesignLang) => void;
  previewMode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  activeTab: PreviewSection;
}) {
  const { t } = useTranslation();

  // Rescope the generated `:root{}` / `.dark{}` blocks onto the preview root so
  // unsaved values never leak into the surrounding admin chrome.
  const scopedCss = useMemo(() => {
    const base = themeDesignToCss(draft);
    return base
      .replace(":root,.light{", ".theme-design-live-preview,.theme-design-live-preview.light{")
      .replace(":root{", ".theme-design-live-preview{")
      .replace(".dark{", ".theme-design-live-preview.dark{");
  }, [draft]);

  const inlineVars = useMemo(
    () => themeDesignToStyleVars(draft, previewMode),
    [draft, previewMode],
  );

  const isDark = previewMode === "dark";
  const rootStyle: CSSProperties = {
    ...(inlineVars as CSSProperties),
    background: "var(--gc-body-bg, var(--background))",
    color: "var(--gc-body-text, var(--foreground))",
  };

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
            {t("adminThemeDesign.live.title")}
          </span>
          <span className="text-[11px] text-muted-foreground truncate">
            {t("adminThemeDesign.live.subtitle")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            options={MODE_OPTIONS}
            value={previewMode}
            onChange={onModeChange}
            variant="invert"
            size="sm"
            ariaLabel={t("adminThemeDesign.editColorsForMode")}
          />
          <SegmentedControl
            options={LANG_OPTIONS}
            value={previewLang}
            onChange={onLangChange}
            variant="invert"
            size="sm"
            uppercase
            ariaLabel={t("adminThemeDesign.langBar.stylePerLang")}
          />
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: hardenStyleCss(scopedCss) }} />

      <div
        data-builder-renderer="theme-design-preview"
        data-device="desktop"
        className={cn(
          "theme-design-live-preview cms-widget p-6 transition-colors",
          isDark ? "dark" : "light",
        )}
        style={rootStyle}
      >
        <LivePreviewStage
          draft={draft}
          previewLang={previewLang}
          isDark={isDark}
          activeTab={activeTab}
        />
      </div>
    </div>
  );
}
