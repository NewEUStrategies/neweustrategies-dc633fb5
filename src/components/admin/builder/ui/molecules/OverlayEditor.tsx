// Molecule: overlay editor (background + opacity + blend mode).
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { OverlaySettings } from "@/lib/builder/types";
import { Row, NumberInput } from "../atoms";
import { BackgroundEditor } from "./BackgroundEditor";

interface Props {
  value: OverlaySettings | undefined;
  onChange: (mut: (o: OverlaySettings) => void) => void;
}

export function OverlayEditor({ value, onChange }: Props) {
  const o = value ?? {};
  return (
    <>
      <BackgroundEditor value={value} onChange={onChange} />
      {o.type && o.type !== "none" && (
        <>
          <Row label="Przezroczystość (0–1)">
            <NumberInput
              value={o.opacity}
              step={0.05}
              min={0}
              max={1}
              onChange={(n) =>
                onChange((x) => {
                  x.opacity = n;
                })
              }
            />
          </Row>
          <Row label="Tryb mieszania">
            <Select
              value={o.blendMode ?? "normal"}
              onValueChange={(v) =>
                onChange((x) => {
                  x.blendMode = v as OverlaySettings["blendMode"];
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    "normal",
                    "multiply",
                    "screen",
                    "overlay",
                    "darken",
                    "lighten",
                    "color-dodge",
                    "saturation",
                    "color",
                    "difference",
                    "exclusion",
                    "hue",
                    "luminosity",
                  ] as const
                ).map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        </>
      )}
    </>
  );
}
