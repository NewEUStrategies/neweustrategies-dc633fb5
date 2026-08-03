// Molekuła: pole "wiadomość" w widgetach formularzy - ten sam styl co
// kompozytor komentarzy (pasek formatowania markdown + licznik znaków),
// bez załączników i @wzmianek.
//
// i18n: `label` / `placeholder` przychodzą już przetłumaczone z call-site,
// etykiety paska narzędzi pochodzą z kluczy `comments.toolbar.*` (PL/EN).
import { useId, useRef, type CSSProperties } from "react";
import { ComposerShell } from "@/components/composer/ComposerShell";
import { cn } from "@/lib/utils";

export interface MessageComposerFieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  id?: string;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  maxLength?: number;
  className?: string;
  textareaClassName?: string;
  textareaStyle?: CSSProperties;
  /** Cel edycji w builderze (klik w pole otwiera panel widgetu). */
  dataEditTarget?: string;
}

export function MessageComposerField({
  label,
  value,
  onChange,
  id,
  placeholder,
  required,
  rows = 5,
  maxLength = 2000,
  className,
  textareaClassName,
  textareaStyle,
  dataEditTarget,
}: MessageComposerFieldProps) {
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const ref = useRef<HTMLTextAreaElement | null>(null);

  return (
    <div className={cn("w-full", className)}>
      <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </label>
      <ComposerShell
        value={value}
        onValueChange={onChange}
        textareaRef={ref}
        maxLength={maxLength}
        bodyClassName="p-0"
      >
        <textarea
          id={fieldId}
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          rows={rows}
          maxLength={maxLength}
          aria-label={label}
          data-edit-target={dataEditTarget}
          style={textareaStyle}
          className={cn(
            "w-full resize-y border-0 bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:outline-none focus-visible:ring-0",
            textareaClassName,
          )}
        />
      </ComposerShell>
    </div>
  );
}
