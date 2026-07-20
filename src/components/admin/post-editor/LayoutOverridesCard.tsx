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
import { SidebarSection, InfoHint } from "@/components/admin/post-editor/SidebarSection";

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
  return (
    <SidebarSection title="Layout wpisu" icon={Layers}>
      <div>
        <Label>Format wpisu</Label>
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
        <Label>Layout (override)</Label>
        <Select
          value={ov.layout ?? "__inherit__"}
          onValueChange={(v) => onOverridesChange({ layout: v === "__inherit__" ? undefined : v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit__">- Użyj globalnego -</SelectItem>
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
              <p className="text-xs text-muted-foreground">Podgląd na żywo</p>
              <LayoutPreview preset={preset} settings={effective} />
              <p className="text-[10px] text-muted-foreground">
                {preset.label} · format: {currentFormat}
                {ov.layout ? " · override" : " · z globalnych"}
              </p>
            </div>
          );
        })()}
      <div className="space-y-1.5 pt-2 border-t border-border">
        <p className="text-xs text-muted-foreground mb-1 inline-flex items-center gap-1">
          {t("admin.posts.layoutOverrideHint", {
            defaultValue: "Nadpisz sekcje stopki (puste = z globalnych):",
          })}
          <InfoHint
            text={t("admin.posts.layoutTriHint", {
              defaultValue:
                "Globalne = dziedzicz ustawienie globalne. Włącz/Wyłącz = wymuś dla tego wpisu, ignorując globalne.",
            })}
          />
        </p>
        {(
          [
            ["center_header", "Wyśrodkuj nagłówek"],
            ["show_post_tags_bar", "Pasek tagów"],
            ["show_author_card", "Karta autora"],
            ["show_prev_next", "Poprzedni / następny"],
            ["show_bottom_newsletter", "Newsletter pod wpisem"],
            ["show_citation", "Box cytowania (Chicago / APA / BibTeX)"],
            ["show_quote_share", "Udostępnianie zaznaczonego cytatu"],
          ] as const
        ).map(([key, label]) => {
          const val = ov[key];
          const tri = val === true ? "on" : val === false ? "off" : "inherit";
          return (
            <div key={key} className="flex items-center justify-between text-xs">
              <span>{label}</span>
              <Select
                value={tri}
                onValueChange={(v) =>
                  onOverridesChange({
                    [key]: v === "inherit" ? undefined : v === "on",
                  } as Partial<LayoutOverrides>)
                }
              >
                <SelectTrigger className="h-7 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Globalne</SelectItem>
                  <SelectItem value="on">Włącz</SelectItem>
                  <SelectItem value="off">Wyłącz</SelectItem>
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </SidebarSection>
  );
}
