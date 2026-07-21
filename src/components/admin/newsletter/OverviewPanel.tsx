// Overview /admin/newsletter/overview:
// - KPI grid (subskrybenci, growth, opt-in rate, unsubscribes)
// - Wybor trybu (off/inline/popup/both)
// - Ustawienia logiki (double opt-in, sender name/email, popup triggery)
// - Dual live preview (inline + popup obok siebie)
//
// Zapis: pojedynczy przycisk "Zapisz ustawienia" - Overview edytuje tylko
// warstwe LOGIKI (nie tresci; te siedza w builderze). Zawartosc PL/EN i style
// zyja w /inline i /popup builderach.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  useNewsletterSettings,
  useSaveNewsletterSettings,
  defaultNewsletterSettings,
  type NewsletterSettings,
  type NewsletterMode,
} from "@/hooks/useNewsletterSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowUpRight,
  Users,
  MailCheck,
  UserMinus,
  TrendingUp,
  Save,
  Eye,
  Mail,
  Send,
} from "lucide-react";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { NewsletterForm } from "@/components/NewsletterForm";
import { NewsletterDocRenderer } from "@/components/newsletter/NewsletterDocRenderer";
import { sanitizeHtml } from "@/lib/sanitize";

interface KpiRow {
  status: string;
  created_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}

const DAY_MS = 86_400_000;

function pctDelta(recent: number, previous: number): number {
  if (previous === 0) return recent > 0 ? 100 : 0;
  return Math.round(((recent - previous) / previous) * 100);
}

function useKpis() {
  return useQuery({
    queryKey: ["newsletter-kpis"],
    queryFn: async () => {
      // Pobieramy tylko niezbedne kolumny; agregujemy po stronie klienta -
      // dla tenantow z do ~50k adresow to nadal <200KB payloadu i pozwala na
      // szybkie miekkie filtry (30d/60d) bez roundtripow. Powyzej tej skali
      // przeniesiemy to na server function z SQL group by.
      const { data, error } = await supabase
        .from("newsletter_subscribers")
        .select("status, created_at, confirmed_at, unsubscribed_at")
        .limit(50000);
      if (error) throw error;
      const rows = (data ?? []) as KpiRow[];
      const now = Date.now();
      const in30 = (iso: string | null) => (iso ? now - Date.parse(iso) <= 30 * DAY_MS : false);
      const in60 = (iso: string | null) =>
        iso ? now - Date.parse(iso) > 30 * DAY_MS && now - Date.parse(iso) <= 60 * DAY_MS : false;

      const total = rows.filter((r) => r.status === "subscribed").length;
      const pending = rows.filter((r) => r.status === "pending").length;
      const unsub30 = rows.filter((r) => in30(r.unsubscribed_at)).length;
      const unsub60 = rows.filter((r) => in60(r.unsubscribed_at)).length;
      const new30 = rows.filter((r) => in30(r.created_at)).length;
      const new60 = rows.filter((r) => in60(r.created_at)).length;
      const confirmed = rows.filter((r) => r.status === "subscribed").length;
      const attempted = confirmed + pending;
      const optInRate = attempted > 0 ? Math.round((confirmed / attempted) * 100) : 100;

      return {
        total,
        pending,
        new30,
        growthPct: pctDelta(new30, new60),
        unsub30,
        unsubDeltaPct: pctDelta(unsub30, unsub60),
        optInRate,
      };
    },
  });
}

export function OverviewPanel() {
  const { data: settings } = useNewsletterSettings();
  const save = useSaveNewsletterSettings();
  const kpis = useKpis();

  const [local, setLocal] = useState<NewsletterSettings | null>(null);
  useEffect(() => {
    if (settings && !local) setLocal(settings);
  }, [settings, local]);
  const cur = local ?? defaultNewsletterSettings();
  const upd = (patch: Partial<NewsletterSettings>) => setLocal({ ...cur, ...patch });

  const isDirty = useMemo(
    () => (settings ? JSON.stringify(local) !== JSON.stringify(settings) : false),
    [local, settings],
  );
  useUnsavedChangesGuard(isDirty);

  const onSave = async () => {
    const { tenant_id: _tid, inline_doc: _i, popup_doc: _p, ...rest } = cur;
    void _tid;
    void _i;
    void _p;
    await save.mutateAsync(rest);
    toast.success("Zapisano ustawienia newslettera");
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Podsumowanie</h2>
          <p className="text-sm text-muted-foreground">
            Ustawienia logiki, trybu i podglad obu wariantow formularza.
          </p>
        </div>
        <Button onClick={onSave} disabled={!isDirty || save.isPending}>
          <Save className="w-4 h-4 mr-2" />
          {save.isPending ? "Zapisywanie..." : "Zapisz ustawienia"}
        </Button>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard
          icon={Users}
          label="Subskrybenci"
          value={kpis.data?.total ?? 0}
          hint={`+${kpis.data?.new30 ?? 0} w 30 dni`}
          loading={kpis.isLoading}
        />
        <KpiCard
          icon={TrendingUp}
          label="Wzrost 30d"
          value={`${kpis.data?.growthPct ?? 0}%`}
          hint={kpis.data && kpis.data.growthPct >= 0 ? "vs poprzednie 30d" : "spadek vs 30d"}
          tone={kpis.data && kpis.data.growthPct >= 0 ? "up" : "down"}
          loading={kpis.isLoading}
        />
        <KpiCard
          icon={MailCheck}
          label="Opt-in rate"
          value={`${kpis.data?.optInRate ?? 0}%`}
          hint={cur.double_opt_in ? "Double opt-in aktywny" : "Bez double opt-in"}
          loading={kpis.isLoading}
        />
        <KpiCard
          icon={UserMinus}
          label="Wypisania 30d"
          value={kpis.data?.unsub30 ?? 0}
          hint={`${kpis.data?.unsubDeltaPct ?? 0}% vs 30d wczesniej`}
          tone={kpis.data && kpis.data.unsubDeltaPct > 0 ? "down" : "up"}
          loading={kpis.isLoading}
        />
      </section>

      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg">Tryb newslettera</h3>
            <p className="text-xs text-muted-foreground">
              Decyduje, ktore formularze pokazuja sie na froncie.
            </p>
          </div>
        </div>
        <ModePicker mode={cur.mode} onChange={(mode) => upd({ mode })} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="font-display text-lg">Ustawienia logiki</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Toggle
              checked={cur.enabled}
              onChange={(v) => upd({ enabled: v })}
              label="Formularz aktywny"
              desc="Globalny wylacznik zapisu do newslettera."
            />
            <Toggle
              checked={cur.double_opt_in}
              onChange={(v) => upd({ double_opt_in: v })}
              label="Double opt-in"
              desc="Wymaga potwierdzenia adresu mailem."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Nazwa nadawcy</Label>
              <Input
                value={cur.sender_name ?? ""}
                onChange={(e) => upd({ sender_name: e.target.value || null })}
                placeholder="New European Strategies"
              />
            </div>
            <div>
              <Label>Adres e-mail nadawcy</Label>
              <Input
                type="email"
                value={cur.sender_email ?? ""}
                onChange={(e) => upd({ sender_email: e.target.value || null })}
                placeholder="newsletter@twoja-domena.pl"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Wymaga zweryfikowanej domeny w Resend.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="font-display text-lg">Popup - reguly wyswietlania</h3>
          <Toggle
            checked={cur.popup_enabled}
            onChange={(v) => upd({ popup_enabled: v })}
            label="Wlacz popup"
            desc="Popup respektuje tryb powyzej."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Trigger</Label>
              <Select
                value={cur.popup_trigger}
                onValueChange={(v) =>
                  upd({ popup_trigger: v as NewsletterSettings["popup_trigger"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="delay">Po opoznieniu</SelectItem>
                  <SelectItem value="scroll">Po przewinieciu %</SelectItem>
                  <SelectItem value="exit-intent">Exit-intent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Czestotliwosc (dni)</Label>
              <Input
                type="number"
                min={0}
                max={365}
                value={cur.popup_frequency_days}
                onChange={(e) => upd({ popup_frequency_days: Number(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label>Opoznienie (s)</Label>
              <Input
                type="number"
                min={1}
                max={600}
                value={cur.popup_delay_seconds}
                onChange={(e) => upd({ popup_delay_seconds: Number(e.target.value) || 1 })}
                disabled={cur.popup_trigger !== "delay"}
              />
            </div>
            <div>
              <Label>Prog scroll (%)</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={cur.popup_scroll_percent}
                onChange={(e) => upd({ popup_scroll_percent: Number(e.target.value) || 1 })}
                disabled={cur.popup_trigger !== "scroll"}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-display text-lg">Podglad na zywo</h3>
          <span className="ml-auto text-[11px] uppercase tracking-wider text-muted-foreground">
            Kompozycja: inline + popup
          </span>
        </div>
        <DualPreview settings={cur} />
      </section>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  loading,
}: {
  icon: typeof Users;
  label: string;
  value: number | string;
  hint?: string;
  tone?: "up" | "down";
  loading?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
      </div>
      <div className="font-display text-2xl tabular-nums">
        {loading ? <span className="text-muted-foreground text-base">...</span> : value}
      </div>
      {hint && (
        <div
          className={
            "text-[11px] flex items-center gap-1 " +
            (tone === "down"
              ? "text-destructive"
              : tone === "up"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground")
          }
        >
          {tone && <ArrowUpRight className={"w-3 h-3 " + (tone === "down" ? "rotate-90" : "")} />}
          {hint}
        </div>
      )}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
}) {
  return (
    <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/40 transition-colors">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />

      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>}
      </div>
    </label>
  );
}

const MODE_OPTIONS: { value: NewsletterMode; title: string; desc: string; icon: typeof Mail }[] = [
  { value: "off", title: "Wylaczony", desc: "Zaden formularz nie jest widoczny.", icon: UserMinus },
  { value: "inline", title: "Tylko inline", desc: "Formularz w stopce / w tresci.", icon: Mail },
  { value: "popup", title: "Tylko popup", desc: "Formularz w oknie modalnym.", icon: Send },
  { value: "both", title: "Inline + popup", desc: "Oba warianty aktywne.", icon: MailCheck },
];

function ModePicker({
  mode,
  onChange,
}: {
  mode: NewsletterMode;
  onChange: (m: NewsletterMode) => void;
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {MODE_OPTIONS.map((o) => {
        const active = mode === o.value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              "text-left p-3 rounded-lg border transition-all " +
              (active
                ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                : "border-border hover:border-primary/40 hover:bg-muted/40")
            }
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon className={"w-4 h-4 " + (active ? "text-primary" : "text-muted-foreground")} />
              <span className="text-sm font-medium">{o.title}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">{o.desc}</p>
          </button>
        );
      })}
    </div>
  );
}

function DualPreview({ settings }: { settings: NewsletterSettings }) {
  const [lang, setLang] = useState<"pl" | "en">("pl");
  const showInline = settings.mode === "inline" || settings.mode === "both";
  const showPopup = settings.mode === "popup" || settings.mode === "both";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setLang("pl")}
          className={
            "px-2.5 py-1 text-xs rounded " +
            (lang === "pl"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground")
          }
        >
          PL
        </button>
        <button
          type="button"
          onClick={() => setLang("en")}
          className={
            "px-2.5 py-1 text-xs rounded " +
            (lang === "en"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground")
          }
        >
          EN
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PreviewFrame title="Inline" active={showInline}>
          <div className="p-4">
            {settings.enabled ? (
              <NewsletterForm lang={lang} variant="card" source="admin-preview" />
            ) : (
              <p className="text-center text-sm text-muted-foreground py-8">
                Formularz jest wylaczony.
              </p>
            )}
          </div>
        </PreviewFrame>
        <PreviewFrame title="Popup" active={showPopup}>
          <PopupPreview settings={settings} lang={lang} />
        </PreviewFrame>
      </div>
    </div>
  );
}

function PreviewFrame({
  title,
  active,
  children,
}: {
  title: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden bg-gradient-to-br from-muted/40 to-muted/10">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-background/50">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <span
          className={
            "text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider " +
            (active
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground")
          }
        >
          {active ? "aktywny" : "wylaczony"}
        </span>
      </div>
      <div className="min-h-[320px]">{children}</div>
    </div>
  );
}

function PopupPreview({ settings, lang }: { settings: NewsletterSettings; lang: "pl" | "en" }) {
  if (!settings.popup_enabled) {
    return <p className="text-center text-sm text-muted-foreground py-16">Popup jest wylaczony.</p>;
  }

  // Zsynchronizowane z /admin/newsletter/popup - renderujemy dokument z buildera
  // gdy jest zapisany. Legacy fallback tylko dla starych tenantow bez popup_doc.
  if (settings.popup_doc) {
    const p = settings.popup_doc.popup ?? {};
    return (
      <div className="p-6 flex items-center justify-center">
        <div
          className="w-full max-w-sm overflow-hidden shadow-2xl border border-white/10"
          style={{
            backgroundColor: p.bg ?? settings.popup_bg_color,
            color: p.fg ?? settings.popup_text_color,
            borderRadius: `${p.radius ?? settings.popup_border_radius_px}px`,
          }}
        >
          <div className="p-5">
            <NewsletterDocRenderer
              doc={settings.popup_doc}
              settings={settings}
              lang={lang}
              source="admin-preview"
            />
          </div>
        </div>
      </div>
    );
  }

  const title = lang === "pl" ? settings.popup_title_pl : settings.popup_title_en;
  const desc = lang === "pl" ? settings.popup_description_pl : settings.popup_description_en;
  const cta = lang === "pl" ? settings.popup_cta_pl : settings.popup_cta_en;
  const policyHtml = sanitizeHtml(
    (lang === "pl" ? settings.policy_html_pl : settings.policy_html_en) ?? "",
  );
  const emailPh = lang === "pl" ? "twoj@email.pl" : "you@email.com";

  return (
    <div className="p-6 flex items-center justify-center">
      <div
        className="w-full max-w-sm rounded-xl overflow-hidden shadow-2xl border border-white/10"
        style={{
          backgroundColor: settings.popup_bg_color,
          color: settings.popup_text_color,
          borderRadius: `${settings.popup_border_radius_px}px`,
        }}
      >
        {settings.popup_cover_url && (
          <img src={settings.popup_cover_url} alt="" className="w-full h-24 object-cover" />
        )}
        <div className="p-5 space-y-3">
          <h4 className="font-display text-lg" style={{ color: settings.popup_text_color }}>
            {title || "-"}
          </h4>
          {desc && (
            <p className="text-xs" style={{ color: settings.popup_muted_color }}>
              {desc}
            </p>
          )}
          <input
            className="w-full px-3 py-2 rounded text-xs"
            style={{ background: "rgba(255,255,255,0.08)", color: settings.popup_text_color }}
            placeholder={emailPh}
            readOnly
          />
          <button
            type="button"
            className="w-full px-4 py-2 rounded text-xs font-medium"
            style={{
              backgroundColor: settings.popup_accent_color,
              color: settings.popup_accent_text_color,
            }}
          >
            {cta || (lang === "pl" ? "Zapisz sie" : "Subscribe")}
          </button>
          {policyHtml && (
            <p
              className="text-[10px] leading-relaxed [&_a]:underline"
              style={{ color: settings.popup_muted_color }}
              dangerouslySetInnerHTML={{ __html: policyHtml }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
