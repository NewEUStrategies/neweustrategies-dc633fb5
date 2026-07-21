// Karta "Seria / dossier" w edytorze wpisu (A8): przypięcie wpisu do serii
// z numerem części + tworzenie nowej serii inline. Mutacje bezpośrednio przez
// RLS (staff manage), niezależnie od zapisu formularza - jak taksonomie.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { slugifyTaxonomy } from "@/lib/content/taxonomySlug";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import "@/lib/i18n-admin-post-panes";

interface SeriesRow {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
}

interface LinkRow {
  series_id: string;
  part_number: number;
}

const NONE = "__none__";

export function SeriesCard({ postId }: { postId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");

  const seriesKey = ["admin", "series-list"] as const;
  const linkKey = ["admin", "post-series", postId] as const;

  const { data: seriesList } = useQuery({
    queryKey: seriesKey,
    queryFn: async (): Promise<SeriesRow[]> => {
      const { data, error } = await supabase
        .from("series")
        .select("id, slug, name_pl, name_en")
        .order("name_pl");
      if (error) throw error;
      return (data ?? []) as SeriesRow[];
    },
  });

  const { data: link } = useQuery({
    queryKey: linkKey,
    queryFn: async (): Promise<LinkRow | null> => {
      const { data, error } = await supabase
        .from("post_series")
        .select("series_id, part_number")
        .eq("post_id", postId)
        .maybeSingle();
      if (error) throw error;
      return (data as LinkRow | null) ?? null;
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: linkKey });
    void qc.invalidateQueries({ queryKey: ["public", "post-series", postId] });
  };

  const assignM = useMutation({
    mutationFn: async (input: { seriesId: string | null; part: number }) => {
      if (!input.seriesId) {
        const { error } = await supabase.from("post_series").delete().eq("post_id", postId);
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from("post_series")
        .upsert(
          { post_id: postId, series_id: input.seriesId, part_number: input.part },
          { onConflict: "post_id" },
        );
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const createM = useMutation({
    mutationFn: async () => {
      const name = newName.trim();
      const { data, error } = await supabase
        .from("series")
        .insert({ name_pl: name, name_en: name, slug: slugifyTaxonomy(name) })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (seriesId) => {
      setNewName("");
      void qc.invalidateQueries({ queryKey: seriesKey });
      assignM.mutate({ seriesId, part: link?.part_number ?? 1 });
      toast.success(t("adminPostPanes.series.created"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground -mt-1">{t("adminPostPanes.series.hint")}</p>
      <Select
        value={link?.series_id ?? NONE}
        onValueChange={(v) =>
          assignM.mutate({ seriesId: v === NONE ? null : v, part: link?.part_number ?? 1 })
        }
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("adminPostPanes.series.none")}</SelectItem>
          {(seriesList ?? []).map((row) => (
            <SelectItem key={row.id} value={row.id}>
              {row.name_pl || row.name_en}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {link && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">
            {t("adminPostPanes.series.partLabel")}
          </span>
          <Input
            type="number"
            min={1}
            max={999}
            value={link.part_number}
            onChange={(e) =>
              assignM.mutate({
                seriesId: link.series_id,
                part: Math.max(1, Math.min(999, Number(e.target.value) || 1)),
              })
            }
            className="h-8 text-xs w-20"
          />
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t("adminPostPanes.series.newPlaceholder")}
          className="h-8 text-xs"
          maxLength={140}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!newName.trim() || createM.isPending}
          onClick={() => createM.mutate()}
        >
          {t("adminPostPanes.series.create")}
        </Button>
      </div>
    </div>
  );
}
