// Organism: editor for post meta info (author, date, category line).
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ThemeDesign } from "@/lib/theme/themeDesign";
import { Section, FieldGrid, Field, ToggleField, PxStepper } from "../../atoms";
import { ColorControl } from "../../molecules";
import type { SectionEditorProps } from "../../types";
import "@/lib/i18n-admin-theme-design";

export function MetaSection({ draft, set, setColor, previewMode }: SectionEditorProps) {
  const { t } = useTranslation();
  const meta = draft.metaInfo;
  return (
    <Section title={t("adminThemeDesign.sections.meta")}>
      <FieldGrid>
        <Field label={t("adminThemeDesign.f.sizePx")}>
          <PxStepper value={meta.fontSize} onChange={(v) => set("metaInfo", { fontSize: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.color")}>
          <ColorControl
            section="metaInfo"
            field="color"
            mode={previewMode}
            draft={draft}
            setColor={setColor}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.gapBetween")}>
          <PxStepper value={meta.gap} onChange={(v) => set("metaInfo", { gap: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.separator")}>
          <Select
            value={meta.separator}
            onValueChange={(v) =>
              set("metaInfo", { separator: v as ThemeDesign["metaInfo"]["separator"] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dot">•</SelectItem>
              <SelectItem value="slash">/</SelectItem>
              <SelectItem value="pipe">|</SelectItem>
              <SelectItem value="none">{t("adminThemeDesign.opt.none")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <ToggleField
          label={t("adminThemeDesign.toggle.uppercase")}
          checked={meta.uppercase}
          onChange={(v) => set("metaInfo", { uppercase: v })}
        />
      </FieldGrid>
    </Section>
  );
}
