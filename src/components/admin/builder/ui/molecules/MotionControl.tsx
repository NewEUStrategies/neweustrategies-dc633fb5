// Molecule: enter-animation preset + duration/delay/easing/distance + play-once toggle.
import type { AdvancedSettings, MotionPreset, MotionEasing } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PropField } from "../atoms/PropField";

interface Props {
  value: AdvancedSettings | undefined;
  onChange: (mut: (a: AdvancedSettings) => void) => void;
}

const PRESETS: Array<[MotionPreset, string]> = [
  ["none", "Brak"],
  ["fade", "Fade"],
  ["slide-up", "Slide up"],
  ["slide-down", "Slide down"],
  ["slide-left", "Slide left"],
  ["slide-right", "Slide right"],
  ["zoom", "Zoom in"],
  ["zoom-out", "Zoom out"],
  ["bounce", "Bounce"],
  ["flip-x", "Flip X"],
  ["flip-y", "Flip Y"],
  ["rotate", "Rotate"],
  ["skew", "Skew"],
  ["blur", "Blur in"],
  ["reveal-up", "Reveal up"],
  ["reveal-down", "Reveal down"],
  ["tilt", "Tilt"],
  ["swing", "Swing"],
  ["pulse", "Pulse"],
  ["rubber", "Rubber"],
];

const EASINGS: Array<[MotionEasing, string]> = [
  ["ease-out", "Ease-out (domyślnie)"],
  ["ease", "Ease"],
  ["ease-in", "Ease-in"],
  ["ease-in-out", "Ease-in-out"],
  ["linear", "Linear"],
  ["spring", "Spring"],
  ["bounce", "Bounce"],
];

export function MotionControl({ value, onChange }: Props) {
  const usesDistance = [
    "slide-up",
    "slide-down",
    "slide-left",
    "slide-right",
    "bounce",
    "reveal-up",
    "reveal-down",
  ].includes(value?.animation ?? "");
  return (
    <div className="space-y-2">
      <PropField label="Efekt wejścia">
        <Select
          value={value?.animation ?? "none"}
          onValueChange={(v) =>
            onChange((a) => {
              a.animation = v as MotionPreset;
            })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map(([v, l]) => (
              <SelectItem key={v} value={v} className="text-xs">
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropField>
      <PropField label="Krzywa (easing)">
        <Select
          value={value?.animationEasing ?? "ease-out"}
          onValueChange={(v) =>
            onChange((a) => {
              a.animationEasing = v as MotionEasing;
            })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EASINGS.map(([v, l]) => (
              <SelectItem key={v} value={v} className="text-xs">
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropField>
      <div className="grid grid-cols-2 gap-2">
        <PropField label="Czas (ms)">
          <Input
            type="number"
            min={0}
            step={50}
            value={value?.animationDuration ?? ""}
            placeholder="600"
            onChange={(e) =>
              onChange((a) => {
                const n = Number(e.target.value);
                a.animationDuration = Number.isFinite(n) && n >= 0 ? n : undefined;
              })
            }
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label="Opóźnienie (ms)">
          <Input
            type="number"
            min={0}
            step={50}
            value={value?.animationDelay ?? ""}
            placeholder="0"
            onChange={(e) =>
              onChange((a) => {
                const n = Number(e.target.value);
                a.animationDelay = Number.isFinite(n) && n >= 0 ? n : undefined;
              })
            }
            className="h-8 text-xs"
          />
        </PropField>
      </div>
      {usesDistance && (
        <PropField label="Dystans (px)">
          <Input
            type="number"
            min={0}
            max={400}
            step={4}
            value={value?.animationDistance ?? ""}
            placeholder="24"
            onChange={(e) =>
              onChange((a) => {
                const n = Number(e.target.value);
                a.animationDistance = Number.isFinite(n) && n >= 0 ? n : undefined;
              })
            }
            className="h-8 text-xs"
          />
        </PropField>
      )}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={value?.animationOnce !== false}
          onChange={(e) =>
            onChange((a) => {
              a.animationOnce = e.target.checked;
            })
          }
        />
        Odtwarzaj tylko raz
      </label>
    </div>
  );
}
