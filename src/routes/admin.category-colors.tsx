// Admin: kolorystyka pigułek (badge) głównych obszarów tematycznych.
// - Renderuje 12 rekomendowanych obszarów + wszystkie inne kategorie tenanta.
// - Edycja koloru HEX (color input + tekst), podgląd live, i18n PL/EN.
// - Zapis przez server fn `upsertCategory` (RLS + tenant izolacja).
// - Brakujące obszary można dodać jednym klikiem (batch insert).
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { upsertCategory } from "@/lib/content.functions";
import { Button } from "@/components/ui/button";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import { CORE_CATEGORY_AREAS, type CoreCategoryArea } from "@/lib/categoryAreas";

export const Route = createFileRoute("/admin/category-colors")({
  component: CategoryColorsPage,
});

interface CategoryRow {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  color: string | null;
}

type Draft = Record<string, string>; // slug -> color

function CategoryColorsPage() {
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const tenantId = useRequiredTenant();
  const qc = useQueryClient();
  const upsert$ = useServerFn(upsertCategory);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);

  const { data: rows = [] } = useQuery({
    queryKey: ["categories", tenantId, "with-color"],
    queryFn: async (): Promise<CategoryRow[]> => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, slug, name_pl, name_en, color")
        .eq("tenant_id", tenantId)
        .order("name_pl");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Sortuj: najpierw core areas w podanej kolejności, potem reszta alfabetycznie.
  const ordered = useMemo(() => {
    const bySlug = new Map(rows.map((r) => [r.slug, r] as const));
    const core: CategoryRow[] = [];
    for (const area of CORE_CATEGORY_AREAS) {
      const r = bySlug.get(area.slug);
      if (r) core.push(r);
    }
    const coreSet = new Set(CORE_CATEGORY_AREAS.map((a) => a.slug));
    const rest = rows.filter((r) => !coreSet.has(r.slug));
    return [...core, ...rest];
  }, [rows]);

  const missing = useMemo(
    () => CORE_CATEGORY_AREAS.filter((a) => !rows.some((r) => r.slug === a.slug)),
    [rows],
  );

  const colorFor = (r: CategoryRow) => draft[r.slug] ?? r.color ?? "#111827";
  const recommendedFor = (slug: string): string | null =>
    CORE_CATEGORY_AREAS.find((a) => a.slug === slug)?.color ?? null;

  const setColor = (slug: string, color: string) => setDraft((d) => ({ ...d, [slug]: color }));

  const saveAll = async () => {
    const changed = ordered.filter(
      (r) => draft[r.slug] && draft[r.slug].toLowerCase() !== (r.color ?? "").toLowerCase(),
    );
    if (!changed.length) {
      toast.info(t("admin.categoryColors.saved"));
      return;
    }
    setBusy(true);
    try {
      for (const r of changed) {
        await upsert$({
          data: {
            id: r.id,
            fields: {
              name_pl: r.name_pl,
              name_en: r.name_en,
              slug: r.slug,
              description_pl: null,
              description_en: null,
              color: draft[r.slug],
            },
          },
        });
      }
      toast.success(t("admin.categoryColors.saved"));
      setDraft({});
      qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      toast.error(
        `${t("admin.categoryColors.saveError")}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const addMissing = async (list: readonly CoreCategoryArea[]) => {
    if (!list.length) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("categories").insert(
        list.map((a) => ({
          tenant_id: tenantId,
          slug: a.slug,
          name_pl: a.name_pl,
          name_en: a.name_en,
          color: a.color,
        })),
      );
      if (error) throw error;
      toast.success(t("admin.categoryColors.addedMissing"));
      qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("admin.categoryColors.title")}</h1>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
            {t("admin.categoryColors.subtitle")}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {missing.length > 0 && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => addMissing(missing)}>
              {t("admin.categoryColors.addMissing")} ({missing.length})
            </Button>
          )}
          <Button size="sm" onClick={saveAll} disabled={busy || !Object.keys(draft).length}>
            {t("admin.categoryColors.save")}
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {!ordered.length ? (
          <div className="p-10 text-center text-muted-foreground text-sm">
            {t("admin.empty")}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground tracking-wide">
              <tr>
                <th className="text-left p-2 w-[140px]">
                  {t("admin.categoryColors.column.preview")}
                </th>
                <th className="text-left p-2">{t("admin.categoryColors.column.name")}</th>
                <th className="text-left p-2 w-[200px]">
                  {t("admin.categoryColors.column.slug")}
                </th>
                <th className="text-left p-2 w-[260px]">
                  {t("admin.categoryColors.column.color")}
                </th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => {
                const c = colorFor(r);
                const label = lang === "en" ? r.name_en || r.name_pl : r.name_pl || r.name_en;
                const recommended = recommendedFor(r.slug);
                const dirty =
                  draft[r.slug] && draft[r.slug].toLowerCase() !== (r.color ?? "").toLowerCase();
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                    <td className="p-2">
                      <span
                        className="inline-flex items-center rounded-sm px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide shadow-sm"
                        style={{ backgroundColor: c, color: pickText(c) }}
                      >
                        {label}
                      </span>
                    </td>
                    <td className="p-2">
                      <div className="font-medium text-[13px]">{r.name_pl}</div>
                      <div className="text-[11px] text-muted-foreground">{r.name_en}</div>
                    </td>
                    <td
                      className="p-2 text-[11px] text-muted-foreground truncate max-w-[200px]"
                      title={r.slug}
                    >
                      {r.slug}
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          aria-label={t("admin.categoryColors.column.color")}
                          value={c}
                          onChange={(e) => setColor(r.slug, e.target.value)}
                          className="h-8 w-10 rounded border border-input bg-background cursor-pointer p-0"
                        />
                        <Input
                          value={c}
                          onChange={(e) => setColor(r.slug, e.target.value)}
                          className="h-8 w-[100px] font-mono text-xs uppercase"
                          maxLength={7}
                        />
                        {recommended && recommended.toLowerCase() !== c.toLowerCase() && (
                          <button
                            type="button"
                            onClick={() => setColor(r.slug, recommended)}
                            className="text-[10px] underline text-muted-foreground hover:text-foreground"
                            title={recommended}
                          >
                            {t("admin.categoryColors.reset")}
                          </button>
                        )}
                        {dirty && (
                          <span className="text-[10px] text-brand font-semibold uppercase">●</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function pickText(hex: string): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return "#ffffff";
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return l > 0.6 ? "#0b0b0d" : "#ffffff";
}
