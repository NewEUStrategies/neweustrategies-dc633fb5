// Molecule: shape divider editor (type/color/size/flip).
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import type { ShapeDividerSettings, ShapeDividerType } from "@/lib/builder/types";
import { Row, ColorInput, NumberInput } from "../atoms";
import "@/lib/i18n-builder";

interface Props {
  value: ShapeDividerSettings | undefined;
  onChange: (mut: (s: ShapeDividerSettings) => void) => void;
}

export function ShapeEditor({ value, onChange }: Props) {
  const { t } = useTranslation();
  const s = value ?? {};
  return (
    <>
      <Row label={t("builder.shape.style")}>
        <Select
          value={s.type ?? "none"}
          onValueChange={(v) =>
            onChange((x) => {
              x.type = v as ShapeDividerType;
            })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              [
                "none",
                "mountains",
                "drops",
                "clouds",
                "zigzag",
                "pyramids",
                "triangle",
                "tilt",
                "waves",
                "curve",
                "split",
                "arrow",
                "book",
              ] as const
            ).map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      {s.type && s.type !== "none" && (
        <>
          <Row label={t("builder.common.color")}>
            <ColorInput
              value={s.color}
              onChange={(v) =>
                onChange((x) => {
                  x.color = v;
                })
              }
            />
          </Row>
          <Row label={t("builder.shape.height")}>
            <NumberInput
              value={s.height}
              onChange={(n) =>
                onChange((x) => {
                  x.height = n;
                })
              }
              min={1}
              max={500}
              suffix="px"
            />
          </Row>
          <Row label={t("builder.shape.width")}>
            <NumberInput
              value={s.width}
              onChange={(n) =>
                onChange((x) => {
                  x.width = n;
                })
              }
              min={100}
              max={300}
              suffix="%"
            />
          </Row>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={!!s.flipH}
                onChange={(e) =>
                  onChange((x) => {
                    x.flipH = e.target.checked;
                  })
                }
              />{" "}
              Flip H
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={!!s.flipV}
                onChange={(e) =>
                  onChange((x) => {
                    x.flipV = e.target.checked;
                  })
                }
              />{" "}
              Invert
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={!!s.bringToFront}
                onChange={(e) =>
                  onChange((x) => {
                    x.bringToFront = e.target.checked;
                  })
                }
              />{" "}
              {t("builder.shape.bringToFront")}
            </label>
          </div>
        </>
      )}
    </>
  );
}
