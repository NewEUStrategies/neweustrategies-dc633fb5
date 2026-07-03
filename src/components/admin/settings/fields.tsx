// Reusable field primitives for the admin settings tabs.
import type { ReactNode } from "react";
import { AdminSelect } from "@/components/admin/blocks/AdminSelect";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid md:grid-cols-[200px_1fr] gap-3 md:gap-6 py-4 border-b border-border last:border-0">
      <label className="text-sm font-medium pt-2">{label}</label>
      <div className="min-w-0">
        {children}
        {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export function Text(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="text"
      {...props}
      className={`w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${props.className ?? ""}`}
    />
  );
}

export function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="number"
      {...props}
      className={`w-32 bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  // Delegate to AdminSelect (Radix/shadcn) so every settings dropdown matches
  // the rest of the admin UI (bg-popover, border, ring, dark mode) instead of
  // the browser's native gray dropdown.
  const { value, defaultValue, onChange, disabled, className, title, children } = props;
  const ariaLabel = props["aria-label"];
  return (
    <AdminSelect
      value={value as string | number | undefined}
      defaultValue={defaultValue as string | number | undefined}
      onChange={(e) => {
        onChange?.({
          target: { value: e.target.value },
          currentTarget: { value: e.target.value },
        } as unknown as React.ChangeEvent<HTMLSelectElement>);
      }}
      disabled={disabled}
      className={`h-10 text-sm w-full ${className ?? ""}`}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </AdminSelect>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-border"
      />
      {label}
    </label>
  );
}

export function SaveBar({
  saving,
  disabled,
  onSave,
}: {
  saving: boolean;
  disabled?: boolean;
  onSave: () => void;
}) {
  return (
    <div className="mt-6 flex items-center gap-3">
      <button
        type="button"
        onClick={onSave}
        disabled={saving || disabled}
        className="bg-brand text-brand-foreground px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
      >
        {saving ? "Zapisywanie…" : "Zapisz zmiany"}
      </button>
    </div>
  );
}
