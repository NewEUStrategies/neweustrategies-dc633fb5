// Organism: editor for post thumbnail geometry + hover/shadow treatment.
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
import { Section, FieldGrid, Field, PxStepper } from "../../atoms";
import type { SectionEditorProps } from "../../types";
import "@/lib/i18n-admin-theme-design";

export function ThumbnailSection({ draft, set }: SectionEditorProps) {
  const { t } = useTranslation();
  const thumb = draft.thumbnail;
  return (
    <Section title={t("adminThemeDesign.sections.thumbnails")}>
      <FieldGrid>
        <Field label={t("adminThemeDesign.f.radius")}>
          <PxStepper value={thumb.radius} onChange={(v) => set("thumbnail", { radius: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.aspectRatio")}>
          <Input
            value={thumb.aspectRatio}
            onChange={(e) => set("thumbnail", { aspectRatio: e.target.value })}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.hoverEffect")}>
          <Select
            value={thumb.hoverEffect}
            onValueChange={(v) =>
              set("thumbnail", { hoverEffect: v as ThemeDesign["thumbnail"]["hoverEffect"] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("adminThemeDesign.opt.none")}</SelectItem>
              <SelectItem value="zoom">Zoom</SelectItem>
              <SelectItem value="fade">Fade</SelectItem>
              <SelectItem value="slide">Slide</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("adminThemeDesign.f.shadow")}>
          <Select
            value={thumb.shadow}
            onValueChange={(v) =>
              set("thumbnail", { shadow: v as ThemeDesign["thumbnail"]["shadow"] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("adminThemeDesign.opt.none")}</SelectItem>
              <SelectItem value="sm">{t("adminThemeDesign.opt.shadowSm")}</SelectItem>
              <SelectItem value="md">{t("adminThemeDesign.opt.shadowMd")}</SelectItem>
              <SelectItem value="lg">{t("adminThemeDesign.opt.shadowLg")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </FieldGrid>
    </Section>
  );
}
