// Molecule: enter-animation preset + duration/delay/easing/distance + play-once toggle.
import { useTranslation } from "react-i18next";
import type { AdvancedSettings, MotionPreset, MotionEasing } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import "@/lib/i18n-builder";
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

// Labels for "none" / "ease-out" are localized at render (see t(...) overrides);
// the strings here are inert fallbacks.
const PRESETS: Array<[MotionPreset, string]> = [
  ["none", "None"],
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
  ["ease-out", "Ease-out"],
  ["ease", "Ease"],
  ["ease-in", "Ease-in"],
  ["ease-in-out", "Ease-in-out"],
  ["linear", "Linear"],
  ["spring", "Spring"],
  ["bounce", "Bounce"],
];

export function MotionControl({ value, onChange }: Props) {
  const { t } = useTranslation();
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
      <PropField label={t("builder.motion.effect")}>
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
                {v === "none" ? t("builder.motion.presetNone") : l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropField>
      <PropField label={t("builder.motion.easing")}>
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
                {v === "ease-out" ? t("builder.motion.easingEaseOutDefault") : l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropField>
      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.motion.duration")}>
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
        <PropField label={t("builder.motion.delay")}>
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
        <PropField label={t("builder.motion.distance")}>
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
        {t("builder.motion.playOnce")}
      </label>
    </div>
  );
}
