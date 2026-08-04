// Pole formularza popupu rejestracji. Dwa warianty etykiety, jedno API:
//  - "floating" (domyślny) - platformowa etykieta pływająca (`.input-group`
//    + `.user-label`), identyczna jak w formularzach kontaktowych,
//  - "inline" - etykieta po prawej wewnątrz ramki, 1:1 z projektem popupu.
// Oba: 6px rounding i kolory wyłącznie z tokenów popupu (--nl-*), więc paleta
// ciemna i jasna działają bez hardkodów. `onDark` przełącza chip etykiety
// pływającej na wariant on-dark (tło panelu zamiast --background).
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

export type FieldBoxVariant = "floating" | "inline";

export interface FieldBoxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  /** Etykieta - pływająca albo przyklejona po prawej (zależnie od wariantu). */
  label: string;
  /** Dodatkowy element po prawej (np. przycisk podglądu hasła). */
  trailing?: ReactNode;
  className?: string;
  invalid?: boolean;
  variant?: FieldBoxVariant;
  /** true = ciemna powierzchnia popupu (domyślnie), false = jasna. */
  onDark?: boolean;
}

export const FieldBox = forwardRef<HTMLInputElement, FieldBoxProps>(function FieldBox(
  {
    label,
    trailing,
    className = "",
    required,
    invalid,
    variant = "floating",
    onDark = true,
    ...rest
  },
  ref,
) {
  const id = useId();
  const labelText = `${label}${required ? " *" : ""}`;

  if (variant === "inline") {
    return (
      <div
        className={`field-inline ${className}`}
        data-invalid={invalid ? "true" : undefined}
        style={{ ["--ring" as string]: "var(--nl-accent, var(--ring))" }}
      >
        <input
          {...rest}
          id={id}
          ref={ref}
          required={required}
          aria-label={label}
          className="field-inline__input"
        />
        {trailing}
        {/* Etykieta jest wizualną powtórką aria-label pola - ukryta dla AT. */}
        <span className="field-inline__label" aria-hidden="true">
          {labelText}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`input-group ${onDark ? "input-group--on-dark " : ""}min-w-0 ${className}`}
      data-invalid={invalid ? "true" : undefined}
      style={{
        // Chip etykiety musi mieć pełne tło panelu popupu, a focus ring
        // przejmuje kolor akcentu z konfiguracji popupu.
        ["--input-group-chip-bg" as string]: "var(--nl-bg, #0b0b0f)",
        ["--ring" as string]: "var(--nl-accent, var(--ring))",
      }}
    >
      <input
        {...rest}
        id={id}
        ref={ref}
        required={required}
        placeholder={rest.placeholder ?? " "}
        className={`input${trailing ? " pr-11" : ""}`}
        style={{ color: "var(--nl-fg)" }}
      />
      <label htmlFor={id} className="user-label">
        {labelText}
      </label>
      {trailing && (
        <span className="absolute right-2 top-1/2 z-10 -translate-y-1/2">{trailing}</span>
      )}
    </div>
  );
});
