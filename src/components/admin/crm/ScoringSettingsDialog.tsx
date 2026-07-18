// Ustawienia lead scoringu (admin): wagi sygnałów, decay, progi pasm oraz
// hurtowe przeliczenie tenanta. Zapis do crm_scoring_settings (RLS admin).
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getCrmScoringSettings,
  upsertCrmScoringSettings,
  recomputeAllLeadScores,
} from "@/lib/crm.functions";
import {
  DEFAULT_SCORING_SETTINGS,
  DEFAULT_SCORING_WEIGHTS,
  SCORE_SIGNAL_KEYS,
  SCORE_SIGNAL_LABELS,
  mergedWeights,
  parseScoringSettings,
  type ScoringSettings,
} from "@/lib/crm/scoring";

const COPY = {
  pl: {
    open: "Scoring",
    title: "Ustawienia lead scoringu",
    desc: "Wagi sygnałów, wygasanie i progi pasm. Wynik liczy się automatycznie przy każdym nowym sygnale.",
    enabled: "Scoring włączony",
    halfLife: "Półokres wygasania (dni)",
    horizon: "Horyzont sygnałów (dni)",
    thresholds: "Progi pasm (punkty)",
    hot: "Gorący od",
    warm: "Ciepły od",
    cool: "Chłodny od",
    weights: "Wagi sygnałów",
    signal: "Sygnał",
    points: "Punkty",
    cap: "Sufit",
    save: "Zapisz",
    saved: "Zapisano ustawienia scoringu",
    recomputeAll: "Przelicz wszystkie leady",
    recomputed: (n: number) => `Przeliczono ${n} leadów`,
    invalid: "Progi muszą maleć: gorący > ciepły > chłodny.",
  },
  en: {
    open: "Scoring",
    title: "Lead scoring settings",
    desc: "Signal weights, decay and band thresholds. Scores recompute automatically on every new signal.",
    enabled: "Scoring enabled",
    halfLife: "Decay half-life (days)",
    horizon: "Signal horizon (days)",
    thresholds: "Band thresholds (points)",
    hot: "Hot from",
    warm: "Warm from",
    cool: "Cool from",
    weights: "Signal weights",
    signal: "Signal",
    points: "Points",
    cap: "Cap",
    save: "Save",
    saved: "Scoring settings saved",
    recomputeAll: "Recompute all leads",
    recomputed: (n: number) => `Recomputed ${n} leads`,
    invalid: "Thresholds must descend: hot > warm > cool.",
  },
} as const;

export function ScoringSettingsDialog({ lang }: { lang: "pl" | "en" }) {
  const t = COPY[lang];
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ScoringSettings>(DEFAULT_SCORING_SETTINGS);

  const settingsQ = useQuery({
    queryKey: ["crm-scoring-settings"],
    enabled: open,
    queryFn: async () => {
      const r = await getCrmScoringSettings();
      return parseScoringSettings(JSON.parse((r as { json: string }).json));
    },
  });

  useEffect(() => {
    if (settingsQ.data) setForm(settingsQ.data);
  }, [settingsQ.data]);

  const saveMut = useMutation({
    mutationFn: async (s: ScoringSettings) => upsertCrmScoringSettings({ data: s }),
    onSuccess: () => {
      toast.success(t.saved);
      qc.invalidateQueries({ queryKey: ["crm-scoring-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recomputeMut = useMutation({
    mutationFn: async () => recomputeAllLeadScores({ data: { limit: 5000 } }),
    onSuccess: (r: { processed: number }) => {
      toast.success(t.recomputed(r.processed));
      qc.invalidateQueries({ queryKey: ["crm-leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const weights = mergedWeights(form.weights);

  const setWeight = (key: string, field: "points" | "cap", raw: string) => {
    const value = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(value)) return;
    setForm((prev) => ({
      ...prev,
      weights: {
        ...prev.weights,
        [key]: { ...prev.weights[key as keyof typeof prev.weights], [field]: value },
      },
    }));
  };

  const setNum =
    (
      field:
        | "half_life_days"
        | "horizon_days"
        | "hot_threshold"
        | "warm_threshold"
        | "cool_threshold",
    ) =>
    (raw: string) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return;
      setForm((prev) => ({ ...prev, [field]: Math.round(value) }));
    };

  const thresholdsValid =
    form.hot_threshold > form.warm_threshold && form.warm_threshold > form.cool_threshold;

  const onSave = () => {
    if (!thresholdsValid) {
      toast.error(t.invalid);
      return;
    }
    // Zapisujemy tylko realne nadpisania - domyślne wagi zostają w bazie/SQL.
    const overrides: ScoringSettings["weights"] = {};
    for (const key of SCORE_SIGNAL_KEYS) {
      const base = DEFAULT_SCORING_WEIGHTS[key];
      const current = weights[key];
      if (current.points !== base.points || current.cap !== base.cap) {
        overrides[key] = { points: current.points, cap: current.cap };
      }
    }
    saveMut.mutate({ ...form, weights: overrides });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Gauge className="w-3.5 h-3.5 mr-1" />
          {t.open}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.desc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm((p) => ({ ...p, enabled: Boolean(v) }))}
            />
            {t.enabled}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12px]">{t.halfLife}</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={form.half_life_days}
                onChange={(e) => setNum("half_life_days")(e.target.value)}
                className="h-8 mt-1"
              />
            </div>
            <div>
              <Label className="text-[12px]">{t.horizon}</Label>
              <Input
                type="number"
                min={7}
                max={1095}
                value={form.horizon_days}
                onChange={(e) => setNum("horizon_days")(e.target.value)}
                className="h-8 mt-1"
              />
            </div>
          </div>

          <div>
            <Label className="text-[12px]">{t.thresholds}</Label>
            <div className="grid grid-cols-3 gap-3 mt-1">
              {(
                [
                  ["hot_threshold", t.hot],
                  ["warm_threshold", t.warm],
                  ["cool_threshold", t.cool],
                ] as const
              ).map(([field, label]) => (
                <div key={field}>
                  <span className="text-[11px] text-muted-foreground">{label}</span>
                  <Input
                    type="number"
                    min={1}
                    value={form[field]}
                    onChange={(e) => setNum(field)(e.target.value)}
                    className="h-8 mt-0.5"
                    aria-invalid={!thresholdsValid}
                  />
                </div>
              ))}
            </div>
            {!thresholdsValid && <p className="text-[11px] text-destructive mt-1">{t.invalid}</p>}
          </div>

          <div>
            <Label className="text-[12px]">{t.weights}</Label>
            <div className="rounded-md border mt-1 overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left p-2">{t.signal}</th>
                    <th className="text-left p-2 w-24">{t.points}</th>
                    <th className="text-left p-2 w-24">{t.cap}</th>
                  </tr>
                </thead>
                <tbody>
                  {SCORE_SIGNAL_KEYS.map((key) => (
                    <tr key={key} className="border-t">
                      <td className="p-2">{SCORE_SIGNAL_LABELS[lang][key]}</td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          max={1000}
                          value={weights[key].points}
                          onChange={(e) => setWeight(key, "points", e.target.value)}
                          className="h-7"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          max={1000}
                          value={weights[key].cap}
                          onChange={(e) => setWeight(key, "cap", e.target.value)}
                          className="h-7"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={recomputeMut.isPending}
            onClick={() => recomputeMut.mutate()}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1 ${recomputeMut.isPending ? "animate-spin" : ""}`}
            />
            {t.recomputeAll}
          </Button>
          <Button type="button" onClick={onSave} disabled={saveMut.isPending || !thresholdsValid}>
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
