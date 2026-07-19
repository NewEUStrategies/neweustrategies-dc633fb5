// Molecule: border editor (style/width/color/radius/box-shadow).
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import type { BorderSettings, BorderStyle } from "@/lib/builder/types";
import { Row, ColorInput, SidesInput } from "../atoms";
import "@/lib/i18n-builder";

interface Props {
  value: BorderSettings | undefined;
  onChange: (mut: (b: BorderSettings) => void) => void;
}

export function BorderEditor({ value, onChange }: Props) {
  const { t } = useTranslation();
  const b = value ?? {};
  return (
    <>
      <Row label={t("builder.border.type")}>
        <Select
          value={b.style ?? "none"}
          onValueChange={(v) =>
            onChange((x) => {
              x.style = v as BorderStyle;
            })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["none", "solid", "dashed", "dotted", "double", "groove"] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      {b.style && b.style !== "none" && (
        <>
          <Row label={t("builder.border.width")}>
            <SidesInput
              value={b.width}
              onChange={(w) =>
                onChange((x) => {
                  x.width = w;
                })
              }
            />
          </Row>
          <Row label={t("builder.common.color")}>
            <ColorInput
              value={b.color}
              onChange={(v) =>
                onChange((x) => {
                  x.color = v;
                })
              }
            />
          </Row>
        </>
      )}
      <Row label={t("builder.border.radius")}>
        <SidesInput
          value={b.radius}
          onChange={(r) =>
            onChange((x) => {
              x.radius = r;
            })
          }
        />
      </Row>
      <Row label={t("builder.border.shadow")} hint={t("builder.border.shadowHint")}>
        <Input
          value={b.boxShadow ?? ""}
          onChange={(e) =>
            onChange((x) => {
              x.boxShadow = e.target.value || undefined;
            })
          }
          className="h-8 text-xs font-mono"
        />
      </Row>
    </>
  );
}
