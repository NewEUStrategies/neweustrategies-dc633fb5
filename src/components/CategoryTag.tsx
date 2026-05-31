type Props = { label: string; color?: "military" | "finance" | "diplomacy" | "cyber" | "brand" | "neutral" };

const colorMap = {
  military: "bg-cat-military text-white",
  finance: "bg-cat-finance text-white",
  diplomacy: "bg-cat-diplomacy text-white",
  cyber: "bg-cat-cyber text-white",
  brand: "bg-brand text-brand-foreground",
  neutral: "bg-foreground/80 text-background",
};

export function CategoryTag({ label, color = "brand" }: Props) {
  return (
    <span className={`inline-block px-3 py-1 text-xs font-bold tracking-wider ${colorMap[color]}`}>
      {label}
    </span>
  );
}
