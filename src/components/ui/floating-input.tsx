import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Floating-label input / textarea atom.
 *
 * Design (see `.input-group` in src/styles.css): 1.5px border, rounded 6px,
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

/**
 * Spacer used when the caller supplies no placeholder.
 *
 * The floating label lifts on `:focus` OR `:not(:placeholder-shown)`. A control
 * WITHOUT a placeholder attribute never matches `:placeholder-shown`, so the
 * label would be stuck on the border forever. A single space keeps
 * `:placeholder-shown` true for an empty field while rendering nothing - which
 * is exactly the behaviour this atom had before real placeholders landed.
 */
export const FLOATING_LABEL_SPACER = " ";

/**
 * Normalise a caller-supplied placeholder for the floating-label pattern.
 *
 * A real placeholder is passed through verbatim, so the value the editor typed
 * in the widget panel actually reaches the DOM. It stays invisible while the
 * field is idle (`.input-group > .input:not(:focus)::placeholder` paints it
 * transparent) so it never collides with the resting label, and it appears as
 * a hint once the field takes focus and the label has lifted away.
 *
 * Empty / whitespace-only input falls back to {@link FLOATING_LABEL_SPACER}.
 */
export function floatingPlaceholder(value?: string | null): string {
  return typeof value === "string" && value.trim() !== "" ? value : FLOATING_LABEL_SPACER;
}

export interface FloatingInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  containerClassName?: string;
  labelEditTarget?: string;
}

let __fidCounter = 0;
function useFallbackId(prefix: string, provided?: string) {
  const [id] = React.useState(() => provided ?? `${prefix}-${++__fidCounter}`);
  return id;
}

export const FloatingInput = React.forwardRef<HTMLInputElement, FloatingInputProps>(
  (
    {
      label,
      error,
      id,
      className,
      containerClassName,
      required,
      labelEditTarget,
      placeholder,
      ...rest
    },
    ref,
  ) => {
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
          placeholder={floatingPlaceholder(placeholder)}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={cn("input", className)}
        />
        <label htmlFor={inputId} className="user-label" data-edit-target={labelEditTarget}>
          {label}
        </label>
        {error ? (
          <p id={errorId} className="mt-1.5 pl-1 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
FloatingInput.displayName = "FloatingInput";

export interface FloatingTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string | null;
  containerClassName?: string;
}

export const FloatingTextarea = React.forwardRef<HTMLTextAreaElement, FloatingTextareaProps>(
  (
    { label, error, id, className, containerClassName, required, rows = 4, placeholder, ...rest },
    ref,
  ) => {
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
          placeholder={floatingPlaceholder(placeholder)}
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
  },
);
FloatingTextarea.displayName = "FloatingTextarea";
