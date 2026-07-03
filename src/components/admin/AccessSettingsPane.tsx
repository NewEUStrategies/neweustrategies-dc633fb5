import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  AccessEntityType,
  AccessMode,
  AccessPlan,
  ContentAccessRule,
} from "@/hooks/useContentAccess";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Props = { entityType: AccessEntityType; entityId: string | null };

export function AccessSettingsPane({ entityType, entityId }: Props) {
  const [plans, setPlans] = useState<AccessPlan[]>([]);
  const [rule, setRule] = useState<Partial<ContentAccessRule>>({
    mode: "public",
    plan_ids: [],
    one_time_price_cents: null,
    one_time_currency: "PLN",
    teaser_pl: "",
    teaser_en: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: pl }, { data: r }] = await Promise.all([
        supabase.from("access_plans").select("*").eq("active", true).order("sort_order"),
        entityId
          ? supabase
              .from("content_access")
              .select("*")
              .eq("entity_type", entityType)
              .eq("entity_id", entityId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      setPlans((pl as AccessPlan[]) ?? []);
      if (r) setRule(r as ContentAccessRule);
      setLoading(false);
    })();
  }, [entityType, entityId]);

  const save = async () => {
    if (!entityId) return toast.error("Najpierw zapisz treść, aby ustawić dostęp.");
    setSaving(true);
    const payload = {
      entity_type: entityType,
      entity_id: entityId,
      mode: rule.mode ?? "public",
      plan_ids: rule.plan_ids ?? [],
      one_time_price_cents: rule.one_time_price_cents ?? null,
      one_time_currency: rule.one_time_currency || "PLN",
      teaser_pl: rule.teaser_pl ?? null,
      teaser_en: rule.teaser_en ?? null,
    };
    const { error } = await supabase
      .from("content_access")
      .upsert(payload, { onConflict: "entity_type,entity_id" });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Zapisano dostęp");
  };

  const togglePlan = (id: string) => {
    const cur = rule.plan_ids ?? [];
    setRule({ ...rule, plan_ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  if (loading) return <div className="text-xs text-muted-foreground p-3">Wczytywanie…</div>;

  return (
    <div className="space-y-4 border border-border rounded-lg p-4 bg-card">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Dostęp / Paywall</h3>
        <Button size="sm" onClick={save} disabled={saving}>
          Zapisz dostęp
        </Button>
      </div>

      <div>
        <Label className="text-xs">Tryb</Label>
        <Select
          value={rule.mode ?? "public"}
          onValueChange={(v) => setRule({ ...rule, mode: v as AccessMode })}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="public">Publiczny - wszyscy widzą</SelectItem>
            <SelectItem value="members">Tylko zalogowani (members-only)</SelectItem>
            <SelectItem value="paid">Płatny (plan lub zakup jednorazowy)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {rule.mode === "paid" && (
        <>
          <div>
            <Label className="text-xs">Plany subskrypcji odblokowujące tę treść</Label>
            {plans.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-1">
                Brak planów. Utwórz je w „Paywall → Plany".
              </p>
            ) : (
              <div className="space-y-1.5 mt-2">
                {plans.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={(rule.plan_ids ?? []).includes(p.id)}
                      onCheckedChange={() => togglePlan(p.id)}
                    />
                    <span>
                      {p.name_pl || p.name_en} · {(p.price_cents / 100).toFixed(2)} {p.currency} /{" "}
                      {p.interval}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Cena jednorazowa (grosze, 0 = wyłącz)</Label>
              <Input
                type="number"
                min={0}
                value={rule.one_time_price_cents ?? 0}
                onChange={(e) =>
                  setRule({ ...rule, one_time_price_cents: Number(e.target.value) || null })
                }
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Waluta</Label>
              <Input
                value={rule.one_time_currency ?? "PLN"}
                onChange={(e) => setRule({ ...rule, one_time_currency: e.target.value })}
                className="h-9"
              />
            </div>
          </div>
        </>
      )}

      {rule.mode !== "public" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Teaser PL (opcjonalny)</Label>
            <Textarea
              rows={3}
              value={rule.teaser_pl ?? ""}
              onChange={(e) => setRule({ ...rule, teaser_pl: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Teaser EN (opcjonalny)</Label>
            <Textarea
              rows={3}
              value={rule.teaser_en ?? ""}
              onChange={(e) => setRule({ ...rule, teaser_en: e.target.value })}
            />
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Gdy nie podasz teasera, system automatycznie pokaże ok. 20% początku treści.
      </p>
    </div>
  );
}
