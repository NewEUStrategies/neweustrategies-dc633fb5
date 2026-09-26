// Atrapy prymitywów UI dla testów PLANU SALI.
//
// Radix Select, Dialog i Popover nie działają pod happy-dom bez pełnego pointer
// API (ten sam powód, co w `RegistrationsListPanel.test.tsx`). Atrapy są
// natywne i zachowują KONTRAKT, na którym stoją asercje:
//   - `FormSelect` -> `<select>` z tym samym `id`, `aria-label` i `disabled`,
//     więc `<label htmlFor>` i `getByRole("combobox", { name })` działają;
//   - `Dialog` -> treść istnieje TYLKO przy `open` (portal nie jest montowany),
//     a przycisk `okno-zamknij` woła `onOpenChange(false)` jak Escape;
//   - `Popover` -> treść zawsze w drzewie (menu eksportu to lista przycisków).
// Użycie: `vi.mock("@/components/ui/dialog", async () =>
//   (await import("@/test/events/seatingUiMocks")).dialogModule())`.
import type { ReactNode } from "react";

export interface FormSelectStubProps {
  id?: string;
  value: string;
  options: readonly { value: string; label: ReactNode; disabled?: boolean }[];
  onValueChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}

export function formSelectModule(): { FormSelect: (props: FormSelectStubProps) => ReactNode } {
  return {
    FormSelect: ({
      id,
      value,
      options,
      onValueChange,
      disabled,
      placeholder,
      "aria-label": ariaLabel,
    }: FormSelectStubProps) => (
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {placeholder === undefined ? null : <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  };
}

interface Children {
  children?: ReactNode;
}

export function dialogModule(): Record<string, (props: never) => ReactNode> {
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: Children & { open: boolean; onOpenChange?: (open: boolean) => void }) =>
      open ? (
        <div>
          <button type="button" data-testid="okno-zamknij" onClick={() => onOpenChange?.(false)} />
          {children}
        </div>
      ) : null,
    DialogContent: ({ children }: Children) => <div role="dialog">{children}</div>,
    DialogHeader: ({ children }: Children) => <div>{children}</div>,
    DialogFooter: ({ children }: Children) => <div>{children}</div>,
    DialogTitle: ({ children }: Children) => <h2>{children}</h2>,
    DialogDescription: ({ children }: Children) => <p>{children}</p>,
  };
}

export function popoverModule(): Record<string, (props: never) => ReactNode> {
  return {
    Popover: ({ children }: Children) => <div>{children}</div>,
    PopoverTrigger: ({ children }: Children) => <>{children}</>,
    PopoverContent: ({ children }: Children) => <div data-testid="popover">{children}</div>,
  };
}
