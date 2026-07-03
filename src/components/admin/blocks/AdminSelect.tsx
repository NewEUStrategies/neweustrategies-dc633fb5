// AdminSelect — drop-in odpowiednik natywnego <select> oparty o Radix
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
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: { target: { value: string } }) => void;
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

export function AdminSelect({
  value,
  defaultValue,
  onChange,
  disabled,
  className,
  placeholder,
  children,
  ...rest
}: Props) {
  const options = React.useMemo(() => collectOptions(children), [children]);
  const handle = (next: string) => {
    onChange?.({ target: { value: next } });
  };
  // Radix Select nie akceptuje pustego stringa jako wartości — użyj sentinela.
  const EMPTY = "__admin_select_empty__";
  const asStr = (v: string | number | undefined) => (v == null ? undefined : String(v));
  const val = value === "" || value === undefined ? (value === "" ? EMPTY : undefined) : asStr(value);
  const def = defaultValue === "" || defaultValue === undefined ? (defaultValue === "" ? EMPTY : undefined) : asStr(defaultValue);

  return (
    <Select
      value={val}
      defaultValue={def}
      onValueChange={(v) => handle(v === EMPTY ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={rest["aria-label"]}
        title={rest.title}
        className={cn("h-8 text-xs", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map((o, i) => (
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
  );
}

export default AdminSelect;
