// Atom: native color picker + free-text input that accepts hex, css vars, oklch.
import { Input } from "@/components/ui/input";

interface Props {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
}

const isHex = (v: string): v is `#${string}` => /^#[0-9a-fA-F]{3,8}$/.test(v);

export function ColorField({ value, onChange, placeholder }: Props) {
  const v = value ?? "";
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={isHex(v) ? v.slice(0, 7) : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-8 rounded border border-border bg-transparent cursor-pointer shrink-0"
        aria-label="Wybierz kolor"
      />
      <Input
        value={v}
        placeholder={placeholder ?? "#000 / var(--brand)"}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="h-8 text-xs"
      />
    </div>
  );
}
