// Atom: a three-way toggle for "inherit global / force on / force off". Maps a
// nullable boolean (undefined|null = inherit, true = on, false = off) to a
// small select. Fully generic and label-driven, so callers supply i18n text.
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export interface TriStateLabels {
  inherit: string;
  on: string;
  off: string;
}

export function TriStateSelect({
  value,
  onChange,
  labels,
  className = "h-7 w-32 text-xs",
}: {
  /** undefined | null = inherit from global; true = on; false = off. */
  value: boolean | null | undefined;
  /** undefined = clear the override (inherit); boolean = force it. */
  onChange: (value: boolean | undefined) => void;
  labels: TriStateLabels;
  className?: string;
}) {
  const tri = value === true ? "on" : value === false ? "off" : "inherit";
  return (
    <Select value={tri} onValueChange={(v) => onChange(v === "inherit" ? undefined : v === "on")}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="inherit">{labels.inherit}</SelectItem>
        <SelectItem value="on">{labels.on}</SelectItem>
        <SelectItem value="off">{labels.off}</SelectItem>
      </SelectContent>
    </Select>
  );
}
