// Atom: small segmented control (button group) for short enums.
interface Option<T extends string> { value: T; label: string; icon?: React.ReactNode }
interface Props<T extends string> {
  value: T | undefined;
  options: ReadonlyArray<Option<T>>;
  onChange: (v: T) => void;
  className?: string;
}

export function Segmented<T extends string>({ value, options, onChange, className }: Props<T>) {
  return (
    <div className={`inline-flex rounded border border-border bg-muted/30 p-0.5 ${className ?? ""}`}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex-1 inline-flex items-center justify-center gap-1 px-2 h-6 text-[11px] rounded transition ${
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
            title={o.label}
          >
            {o.icon}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
