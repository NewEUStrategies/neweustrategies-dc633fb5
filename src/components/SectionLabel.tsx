type Props = {
  label: string;
  color?: "brand" | "military" | "finance" | "transport" | "diplomacy" | "cyber";
  action?: React.ReactNode;
};

const colorMap: Record<NonNullable<Props["color"]>, string> = {
  brand: "bg-brand",
  military: "bg-cat-military",
  finance: "bg-cat-finance",
  transport: "bg-cat-transport",
  diplomacy: "bg-cat-diplomacy",
  cyber: "bg-cat-cyber",
};

export function SectionLabel({ label, color = "brand", action }: Props) {
  return (
    <div className="flex items-end justify-between border-b-2 border-border/60 mb-6">
      <div className={`section-rule ${colorMap[color]} text-sm uppercase tracking-wider`}>
        {label}
      </div>
      {action && <div className="text-xs font-semibold text-muted-foreground hover:text-brand pb-2 cursor-pointer">{action}</div>}
    </div>
  );
}
