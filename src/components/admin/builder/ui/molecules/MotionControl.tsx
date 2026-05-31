// Molecule: enter-animation preset + duration/delay + play-once toggle.
import type { AdvancedSettings, MotionPreset } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PropField } from "../atoms/PropField";

interface Props {
  value: AdvancedSettings | undefined;
  onChange: (mut: (a: AdvancedSettings) => void) => void;
}

const PRESETS: Array<[MotionPreset, string]> = [
  ["none", "Brak"], ["fade", "Fade"],
  ["slide-up", "Slide up"], ["slide-down", "Slide down"],
  ["slide-left", "Slide left"], ["slide-right", "Slide right"],
  ["zoom", "Zoom in"], ["zoom-out", "Zoom out"], ["bounce", "Bounce"],
];

export function MotionControl({ value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <PropField label="Efekt wejścia">
        <Select
          value={value?.animation ?? "none"}
          onValueChange={(v) => onChange((a) => { a.animation = v as MotionPreset; })}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PRESETS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
      </PropField>
      <div className="grid grid-cols-2 gap-2">
        <PropField label="Czas (ms)">
          <Input
            type="number" min={0} step={50}
            value={value?.animationDuration ?? ""}
            placeholder="600"
            onChange={(e) => onChange((a) => {
              const n = Number(e.target.value);
              a.animationDuration = Number.isFinite(n) && n >= 0 ? n : undefined;
            })}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label="Opóźnienie (ms)">
          <Input
            type="number" min={0} step={50}
            value={value?.animationDelay ?? ""}
            placeholder="0"
            onChange={(e) => onChange((a) => {
              const n = Number(e.target.value);
              a.animationDelay = Number.isFinite(n) && n >= 0 ? n : undefined;
            })}
            className="h-8 text-xs"
          />
        </PropField>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={value?.animationOnce !== false}
          onChange={(e) => onChange((a) => { a.animationOnce = e.target.checked; })}
        />
        Odtwarzaj tylko raz
      </label>
    </div>
  );
}
