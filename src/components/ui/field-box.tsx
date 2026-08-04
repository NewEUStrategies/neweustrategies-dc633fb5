// Pole formularza popupu rejestracji - identyczne zachowanie jak w formularzach
// kontaktowych: platformowa etykieta pływająca (`.input-group` + `.user-label`),
// 6px rounding, wariant on-dark z chipem etykiety w kolorze tła popupu.
// Kolory pochodzą z tokenów popupu (--nl-*), więc dark/light działa bez hardkodów.
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

export interface FieldBoxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  /** Etykieta pływająca - w spoczynku wewnątrz pola, po focusie na ramce. */
  label: string;
  /** Dodatkowy element po prawej (np. przycisk podglądu hasła). */
  trailing?: ReactNode;
  className?: string;
  invalid?: boolean;
}

export const FieldBox = forwardRef<HTMLInputElement, FieldBoxProps>(function FieldBox(
  { label, trailing, className = "", required, invalid, ...rest },
  ref,
) {
  const id = useId();

  return (
    <div
      className={`input-group input-group--on-dark min-w-0 ${className}`}
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
        placeholder=" "
        className={`input${trailing ? " pr-11" : ""}`}
        style={{ color: "var(--nl-fg)" }}
      />
      <label htmlFor={id} className="user-label">
        {label}
        {required ? " *" : ""}
      </label>
      {trailing && (
        <span className="absolute right-2 top-1/2 z-10 -translate-y-1/2">{trailing}</span>
      )}
    </div>
  );
});
