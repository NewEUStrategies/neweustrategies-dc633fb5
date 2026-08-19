import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface BilingualRowProps {
  label: string;
  pl: string;
  en: string;
  onPl: (value: string) => void;
  onEn: (value: string) => void;
  placeholderPl?: string;
  placeholderEn?: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
}

/** Wspólny atom pary pól PL/EN używany przez panele administracyjne. */
export function BilingualRow({
  label,
  pl,
  en,
  onPl,
  onEn,
  placeholderPl,
  placeholderEn,
  hint,
  multiline = false,
  rows = 3,
  disabled = false,
}: BilingualRowProps) {
  const groupId = useId();
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(
          [
            { code: "PL", value: pl, onChange: onPl, placeholder: placeholderPl },
            { code: "EN", value: en, onChange: onEn, placeholder: placeholderEn },
          ] as const
        ).map((field) => {
          const id = `${groupId}-${field.code}`;
          return (
            <div key={field.code} className="min-w-0">
              <Label htmlFor={id}>
                {label} ({field.code})
              </Label>
              {multiline ? (
                <Textarea
                  id={id}
                  rows={rows}
                  value={field.value}
                  disabled={disabled}
                  onChange={(event) => field.onChange(event.target.value)}
                  placeholder={field.placeholder}
                />
              ) : (
                <Input
                  id={id}
                  value={field.value}
                  disabled={disabled}
                  onChange={(event) => field.onChange(event.target.value)}
                  placeholder={field.placeholder}
                />
              )}
            </div>
          );
        })}
      </div>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
