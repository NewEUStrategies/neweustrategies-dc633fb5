// Atom: 4-side box editor (top/right/bottom/left) for spacing/border.
import { Input } from "@/components/ui/input";
import type { BoxSides } from "@/lib/builder/types";

export function SidesInput({
  value,
  onChange,
  suffix = "px",
}: {
  value?: BoxSides;
  onChange: (v: BoxSides) => void;
  suffix?: string;
}) {
  const v = value ?? {};
  const upd = (k: keyof BoxSides, n: number | undefined) => onChange({ ...v, [k]: n });
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {(["top", "right", "bottom", "left"] as const).map((k) => (
        <div key={k}>
          <Input
            type="number"
            value={v[k] ?? ""}
            placeholder={k[0].toUpperCase()}
            onChange={(e) => upd(k, e.target.value === "" ? undefined : Number(e.target.value))}
            className="h-8 text-xs"
          />
          <div className="text-[9px] text-muted-foreground text-center mt-0.5">
            {k} ({suffix})
          </div>
        </div>
      ))}
    </div>
  );
}
