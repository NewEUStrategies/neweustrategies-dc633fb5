// Molekuła: pole "wiadomość" w widgetach formularzy - ten sam styl i ta sama
// walidacja co kompozytor komentarzy (pasek formatowania markdown, licznik
// znaków, blokada wysyłki przy pustej/za długiej treści), bez załączników.
//
// @wzmianki: opcjonalne (domyślnie włączone) autouzupełnianie osób - dokładnie
// ten sam hook i ta sama lista podpowiedzi co w komentarzach.
//
// i18n: `label` / `placeholder` przychodzą już przetłumaczone z call-site,
// etykiety paska narzędzi pochodzą z kluczy `comments.toolbar.*` (PL/EN).
import { useId, useRef, type CSSProperties } from "react";
import { ComposerShell } from "@/components/composer/ComposerShell";
import { MentionSuggestionList } from "@/components/mentions/MentionSuggestionList";
import { useMentionAutocomplete } from "@/lib/mentions/useMentionAutocomplete";
import type { ComposerValidation } from "@/lib/composer/validation";
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
  /** Minimalna długość treści po trim (domyślnie 1). */
  minLength?: number;
  /** Trwa wysyłka formularza - spójna blokada z komentarzami. */
  submitting?: boolean;
  /** Zgłasza wynik walidacji rodzicowi (przycisk "Wyślij" formularza). */
  onValidationChange?: (validation: ComposerValidation) => void;
  /** Podpowiedzi @wzmianek (domyślnie włączone). */
  mentions?: boolean;
  /** Język podpowiedzi @wzmianek. */
  lang?: "pl" | "en";
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
  minLength = 1,
  submitting = false,
  onValidationChange,
  mentions = true,
  lang = "pl",
  className,
  textareaClassName,
  textareaStyle,
  dataEditTarget,
}: MessageComposerFieldProps) {
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const statusId = `${fieldId}-status`;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const mention = useMentionAutocomplete({
    value,
    onChange,
    lang,
    enabled: mentions,
    textareaRef: ref,
  });

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
        minLength={minLength}
        submitting={submitting}
        onValidationChange={onValidationChange}
        statusId={statusId}
        bodyClassName="p-0"
      >
        <div className="relative">
          <textarea
            id={fieldId}
            ref={mention.setTextarea}
            value={value}
            placeholder={placeholder}
            required={required}
            rows={rows}
            maxLength={maxLength}
            aria-label={label}
            aria-describedby={statusId}
            data-edit-target={dataEditTarget}
            style={textareaStyle}
            {...(mentions ? mention.textareaProps : {})}
            onChange={(e) => {
              onChange(e.target.value);
              if (mentions) mention.handleValueChange(e.target);
            }}
            className={cn(
              "w-full resize-y border-0 bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:outline-none focus-visible:ring-0",
              textareaClassName,
            )}
          />
          {mentions && mention.open && (
            <MentionSuggestionList
              listId={mention.listId}
              suggestions={mention.suggestions}
              isFetching={mention.isFetching}
              highlight={mention.highlight}
              onHighlight={mention.setHighlight}
              onChoose={mention.choose}
            />
          )}
        </div>
      </ComposerShell>
    </div>
  );
}
