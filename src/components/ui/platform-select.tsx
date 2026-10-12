// PlatformSelect - shared native-select adapter built on Radix.
// (shadcn) `Select`. Zachowuje API zbliżone do <select value onChange>,
// czytając potomne <option value>Label</option>, tak by refactor edytora
// bloków sprowadzał się do zamiany tagu, bez zmiany logiki komponentów.
//
// Popup, klawiatura, focus i motyw (light/dark) pochodzą z Radix; wygląd
// zgadza się z resztą admin UI (design tokens: bg-popover, border, ring
// itp.) zamiast natywnego, gray-owego dropdownu przeglądarki.

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Props = {
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  "aria-describedby"?: string;
  "aria-required"?: boolean;
  id?: string;
  name?: string;
  required?: boolean;
  style?: React.CSSProperties;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: { target: { value: string } }) => void;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
  title?: string;
  children: React.ReactNode;
};

type OptionLike = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

function collectOptions(nodes: React.ReactNode): OptionLike[] {
  const out: OptionLike[] = [];
  React.Children.forEach(nodes, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === "option") {
      const p = child.props as {
        value?: string | number;
        children?: React.ReactNode;
        disabled?: boolean;
      };
      const value = p.value != null ? String(p.value) : "";
      out.push({ value, label: p.children ?? value, disabled: p.disabled });
    } else if (child.type === "optgroup") {
      out.push(...collectOptions((child.props as { children?: React.ReactNode }).children));
    }
  });
  return out;
}

export function PlatformSelect({
  value,
  defaultValue,
  onChange,
  onOpenChange,
  disabled,
  className,
  placeholder,
  children,
  ...rest
}: Props) {
  const options = React.useMemo(() => collectOptions(children), [children]);
  const [uncontrolledValue, setUncontrolledValue] = React.useState(() =>
    String(defaultValue ?? options.find((option) => !option.disabled)?.value ?? ""));
  const currentValue = value === undefined ? uncontrolledValue : String(value);
  const handle = (next: string) => {
    setUncontrolledValue(next);
    onChange?.({ target: { value: next } });
  };
  // Radix Select nie akceptuje pustego stringa jako wartości - użyj sentinela.
  const EMPTY = "__admin_select_empty__";
  const emptyPlaceholder = options.find((option) => option.value === "" && option.disabled);
  const val = currentValue === "" && !emptyPlaceholder ? EMPTY : currentValue;

  return (
    <>
    {rest.name && <input type="hidden" name={rest.name} value={currentValue} disabled={disabled} />}
    <Select
      value={val}
      onValueChange={(v) => handle(v === EMPTY ? "" : v)}
      onOpenChange={onOpenChange}
      disabled={disabled}
      required={rest.required}
    >
      <SelectTrigger
        id={rest.id}
        style={rest.style}
        aria-label={rest["aria-label"]}
        aria-invalid={rest["aria-invalid"]}
        aria-describedby={rest["aria-describedby"]}
        aria-required={rest["aria-required"] ?? rest.required}
        title={rest.title}
        className={cn("text-xs", className)}
      >
        <SelectValue placeholder={placeholder ?? emptyPlaceholder?.label} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.filter((o) => o !== emptyPlaceholder).map((o, i) => (
          <SelectItem
            key={`${o.value}-${i}`}
            value={o.value === "" ? EMPTY : o.value}
            disabled={o.disabled}
            className="text-xs"
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    </>
  );
}
