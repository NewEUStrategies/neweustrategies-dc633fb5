// Organism: editor for the large translucent list-index numerals (01, 02, 03).
import { useTranslation } from "react-i18next";
import { NumberInput } from "@/components/admin/builder/ui/atoms";
import { Section, FieldGrid, Field, PreviewFrame } from "../../atoms";
import { ColorControl } from "../../molecules";
import type { SectionEditorProps } from "../../types";
import "@/lib/i18n-admin-theme-design";

export function ListIndexSection({ draft, set, setColor, previewMode }: SectionEditorProps) {
  const { t } = useTranslation();
  const li = draft.listIndex;
  return (
    <Section title={t("adminThemeDesign.sections.listIndex")}>
      <p className="text-xs text-muted-foreground -mt-2">{t("adminThemeDesign.desc.listIndex")}</p>
      <FieldGrid>
        <Field label={t("adminThemeDesign.f.colorLight")}>
          <ColorControl section="listIndex" field="colorLight" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.colorDark")}>
          <ColorControl section="listIndex" field="colorDark" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.opacity")}>
          <NumberInput
            step={0.01}
            min={0}
            max={1}
            value={li.opacity}
            onChange={(value) => set("listIndex", { opacity: Math.max(0, Math.min(1, value ?? 0)) })}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.weight")}>
          <NumberInput
            value={li.weight}
            onChange={(value) => set("listIndex", { weight: value ?? 800 })}
            min={100}
            max={1000}
            step={100}
          />
        </Field>
      </FieldGrid>
      <PreviewFrame>
        <div className="flex items-center gap-6">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className="font-display tabular-nums leading-none"
              style={{
                fontSize: "72px",
                fontWeight: li.weight,
                color: li.colorLight,
                opacity: li.opacity,
              }}
            >
              {String(n).padStart(2, "0")}
            </span>
          ))}
        </div>
      </PreviewFrame>
    </Section>
  );
}
