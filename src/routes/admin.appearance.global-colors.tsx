// Admin: zarządzanie Globalnymi Kolorami strony.
// Struktura paneli odpowiada Foxiz → Global Colors. Każdy slot ma wartość
// light + opcjonalnie dark. Wybrane sloty (Highlight, Body BG, Button …)
// nadpisują semantyczne tokeny shadcn, więc kolory mają natychmiastowy
// wpływ na produkcyjną stronę.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Save } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/admin/builder/ui/atoms/ColorField";
import { useGlobalColors, useSaveGlobalColors } from "@/hooks/useGlobalColors";
import { GLOBAL_COLOR_GROUPS, type GlobalColorsValue } from "@/lib/builder/globalColors";

export const Route = createFileRoute("/admin/appearance/global-colors")({
  component: GlobalColorsPage,
});

function GlobalColorsPage() {
  const { data, isLoading } = useGlobalColors();
  const save = useSaveGlobalColors();
  const [draft, setDraft] = useState<GlobalColorsValue | null>(null);

  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);

  if (isLoading || !draft) {
    return <p className="text-sm text-muted-foreground">Ładowanie…</p>;
  }

  const setSlot = (key: string, mode: "light" | "dark", value: string | undefined) => {
    setDraft((d) => {
      const prev = d ?? {};
      const cur = prev[key] ?? {};
      const next = { ...cur, [mode]: value };
      // Jeżeli oba puste - usuwamy slot.
      if (!next.light && !next.dark) {
        const { [key]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: next };
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl">Global Colors</h2>
          <p className="text-sm text-muted-foreground">
            Centralna paleta - każdy slot opisuje, gdzie kolor pojawi się na stronie. Zmiany są
            natychmiast widoczne w całej witrynie po zapisaniu.
          </p>
        </div>
        <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
          <Save className="w-4 h-4 mr-2" />
          {save.isPending ? "Zapisywanie…" : "Zapisz zmiany"}
        </Button>
      </div>

      <div className="space-y-8">
        {GLOBAL_COLOR_GROUPS.map((group) => (
          <section key={group.id} className="rounded-lg border border-border bg-card">
            <header className="px-4 py-2 border-b border-border bg-muted/40 rounded-t-lg">
              <h3 className="font-medium text-sm tracking-wide uppercase">{group.label}</h3>
            </header>
            <div className="divide-y divide-border">
              {group.slots.map((slot) => {
                const val = draft[slot.key] ?? {};
                return (
                  <div
                    key={slot.key}
                    className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr] gap-4 px-4 py-4 items-start"
                  >
                    <div>
                      <div className="text-sm font-medium">{slot.label}</div>
                      <p className="text-xs text-muted-foreground mt-1">{slot.description}</p>
                      {slot.overrides?.length ? (
                        <p className="text-[11px] text-muted-foreground/80 mt-1">
                          Nadpisuje:{" "}
                          {slot.overrides.map((o) => (
                            <code key={o} className="mr-1">
                              {o}
                            </code>
                          ))}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wide text-muted-foreground block mb-1">
                        Tryb jasny
                      </label>
                      <ColorField
                        value={val.light}
                        onChange={(v) => setSlot(slot.key, "light", v)}
                        placeholder={slot.defaultLight ?? "#000000"}
                      />
                    </div>
                    <div>
                      {slot.hasDark ? (
                        <>
                          <label className="text-[11px] uppercase tracking-wide text-muted-foreground block mb-1">
                            Tryb ciemny
                          </label>
                          <ColorField
                            value={val.dark}
                            onChange={(v) => setSlot(slot.key, "dark", v)}
                            placeholder={slot.defaultDark ?? "#ffffff"}
                          />
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground italic mt-5">
                          (wspólne dla obu trybów)
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="flex justify-end pt-4">
        <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
          <Save className="w-4 h-4 mr-2" />
          {save.isPending ? "Zapisywanie…" : "Zapisz zmiany"}
        </Button>
      </div>
    </div>
  );
}
