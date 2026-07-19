// Molecule: hover-state editor (bg, text, transform, shadow, transition).
import { useTranslation } from "react-i18next";
import type { HoverStyle } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { PropField } from "../atoms/PropField";
import { ColorField } from "../atoms/ColorField";
import "@/lib/i18n-builder";

interface Props {
  value: HoverStyle | undefined;
  onChange: (next: HoverStyle | undefined) => void;
}

export function HoverControl({ value, onChange }: Props) {
  const { t } = useTranslation();
  const v = value ?? {};
  const set = (patch: Partial<HoverStyle>) => onChange({ ...v, ...patch });
  const enabled = !!value;

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            onChange(e.target.checked ? (value ?? { transitionMs: 200 }) : undefined)
          }
        />
        {t("builder.hover.enable")}
      </label>

      {enabled && (
        <>
          <PropField label={t("builder.hover.bg")}>
            <ColorField value={v.bgColor} onChange={(bgColor) => set({ bgColor })} />
          </PropField>
          <PropField label={t("builder.hover.text")}>
            <ColorField value={v.textColor} onChange={(textColor) => set({ textColor })} />
          </PropField>
          <div className="grid grid-cols-2 gap-2">
            <PropField label={t("builder.hover.scale")}>
              <Input
                type="number"
                step={0.01}
                min={0.5}
                max={2}
                value={v.scale ?? ""}
                placeholder="1.03"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  set({ scale: Number.isFinite(n) && n > 0 ? n : undefined });
                }}
                className="h-8 text-xs"
              />
            </PropField>
            <PropField label="Translate Y">
              <Input
                value={v.translateY ?? ""}
                placeholder="-2px"
                onChange={(e) => set({ translateY: e.target.value || undefined })}
                className="h-8 text-xs"
              />
            </PropField>
          </div>
          <PropField label="Border radius (hover)">
            <Input
              value={v.borderRadius ?? ""}
              placeholder="10px"
              onChange={(e) => set({ borderRadius: e.target.value || undefined })}
              className="h-8 text-xs"
            />
          </PropField>
          <PropField label={t("builder.hover.shadow")}>
            <Input
              value={v.shadow ?? ""}
              placeholder="0 8px 24px rgba(0,0,0,.18)"
              onChange={(e) => set({ shadow: e.target.value || undefined })}
              className="h-8 text-xs"
            />
          </PropField>
          <PropField label={t("builder.hover.transition")}>
            <Input
              type="number"
              min={0}
              step={20}
              value={v.transitionMs ?? ""}
              placeholder="200"
              onChange={(e) => {
                const n = Number(e.target.value);
                set({ transitionMs: Number.isFinite(n) && n >= 0 ? n : undefined });
              }}
              className="h-8 text-xs"
            />
          </PropField>
        </>
      )}
    </div>
  );
}
