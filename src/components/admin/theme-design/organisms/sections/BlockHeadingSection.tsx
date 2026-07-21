// Organism: editor for global block headings (e.g. "Latest articles").
import { useTranslation } from "react-i18next";
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

export function BlockHeadingSection({ draft, set, setColor, previewMode }: SectionEditorProps) {
  const { t } = useTranslation();
  const bh = draft.blockHeading;
  return (
    <Section title={t("adminThemeDesign.sections.blockHeading")}>
      <FieldGrid>
        <Field label={t("adminThemeDesign.f.sizePx")}>
          <PxStepper value={bh.fontSize} onChange={(v) => set("blockHeading", { fontSize: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.weight")}>
          <NumStepper
            value={bh.fontWeight}
            onChange={(v) => set("blockHeading", { fontWeight: v })}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.color")}>
          <ColorControl
            section="blockHeading"
            field="color"
            mode={previewMode}
            draft={draft}
            setColor={setColor}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.transform")}>
          <Select
            value={bh.textTransform}
            onValueChange={(v) =>
              set("blockHeading", {
                textTransform: v as ThemeDesign["blockHeading"]["textTransform"],
              })
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
            value={bh.letterSpacing}
            onChange={(v) => set("blockHeading", { letterSpacing: v })}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.marginBottom")}>
          <PxStepper
            value={bh.marginBottom}
            onChange={(v) => set("blockHeading", { marginBottom: v })}
          />
        </Field>
      </FieldGrid>
      <PreviewFrame>
        <h3
          className="cms-block-heading"
          style={{
            fontSize: bh.fontSize,
            fontWeight: bh.fontWeight,
            color: bh.color,
            textTransform: bh.textTransform,
            letterSpacing: bh.letterSpacing,
            marginBottom: bh.marginBottom,
          }}
        >
          {t("adminThemeDesign.preview.latestArticles")}
        </h3>
      </PreviewFrame>
    </Section>
  );
}
