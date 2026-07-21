// Organism: editor for the global slider / carousel defaults. Owns its own
// draft slice (carousel_defaults site setting) rather than the ThemeDesign draft.
import { useTranslation } from "react-i18next";
import { NumberInput } from "@/components/admin/builder/ui/atoms";
import type { CarouselDefaults } from "@/lib/theme/carouselDefaults";
import { Section, FieldGrid, Field, ToggleField } from "../../atoms";
import "@/lib/i18n-admin-theme-design";

export function CarouselSection({
  draft,
  onChange,
}: {
  draft: CarouselDefaults;
  onChange: (next: CarouselDefaults) => void;
}) {
  const { t } = useTranslation();
  return (
    <Section title={t("adminThemeDesign.sections.carousel")}>
      <p className="text-xs text-muted-foreground -mt-2">{t("adminThemeDesign.desc.carousel")}</p>
      <FieldGrid>
        <ToggleField
          label={t("adminThemeDesign.toggle.autoplay")}
          checked={draft.autoplay}
          onChange={(v) => onChange({ ...draft, autoplay: v })}
        />
        <ToggleField
          label={t("adminThemeDesign.toggle.loop")}
          checked={draft.loop}
          onChange={(v) => onChange({ ...draft, loop: v })}
        />
        <ToggleField
          label={t("adminThemeDesign.toggle.pauseHover")}
          checked={draft.pauseOnHover}
          onChange={(v) => onChange({ ...draft, pauseOnHover: v })}
        />
        <Field label={t("adminThemeDesign.f.slideTime")}>
          <NumberInput
            min={1000}
            max={30000}
            step={500}
            value={draft.intervalMs}
            onChange={(value) => onChange({ ...draft, intervalMs: value ?? 1000 })}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.transitionTime")}>
          <NumberInput
            min={100}
            max={3000}
            step={50}
            value={draft.speedMs}
            onChange={(value) => onChange({ ...draft, speedMs: value ?? 100 })}
          />
        </Field>
      </FieldGrid>
    </Section>
  );
}
