import { useId } from "react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { PlatformSelect } from "@/components/ui/platform-select";
import { cn } from "@/lib/utils";
import "@/lib/i18n-datetime-picker";

type TimeInputProps = Omit<ComponentProps<"input">, "type" | "value" | "onChange" | "ref"> & {
  type?: "time";
  value?: string;
  onChange?: (event: { target: { value: string } }) => void;
};

export function TimeInput({
  value = "",
  onChange,
  id,
  name,
  disabled,
  min,
  max,
  className,
  required,
  "aria-label": label,
  "aria-describedby": description,
}: TimeInputProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const [hour = "00", minute = "00"] = value.split(":");
  const allowed = (next: string) => (!min || next >= String(min)) && (!max || next <= String(max));
  const commit = (next: string) => {
    if (allowed(next)) onChange?.({ target: { value: next } });
  };
  return (
    <div
      className={cn("flex min-w-0 items-center gap-1", className)}
      role="group"
      aria-label={label}
    >
      <PlatformSelect
        id={id ?? generatedId}
        value={hour}
        disabled={disabled}
        required={required}
        aria-label={label ?? t("dateTimePicker.hour")}
        aria-describedby={description}
        onChange={(event) => commit(`${event.target.value}:${minute}`)}
        className="min-w-0 flex-1"
      >
        {Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0")).map((item) => (
          <option key={item} value={item} disabled={!allowed(`${item}:${minute}`)}>
            {item}
          </option>
        ))}
      </PlatformSelect>
      <span aria-hidden="true">:</span>
      <PlatformSelect
        value={minute}
        disabled={disabled}
        required={required}
        aria-label={t("dateTimePicker.minute")}
        onChange={(event) => commit(`${hour}:${event.target.value}`)}
        className="min-w-0 flex-1"
      >
        {Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0")).map((item) => (
          <option key={item} value={item} disabled={!allowed(`${hour}:${item}`)}>
            {item}
          </option>
        ))}
      </PlatformSelect>
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
    </div>
  );
}
