// Atomy edytora popupu rejestracji. Wszystkie etykiety przychodzą z zewnątrz
// (i18n po stronie zakładek), więc te komponenty są czysto prezentacyjne.
import { useEffect, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { colorLuminance } from "@/lib/newsletter/popupDesign";

export function SectionCard({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-md border border-border p-3.5">
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {icon}
          {title}
        </div>
        {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

export function TextRow({
  label,
  value,
  onChange,
  placeholder,
  hint,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
}) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
      />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Wybór ikony z biblioteki platformy (ten sam picker co w builderze, więc
 * katalog i konwencja nazw są wspólne). Pusta wartość = przycisk bez ikony,
 * dlatego obok pickera stoi jawny „Bez ikony" - inaczej nie dałoby się cofnąć
 * wyboru po jednorazowym kliknięciu.
 */
export function IconRow({
  label,
  value,
  onChange,
  hint,
  clearLabel,
  previewLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  clearLabel: string;
  previewLabel: string;
}) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <LucideIconPicker value={value || undefined} onChange={(v) => onChange(v ?? "")} />
        </div>
        <span className="inline-flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          {previewLabel}
          {value ? (
            <DynamicIcon name={value} className="h-4 w-4" aria-hidden />
          ) : (
            <span aria-hidden>-</span>
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!value}
          onClick={() => onChange("")}
        >
          {clearLabel}
        </Button>
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Para pól PL/EN - najczęstszy wzorzec w tym edytorze. */
export function BilingualRow({
  label,
  pl,
  en,
  onPl,
  onEn,
  placeholderPl,
  placeholderEn,
  hint,
  multiline,
  rows = 3,
}: {
  label: string;
  pl: string;
  en: string;
  onPl: (v: string) => void;
  onEn: (v: string) => void;
  placeholderPl?: string;
  placeholderEn?: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
}) {
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(
          [
            { code: "PL", value: pl, onChange: onPl, placeholder: placeholderPl },
            { code: "EN", value: en, onChange: onEn, placeholder: placeholderEn },
          ] as const
        ).map((f) => (
          <div key={f.code} className="min-w-0">
            <Label>
              {label} ({f.code})
            </Label>
            {multiline ? (
              <Textarea
                rows={rows}
                value={f.value}
                onChange={(e) => f.onChange(e.target.value)}
                placeholder={f.placeholder}
              />
            ) : (
              <Input
                value={f.value}
                onChange={(e) => f.onChange(e.target.value)}
                placeholder={f.placeholder}
              />
            )}
          </div>
        ))}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function NumberRow({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  hint?: string;
}) {
  // Draft tekstowy: klamrowanie na KAZDYM znaku uniemozliwialo wpisanie np.
  // "9" w polu o min=12 (skok do 12) albo wyczyszczenie pola. Trzymamy wiec
  // surowy tekst w trakcie pisania, propagujemy tylko wartosci w zakresie,
  // a przy opuszczeniu pola normalizujemy do granic.
  const [draft, setDraft] = useState<string>(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={draft}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          if (raw.trim() === "") return;
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          if (n >= min && n <= max) onChange(n);
        }}
        onBlur={() => {
          setEditing(false);
          const n = Number(draft);
          const next = Number.isFinite(n) && draft.trim() !== "" ? clamp(n) : value;
          setDraft(String(next));
          if (next !== value) onChange(next);
        }}
      />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ColorRow({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 rounded-md border border-border bg-transparent"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={
        "flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs transition-colors " +
        (disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-muted/40")
      }
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        className="h-[16px] w-[16px] shrink-0"
      />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  desc?: string;
}

export function SegmentedRow<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  columns,
}: {
  label?: string;
  value: T;
  options: ReadonlyArray<SegmentOption<T>>;
  onChange: (v: T) => void;
  hint?: string;
  columns?: number;
}) {
  const cols = columns ?? Math.min(options.length, 3);
  return (
    <div className="min-w-0">
      {label && <Label>{label}</Label>}
      <div
        className="mt-1 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              className={
                "rounded-md border px-3 py-2 text-left text-xs transition-colors " +
                (active
                  ? "border-primary bg-primary/10 text-foreground shadow-sm"
                  : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground")
              }
            >
              <span className="block text-[12px] font-medium text-foreground">{o.label}</span>
              {o.desc && <span className="mt-0.5 block text-[11px]">{o.desc}</span>}
            </button>
          );
        })}
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Lista bloków z przyciskami przesuwania - edycja "miejsc" elementów. */
export function OrderRow<T extends string>({
  label,
  hint,
  items,
  labels,
  onChange,
  upLabel,
  downLabel,
}: {
  label: string;
  hint?: string;
  items: T[];
  labels: Record<T, string>;
  onChange: (next: T[]) => void;
  upLabel: string;
  downLabel: string;
}) {
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  };

  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <ol className="mt-1 space-y-1.5">
        {items.map((item, index) => (
          <li
            key={item}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
          >
            <span className="w-4 shrink-0 tabular-nums text-muted-foreground">{index + 1}.</span>
            <span className="min-w-0 flex-1 truncate">{labels[item]}</span>
            <button
              type="button"
              onClick={() => move(index, -1)}
              disabled={index === 0}
              aria-label={`${upLabel}: ${labels[item]}`}
              className="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(index, 1)}
              disabled={index === items.length - 1}
              aria-label={`${downLabel}: ${labels[item]}`}
              className="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
            >
              ↓
            </button>
          </li>
        ))}
      </ol>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Ostrzeżenie o kontraście tekstu do tła (WCAG AA = 4.5:1 dla treści). */
export function ContrastNote({
  bg,
  fg,
  message,
}: {
  bg: string;
  fg: string;
  message: (ratio: string) => string;
}) {
  const lb = colorLuminance(bg);
  const lf = colorLuminance(fg);
  if (lb === null || lf === null) return null;
  const ratio = (Math.max(lb, lf) + 0.05) / (Math.min(lb, lf) + 0.05);
  if (ratio >= 4.5) return null;
  return <p className="text-[11px] font-medium text-destructive">{message(ratio.toFixed(1))}</p>;
}
