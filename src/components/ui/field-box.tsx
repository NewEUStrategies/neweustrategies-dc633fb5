// Pole formularza w stylu "auth-section-2": etykieta wyswietlana po PRAWEJ
// stronie ramki i znikajaca w momencie, gdy uzytkownik zaczyna pisac.
// 6px rounding, kolory z tokenow popupu (--nl-*), dark/light bez hardkodow.
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

export interface FieldBoxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  /** Etykieta pokazywana po prawej stronie pola, dopoki jest puste. */
  label: string;
  /** Dodatkowy element po prawej (np. przycisk podgladu hasla). */
  trailing?: ReactNode;
  className?: string;
}

export const FieldBox = forwardRef<HTMLInputElement, FieldBoxProps>(function FieldBox(
  { label, trailing, className = "", value, required, ...rest },
  ref,
) {
  const id = useId();
  const filled = typeof value === "string" ? value.length > 0 : Boolean(value);

  return (
    <div
      className={`flex h-12 items-center gap-3 rounded-[6px] border px-4 transition-colors focus-within:border-[var(--nl-accent)] ${className}`}
      style={{
        borderColor: "color-mix(in srgb, var(--nl-fg) 18%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--nl-fg) 5%, transparent)",
      }}
    >
      <input
        {...rest}
        id={id}
        ref={ref}
        value={value}
        required={required}
        aria-label={label}
        className="min-w-0 flex-1 truncate bg-transparent text-sm outline-none"
        style={{ color: "var(--nl-fg)" }}
      />
      {trailing}
      {!filled && (
        <label
          htmlFor={id}
          className="shrink-0 cursor-text select-none whitespace-nowrap text-sm"
          style={{ color: "color-mix(in srgb, var(--nl-fg) 45%, transparent)" }}
        >
          {label}
          {required ? " *" : ""}
        </label>
      )}
    </div>
  );
});
