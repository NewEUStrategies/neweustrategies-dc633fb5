// Atom: unified admin color picker + free-text input that accepts hex, css vars, oklch.
// Delegates to AdminColorPicker for consistent look & feel across the platform.
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";

interface Props {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
  /** Color actually applied when no override is set (resolved from global colors / cascade). */
  inheritedValue?: string;
}

export function ColorField({ value, onChange, placeholder, inheritedValue }: Props) {
  return (
    <AdminColorPicker
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      inheritedValue={inheritedValue}
    />
  );
}
