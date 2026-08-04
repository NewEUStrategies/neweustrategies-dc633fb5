// Pole formularza popupu rejestracji - DOKŁADNIE to samo zachowanie co w
// formularzach kontaktowych: platformowa etykieta pływająca (`.input-group` +
// `.user-label`). W spoczynku etykieta (i18n) siedzi wewnątrz pola, a gdy
// użytkownik zaczyna pisać, wskakuje na ramkę i robi miejsce na wartość;
// opcjonalny placeholder odsłania się dopiero po focusie.
//
// Kolory nie są tu hardkodowane: panel popupu przedefiniowuje tokeny platformy
// (--background/--foreground/--border/--ring/--gc-input-*) na swoją paletę, więc
// pole wygląda identycznie na stronie publicznej i w podglądzie w adminie,
// w wariancie ciemnym i jasnym. Rounding: platformowe 6px.
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

export interface FieldBoxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  /** Etykieta pływająca - w spoczynku w polu, po focusie na ramce. */
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
    <div className={`input-group min-w-0 ${className}`} data-invalid={invalid ? "true" : undefined}>
      <input
        {...rest}
        id={id}
        ref={ref}
        required={required}
        /* Spacer, gdy pole nie ma własnej podpowiedzi: `:placeholder-shown`
           musi pozostać prawdziwe, bo na nim stoi cała mechanika pływania. */
        placeholder={rest.placeholder ?? " "}
        className={`input${trailing ? " pr-11" : ""}`}
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
