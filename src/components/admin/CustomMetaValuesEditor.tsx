// Compact editor for per-post custom meta values. Renders one input per
// definition; empty values are stored as missing keys (server stores jsonb).
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listCustomMetaDefs, metaLabel, type CustomMetaValues } from "@/lib/customMeta";
import { Link } from "@tanstack/react-router";

interface Props {
  tenantId: string;
  lang: "pl" | "en";
  values: CustomMetaValues | null | undefined;
  onChange: (next: CustomMetaValues) => void;
}

export function CustomMetaValuesEditor({ tenantId, lang, values, onChange }: Props) {
  const { data: defs = [], isLoading } = useQuery({
    queryKey: ["customMetaDefs", tenantId] as const,
    queryFn: () => listCustomMetaDefs(tenantId),
    staleTime: 60_000,
  });

  const setKey = (key: string, v: string): void => {
    const next: CustomMetaValues = { ...(values ?? {}) };
    if (v.trim()) next[key] = v;
    else delete next[key];
    onChange(next);
  };

  if (isLoading) return <p className="text-xs text-muted-foreground">...</p>;
  if (defs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {lang === "pl" ? "Brak zdefiniowanych pól. " : "No fields defined yet. "}
        <Link to="/admin/custom-meta" className="text-brand underline">
          {lang === "pl" ? "Zdefiniuj globalne pola" : "Define global fields"}
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {defs.map((d) => (
        <div key={d.id} className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-2">
          <Label className="text-xs text-muted-foreground truncate" title={d.key}>{metaLabel(d, lang)}</Label>
          <Input
            value={values?.[d.key] ?? ""}
            onChange={(e) => setKey(d.key, e.target.value)}
            placeholder={d.key}
            className="h-8 text-sm"
          />
        </div>
      ))}
    </div>
  );
}
