// Admin tab: edit brand design tokens (colors, fonts, scale) for the tenant.
// Saves to `public.site_design_tokens` and is applied live via
// <DesignTokensStyle/> as :root CSS variables (`--brand-…`).
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  useDesignTokens,
  useSaveDesignTokens,
  slugifyToken,
  type BrandColor,
  type DesignTokens,
  EMPTY_TOKENS,
} from "@/lib/builder/designTokens";
import { Field, Text, SaveBar } from "@/components/admin/settings/fields";
import { ColorField } from "@/components/admin/builder/ui/atoms/ColorField";

export const Route = createFileRoute("/admin/settings/design")({
  component: DesignSettings,
});

function DesignSettings() {
  const { data, isLoading } = useDesignTokens();
  const save = useSaveDesignTokens();
  const [draft, setDraft] = useState<DesignTokens | null>(null);

  // Hydrate the draft once data arrives.
  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);

  if (isLoading || !draft) {
    return <p className="text-sm text-muted-foreground">Ładowanie…</p>;
  }

  const setColors = (mut: (cols: BrandColor[]) => BrandColor[]) =>
    setDraft({ ...draft, colors: mut(draft.colors) });

  const addColor = () =>
    setColors((cols) => [...cols, { name: `color-${cols.length + 1}`, value: "#3b82f6" }]);

  const copyVar = (name: string) => {
    const slug = slugifyToken(name);
    navigator.clipboard.writeText(`var(--brand-${slug})`);
    toast.success(`Skopiowano var(--brand-${slug})`);
  };

  return (
    <div>
      <h2 className="font-display text-xl mb-1">Tokeny marki</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Definiuje kolory i fonty dostępne jako zmienne CSS (np. <code>var(--brand-primary)</code>),
        z których możesz korzystać w panelach widgetów i własnych regułach CSS.
      </p>

      <Field label="Font nagłówków" hint="Stos fontów, np. „Inter, system-ui, sans-serif”.">
        <Text
          value={draft.fonts.heading ?? ""}
          onChange={(e) => setDraft({ ...draft, fonts: { ...draft.fonts, heading: e.target.value || undefined } })}
          placeholder="Inter, system-ui, sans-serif"
        />
      </Field>
      <Field label="Font tekstu" hint="Używany dla treści — paragrafy, listy, akapity.">
        <Text
          value={draft.fonts.body ?? ""}
          onChange={(e) => setDraft({ ...draft, fonts: { ...draft.fonts, body: e.target.value || undefined } })}
          placeholder="Inter, system-ui, sans-serif"
        />
      </Field>
      <Field label="Promień (radius)" hint="Domyślny border-radius dla kart, przycisków itp.">
        <Text
          value={draft.scale.radius ?? ""}
          onChange={(e) => setDraft({ ...draft, scale: { ...draft.scale, radius: e.target.value || undefined } })}
          placeholder="8px"
        />
      </Field>

      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-sm">Kolory marki</h3>
          <button
            type="button"
            onClick={addColor}
            className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Dodaj kolor
          </button>
        </div>

        {draft.colors.length === 0 ? (
          <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-4 text-center">
            Brak kolorów. Dodaj pierwszy, aby udostępnić go jako <code>var(--brand-…)</code>.
          </p>
        ) : (
          <ul className="space-y-2">
            {draft.colors.map((c, idx) => {
              const slug = slugifyToken(c.name);
              return (
                <li
                  key={idx}
                  className="grid grid-cols-[120px_1fr_auto_auto] items-center gap-2 p-2 border border-border rounded-md bg-background"
                >
                  <Text
                    value={c.name}
                    onChange={(e) =>
                      setColors((cols) => cols.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))
                    }
                    placeholder="primary"
                  />
                  <ColorField
                    value={c.value}
                    onChange={(v) =>
                      setColors((cols) => cols.map((x, i) => i === idx ? { ...x, value: v ?? "" } : x))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => copyVar(c.name)}
                    className="p-1.5 text-muted-foreground hover:text-brand"
                    title={`Skopiuj var(--brand-${slug})`}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setColors((cols) => cols.filter((_, i) => i !== idx))}
                    className="p-1.5 text-muted-foreground hover:text-destructive"
                    title="Usuń"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <SaveBar
        saving={save.isPending}
        onSave={() => save.mutate(draft ?? EMPTY_TOKENS)}
      />
    </div>
  );
}
