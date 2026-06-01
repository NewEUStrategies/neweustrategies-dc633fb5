// Atom: hex color picker + free text input combo.
import { Input } from "@/components/ui/input";

export function ColorInput({ value, onChange, placeholder }: { value?: string; onChange: (v: string | undefined) => void; placeholder?: string }) {
  return (
    <div className="flex gap-2">
      <input
        type="color"
        value={value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 rounded border border-border bg-background cursor-pointer"
      />
      <Input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder={placeholder ?? "#000 / rgba(...) / var(--brand)"}
        className="h-8 text-xs flex-1"
      />
    </div>
  );
}
