// Reusable field primitives for the admin settings tabs.
// Admin uses an external-label two-column layout (label on the left, control
// on the right) rather than floating labels, which suit dense config forms
// better. To stay aligned with the platform-wide input system we render the
// `<input>` with the shared `.input` class (same border/radius/ring tokens as
// FloatingInput), and swap the raw checkbox for the animated `Checkbox`.
import type { ReactNode } from "react";
import { AdminSelect } from "@/components/admin/blocks/AdminSelect";
import { Checkbox as AnimatedCheckbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

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
  const { className, type = "text", ...rest } = props;
  return <input type={type} {...rest} className={cn("input w-full", className)} />;
}

export function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input type="number" {...rest} className={cn("input w-32", className)} />;
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
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
      <AnimatedCheckbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <span>{label}</span>
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
