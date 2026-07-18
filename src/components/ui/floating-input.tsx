import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Floating-label input / textarea atom.
 *
 * Design (see `.input-group` in src/styles.css): 1.5px border, rounded 14px,
 * label parked inside the field and lifted to the border on focus or when the
 * field has a value. Uses semantic tokens (border / ring / destructive /
 * background / foreground / muted-foreground) so it themes in light + dark
 * and inherits the platform palette across public site, admin, and posts.
 *
 * i18n: the caller passes `label` (and optional `error`) already translated -
 * the component is a pure presentation atom, so PL/EN both flow through
 * `useTranslation()` at the call site.
 *
 * Accessibility: label is a real <label htmlFor>, id auto-generated when not
 * supplied. `aria-invalid` and `aria-describedby` are wired for the error.
 */

type BaseInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "placeholder">;

export interface FloatingInputProps extends BaseInputProps {
  label: string;
  error?: string | null;
  containerClassName?: string;
}

let __fidCounter = 0;
function useFallbackId(prefix: string, provided?: string) {
  const [id] = React.useState(() => provided ?? `${prefix}-${++__fidCounter}`);
  return id;
}

export const FloatingInput = React.forwardRef<HTMLInputElement, FloatingInputProps>(
  ({ label, error, id, className, containerClassName, required, ...rest }, ref) => {
    const inputId = useFallbackId("fi", id);
    const errorId = error ? `${inputId}-err` : undefined;
    return (
      <div
        className={cn("input-group", containerClassName)}
        data-invalid={error ? "true" : undefined}
      >
        <input
          {...rest}
          ref={ref}
          id={inputId}
          required={required}
          placeholder=" "
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={cn("input", className)}
        />
        <label htmlFor={inputId} className="user-label">
          {label}
        </label>
        {error ? (
          <p
            id={errorId}
            className="mt-1.5 pl-1 text-xs text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
FloatingInput.displayName = "FloatingInput";

type BaseTextareaProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "placeholder"
>;

export interface FloatingTextareaProps extends BaseTextareaProps {
  label: string;
  error?: string | null;
  containerClassName?: string;
}

export const FloatingTextarea = React.forwardRef<
  HTMLTextAreaElement,
  FloatingTextareaProps
>(({ label, error, id, className, containerClassName, required, rows = 4, ...rest }, ref) => {
  const inputId = useFallbackId("fta", id);
  const errorId = error ? `${inputId}-err` : undefined;
  return (
    <div
      className={cn("input-group", containerClassName)}
      data-invalid={error ? "true" : undefined}
    >
      <textarea
        {...rest}
        ref={ref}
        id={inputId}
        required={required}
        rows={rows}
        placeholder=" "
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={cn("input", className)}
      />
        <label htmlFor={inputId} className="user-label">
          {label}
        </label>
      {error ? (
        <p id={errorId} className="mt-1.5 pl-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});
FloatingTextarea.displayName = "FloatingTextarea";
