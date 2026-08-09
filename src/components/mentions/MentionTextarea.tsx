// Molekuła: FloatingTextarea + podpowiedzi @wzmianek (typeahead). Drop-in dla
// kompozytora komentarza - kontroluje wartość (string), a całą logikę tokenu
// „@..." pod kursorem, klawiatury i ARIA dostarcza współdzielony hook
// `useMentionAutocomplete` (ten sam, którego używa pole "wiadomość"
// w widgetach formularzy).
import { type MutableRefObject } from "react";
import { FloatingTextarea } from "@/components/ui/floating-input";
import { MentionSuggestionList } from "@/components/mentions/MentionSuggestionList";
import { useMentionAutocomplete } from "@/lib/mentions/useMentionAutocomplete";
import { ensureI18n } from "@/lib/i18n-mentions";

ensureI18n();

interface MentionTextareaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  lang: "pl" | "en";
  rows?: number;
  maxLength?: number;
  id?: string;
  autoFocus?: boolean;
  /** Dostęp do elementu textarea (pasek formatowania w kompozytorze). */
  textareaRef?: MutableRefObject<HTMLTextAreaElement | null>;
  /** Oznaczenie błędu walidacji (np. treść ponad limit). */
  invalid?: boolean;
  /** Id opisu błędu / podpowiedzi dla czytników ekranu. */
  describedBy?: string;
}

export function MentionTextarea({
  label,
  value,
  onChange,
  lang,
  rows = 4,
  maxLength,
  id,
  autoFocus,
  textareaRef,
  invalid,
  describedBy,
}: MentionTextareaProps) {
  const mention = useMentionAutocomplete({ value, onChange, lang, textareaRef });

  return (
    <div className="relative">
      <FloatingTextarea
        ref={mention.setTextarea}
        id={id}
        label={label}
        value={value}
        rows={rows}
        maxLength={maxLength}
        lang={lang}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        {...mention.textareaProps}
        onKeyDown={(event) => {
          // Enter kontynuuje wyliczenie - ale nigdy wtedy, gdy otwarta jest
          // lista podpowiedzi @wzmianek (tam Enter wybiera osobę).
          if (!mention.open) {
            const target = event.currentTarget;
            const result = applyListAutoformat(
              target.value,
              target.selectionStart ?? target.value.length,
              target.selectionEnd ?? target.value.length,
              event.key,
            );
            if (result !== null) {
              event.preventDefault();
              onChange(result.value);
              requestAnimationFrame(() => {
                target.setSelectionRange(result.cursor, result.cursor);
              });
              return;
            }
          }
          mention.textareaProps.onKeyDown(event);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          mention.handleValueChange(e.target);
        }}
      />
      {mention.open && (
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
  );
}
