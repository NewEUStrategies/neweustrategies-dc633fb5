// Atom: unified color picker for widget properties.
// Delegates to AdminColorPicker so styling matches the rest of the admin.
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";

export function ColorInput({
  value,
  onChange,
  placeholder,
}: {
  value?: string;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
}) {
  return (
    <AdminColorPicker
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? "#000 / rgba(...) / transparent / var(--brand)"}
      allowReset={false}
    />
  );
}
