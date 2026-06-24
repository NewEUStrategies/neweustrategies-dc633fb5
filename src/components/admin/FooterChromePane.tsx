import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Save } from "@/lib/lucide-shim";
import {
  FooterChromeSchema,
  defaultFooterChrome,
  type FooterChrome,
  type FooterLayout as FooterLayoutT,
} from "@/lib/theme/footerSettings";

type Row = Record<string, unknown> & { chrome?: Partial<FooterChrome> };

export function FooterChromePane() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["site_settings", "footer"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "footer")
        .maybeSingle();
      if (error) throw error;
      return (data?.value ?? {}) as Row;
    },
  });

  const [c, setC] = useState<FooterChrome | null>(null);
  useEffect(() => {
    if (!data || c) return;
    const parsed = FooterChromeSchema.safeParse({ ...defaultFooterChrome(), ...(data.chrome ?? {}) });
    setC(parsed.success ? parsed.data : defaultFooterChrome());
  }, [data, c]);

  const save = useMutation({
    mutationFn: async (next: FooterChrome) => {
      const merged = { ...(data ?? {}), chrome: next };
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: "footer", value: merged as never }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site_settings", "footer"] });
      qc.invalidateQueries({ queryKey: ["site_settings_public", "all"] });
      toast.success("Zapisano");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!c) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;
  const upd = (p: Partial<FooterChrome>) => setC({ ...c, ...p });

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Label>Layout</Label>
          <Select value={c.layout} onValueChange={(v: string) => upd({ layout: v as FooterLayoutT })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default</SelectItem>
              <SelectItem value="centered">Centered</SelectItem>
              <SelectItem value="minimal">Minimal</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex items-center gap-2">
            <Switch checked={c.show_separator} onCheckedChange={(v) => upd({ show_separator: v })} id="sep" />
            <Label htmlFor="sep">Separator</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={c.show_year} onCheckedChange={(v) => upd({ show_year: v })} id="yr" />
            <Label htmlFor="yr">Pokaż rok</Label>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Label>Copyright (PL)</Label>
          <Input value={c.copyright_pl} onChange={(e) => upd({ copyright_pl: e.target.value })}
            placeholder="© {year} Nazwa serwisu" maxLength={500} />
        </div>
        <div>
          <Label>Copyright (EN)</Label>
          <Input value={c.copyright_en} onChange={(e) => upd({ copyright_en: e.target.value })}
            placeholder="© {year} Site name" maxLength={500} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Użyj <code>{"{year}"}</code> aby wstawić bieżący rok. Pusto = automatyczny „© rok”.
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="flex items-center gap-2">
          <Switch checked={c.back_to_top} onCheckedChange={(v) => upd({ back_to_top: v })} id="btt" />
          <Label htmlFor="btt">Przycisk „Wróć na górę”</Label>
        </div>
        <div>
          <Label>Próg pokazania (px)</Label>
          <Input
            type="number" min={0} max={5000}
            value={c.back_to_top_threshold_px}
            onChange={(e) => upd({ back_to_top_threshold_px: Number(e.target.value) || 0 })}
            disabled={!c.back_to_top}
          />
        </div>
      </div>

      <Button onClick={() => save.mutate(c)} disabled={save.isPending}>
        <Save className="w-4 h-4 mr-2" /> {save.isPending ? "…" : "Zapisz"}
      </Button>
    </div>
  );
}
