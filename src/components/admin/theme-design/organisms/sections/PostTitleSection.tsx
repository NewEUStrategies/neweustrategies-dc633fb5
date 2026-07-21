// Organism: editor for the unified post-title style shared by every widget.
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ThemeDesign } from "@/lib/theme/themeDesign";
import { Section, FieldGrid, Field, PreviewFrame, PxStepper, NumStepper } from "../../atoms";
import { ColorControl } from "../../molecules";
import type { SectionEditorProps } from "../../types";
import "@/lib/i18n-admin-theme-design";

export function PostTitleSection({ draft, set, setColor, previewMode }: SectionEditorProps) {
  const { t } = useTranslation();
  const pt = draft.postTitle;

  const previewVars: CSSProperties = {
    ["--td-pt-family" as string]: pt.fontFamily,
    ["--td-pt-size" as string]: pt.fontSize,
    ["--td-pt-size-sm" as string]: pt.fontSizeSm,
    ["--td-pt-weight" as string]: String(pt.fontWeight),
    ["--td-pt-lh" as string]: String(pt.lineHeight),
    ["--td-pt-color" as string]: pt.color,
    ["--td-pt-hover" as string]: pt.hoverColor,
    ["--td-pt-transform" as string]: pt.textTransform,
    ["--td-pt-spacing" as string]: pt.letterSpacing,
  };

  return (
    <Section title={t("adminThemeDesign.sections.postTitle")}>
      <p className="text-xs text-muted-foreground -mt-2">
        {t("adminThemeDesign.desc.postTitlePre")}
        <code>.cms-post-title</code>
        {t("adminThemeDesign.desc.postTitlePost")}
      </p>
      <FieldGrid>
        <Field label={t("adminThemeDesign.f.fontFamily")}>
          <Input
            value={pt.fontFamily}
            onChange={(e) => set("postTitle", { fontFamily: e.target.value })}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.sizeDesktop")}>
          <PxStepper value={pt.fontSize} onChange={(v) => set("postTitle", { fontSize: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.sizeMobile")}>
          <PxStepper value={pt.fontSizeSm} onChange={(v) => set("postTitle", { fontSizeSm: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.weight")}>
          <NumStepper value={pt.fontWeight} onChange={(v) => set("postTitle", { fontWeight: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.lineHeightLh")}>
          <Input
            value={String(pt.lineHeight)}
            onChange={(e) => set("postTitle", { lineHeight: e.target.value })}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.color")}>
          <ColorControl
            section="postTitle"
            field="color"
            mode={previewMode}
            draft={draft}
            setColor={setColor}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.colorHover")}>
          <ColorControl
            section="postTitle"
            field="hoverColor"
            mode={previewMode}
            draft={draft}
            setColor={setColor}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.transform")}>
          <Select
            value={pt.textTransform}
            onValueChange={(v) =>
              set("postTitle", { textTransform: v as ThemeDesign["postTitle"]["textTransform"] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("adminThemeDesign.opt.none")}</SelectItem>
              <SelectItem value="uppercase">{t("adminThemeDesign.opt.upper")}</SelectItem>
              <SelectItem value="lowercase">{t("adminThemeDesign.opt.lower")}</SelectItem>
              <SelectItem value="capitalize">{t("adminThemeDesign.opt.titleCase")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("adminThemeDesign.f.letterSpacing")}>
          <PxStepper
            value={pt.letterSpacing}
            onChange={(v) => set("postTitle", { letterSpacing: v })}
          />
        </Field>
      </FieldGrid>
      <PreviewFrame>
        <div style={previewVars}>
          <h3 className="cms-post-title">{t("adminThemeDesign.preview.sampleTitle")}</h3>
        </div>
      </PreviewFrame>
    </Section>
  );
}
