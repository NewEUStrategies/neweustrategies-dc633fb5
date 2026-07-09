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

type PasswordState = {
  hasPassword: boolean;
  newPassword: string;
  hintPl: string;
  hintEn: string;
};

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
  const [pwd, setPwd] = useState<PasswordState>({
    hasPassword: false,
    newPassword: "",
    hintPl: "",
    hintEn: "",
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
      if (r) {
        setRule(r as ContentAccessRule);
        setPwd({
          hasPassword: !!(r as { password_hash?: string | null }).password_hash,
          newPassword: "",
          hintPl: (r as { password_hint_pl?: string | null }).password_hint_pl ?? "",
          hintEn: (r as { password_hint_en?: string | null }).password_hint_en ?? "",
        });
      }
      setLoading(false);
    })();
  }, [entityType, entityId]);

  const save = async () => {
    if (!entityId) return toast.error("Najpierw zapisz treść, aby ustawić dostęp.");
    if (rule.mode === "password" && !pwd.hasPassword && !pwd.newPassword.trim()) {
      return toast.error('Ustaw hasło dla trybu „Hasło”.');
    }
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
      password_hint_pl: rule.mode === "password" ? pwd.hintPl || null : null,
      password_hint_en: rule.mode === "password" ? pwd.hintEn || null : null,
    };
    const { error } = await supabase
      .from("content_access")
      .upsert(payload, { onConflict: "entity_type,entity_id" });
    if (error) {
      setSaving(false);
      return toast.error(error.message);
    }

    // Password mutations run through SECURITY DEFINER RPCs so the plaintext is
    // bcrypt-hashed server-side and never stored in the base upsert path.
    if (rule.mode === "password" && pwd.newPassword.trim()) {
      const { error: rpcErr } = await supabase.rpc("admin_set_content_password", {
        _entity_type: entityType,
        _entity_id: entityId,
        _password: pwd.newPassword,
        _hint_pl: pwd.hintPl || "",
        _hint_en: pwd.hintEn || "",
      });
      if (rpcErr) {
        setSaving(false);
        return toast.error(rpcErr.message);
      }
      setPwd((s) => ({ ...s, hasPassword: true, newPassword: "" }));
    } else if (rule.mode !== "password" && pwd.hasPassword) {
      // Leaving password mode clears the stored hash so it can't be reused later.
      await supabase.rpc("admin_clear_content_password", {
        _entity_type: entityType,
        _entity_id: entityId,
      });
      setPwd({ hasPassword: false, newPassword: "", hintPl: "", hintEn: "" });
    }

    setSaving(false);
    toast.success("Zapisano dostęp");
  };

  const clearPassword = async () => {
    if (!entityId) return;
    const { error } = await supabase.rpc("admin_clear_content_password", {
      _entity_type: entityType,
      _entity_id: entityId,
    });
    if (error) return toast.error(error.message);
    setPwd({ hasPassword: false, newPassword: "", hintPl: "", hintEn: "" });
    toast.success("Hasło usunięte");
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
            <SelectItem value="password">Hasło - dostęp po wpisaniu hasła</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {rule.mode === "password" && (
        <div className="space-y-3 border border-border rounded-md p-3 bg-muted/30">
          <div className="flex items-center justify-between">
            <Label className="text-xs">
              {pwd.hasPassword ? "Hasło jest ustawione" : "Ustaw hasło"}
            </Label>
            {pwd.hasPassword && (
              <Button size="sm" variant="ghost" onClick={clearPassword}>
                Usuń hasło
              </Button>
            )}
          </div>
          <Input
            type="password"
            autoComplete="new-password"
            value={pwd.newPassword}
            onChange={(e) => setPwd({ ...pwd, newPassword: e.target.value })}
            placeholder={pwd.hasPassword ? "Nowe hasło (opcjonalnie - zmień)" : "Wpisz hasło"}
            className="h-9"
          />
          <p className="text-[11px] text-muted-foreground">
            Hasło jest hashowane po stronie serwera (bcrypt) - nigdy nie trafia w postaci jawnej do bazy ani do przeglądarki.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Podpowiedź PL (opcjonalna)</Label>
              <Input
                value={pwd.hintPl}
                onChange={(e) => setPwd({ ...pwd, hintPl: e.target.value })}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Podpowiedź EN (opcjonalna)</Label>
              <Input
                value={pwd.hintEn}
                onChange={(e) => setPwd({ ...pwd, hintEn: e.target.value })}
                className="h-9"
              />
            </div>
          </div>
        </div>
      )}

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
