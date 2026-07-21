// Molekuła "Layout wpisu": format wpisu + nadpisania layoutu i sekcji stopki,
// z podglądem na żywo. Trójstan (Globalne / Włącz / Wyłącz) per sekcja mapuje
// się na boolean | undefined w LayoutOverrides.
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Layers } from "@/lib/lucide-shim";
import {
  findLayout,
  mergeOverrides,
  pickLayoutId,
  type LayoutOverrides,
  type LayoutPreset,
  type PostFormat,
  type PostLayoutSettings,
} from "@/lib/postLayouts";
import { LayoutPreview } from "@/components/admin/LayoutPreview";
import { SidebarSection, InfoHint, TriStateSelect } from "../atoms";
import { overridePatch } from "../lib";
import "@/lib/i18n-admin-post-panes";

/** Keys of LayoutOverrides whose value is a plain boolean toggle - the only
 *  ones the footer tri-state controls touch. Derived from the type so it can
 *  never drift from the interface. */
type BooleanOverrideKey = {
  [K in keyof LayoutOverrides]-?: boolean extends NonNullable<LayoutOverrides[K]> ? K : never;
}[keyof LayoutOverrides];

/** Footer sections rendered as tri-state rows: [override key, i18n label key]. */
const FOOTER_FIELDS = [
  ["center_header", "fieldCenterHeader"],
  ["show_post_tags_bar", "fieldTagsBar"],
  ["show_author_card", "fieldAuthorCard"],
  ["show_prev_next", "fieldPrevNext"],
  ["show_bottom_newsletter", "fieldBottomNewsletter"],
  ["show_citation", "fieldCitation"],
  ["show_quote_share", "fieldQuoteShare"],
] as const satisfies ReadonlyArray<readonly [BooleanOverrideKey, string]>;

interface Props {
  postFormat: PostFormat;
  onPostFormatChange: (v: PostFormat) => void;
  ov: LayoutOverrides;
  onOverridesChange: (patch: Partial<LayoutOverrides>) => void;
  currentFormat: PostFormat;
  layoutSet: LayoutPreset[];
  globalLayout: PostLayoutSettings | undefined;
}

export function LayoutOverridesCard({
  postFormat,
  onPostFormatChange,
  ov,
  onOverridesChange,
  currentFormat,
  layoutSet,
  globalLayout,
}: Props) {
  const { t } = useTranslation();
  const triLabels = {
    inherit: t("adminPostPanes.layout.triInherit"),
    on: t("adminPostPanes.layout.triOn"),
    off: t("adminPostPanes.layout.triOff"),
  };
  return (
    <SidebarSection title={t("adminPostPanes.layout.cardTitle")} icon={Layers}>
      <div>
        <Label>{t("adminPostPanes.layout.format")}</Label>
        <Select
          value={postFormat ?? "standard"}
          onValueChange={(v) => onPostFormatChange(v as PostFormat)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="video">Video</SelectItem>
            <SelectItem value="audio">Audio</SelectItem>
            <SelectItem value="gallery">Gallery</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t("adminPostPanes.layout.overrideLabel")}</Label>
        <Select
          value={ov.layout ?? "__inherit__"}
          onValueChange={(v) => onOverridesChange({ layout: v === "__inherit__" ? undefined : v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit__">{t("adminPostPanes.layout.useGlobal")}</SelectItem>
            {layoutSet.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {globalLayout &&
        (() => {
          const effective = mergeOverrides(globalLayout, ov);
          const layoutId = pickLayoutId(globalLayout, currentFormat, ov.layout);
          const preset = findLayout(currentFormat, layoutId);
          return (
            <div className="pt-2 border-t border-border space-y-1.5">
              <p className="text-xs text-muted-foreground">
                {t("adminPostPanes.layout.livePreview")}
              </p>
              <LayoutPreview preset={preset} settings={effective} />
              <p className="text-[10px] text-muted-foreground">
                {preset.label} · format: {currentFormat}
                {ov.layout
                  ? ` · ${t("adminPostPanes.layout.sourceOverride")}`
                  : ` · ${t("adminPostPanes.layout.sourceGlobal")}`}
              </p>
            </div>
          );
        })()}
      <div className="space-y-1.5 pt-2 border-t border-border">
        <p className="text-xs text-muted-foreground mb-1 inline-flex items-center gap-1">
          {t("adminPostPanes.layout.footerHint")}
          <InfoHint text={t("adminPostPanes.layout.triHint")} />
        </p>
        {FOOTER_FIELDS.map(([key, labelKey]) => (
          <div key={key} className="flex items-center justify-between text-xs">
            <span>{t(`adminPostPanes.layout.${labelKey}`)}</span>
            <TriStateSelect
              value={ov[key]}
              onChange={(next) => onOverridesChange(overridePatch(key, next))}
              labels={triLabels}
            />
          </div>
        ))}
      </div>
    </SidebarSection>
  );
}
