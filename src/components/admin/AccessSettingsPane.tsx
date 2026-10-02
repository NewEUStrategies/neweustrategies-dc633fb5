import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { convertToDisplayCurrency } from "@/lib/billing/displayCurrency";

import type {
  AccessEntityType,
  AccessMode,
  AccessPlan,
  ContentAccessRule,
} from "@/hooks/useContentAccess";
import {
  normalizeMeteringPolicy,
  useMeteringSettings,
  type MeteringPolicy,
} from "@/lib/access/metering";
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
import { toastError } from "@/lib/toastError";
import { useTranslation } from "react-i18next";
import { useMembershipTiers, tierName } from "@/lib/billing/tiers";
import "@/lib/i18n-admin-post-panes";

type Props = { entityType: AccessEntityType; entityId: string | null };

type PasswordState = {
  hasPassword: boolean;
  newPassword: string;
  hintPl: string;
  hintEn: string;
};

const NO_PASSWORD: PasswordState = { hasPassword: false, newPassword: "", hintPl: "", hintEn: "" };

/** Formularz bytu, który reguły jeszcze NIE MA (świeży obiekt na każde wywołanie). */
function defaultRule(): Partial<ContentAccessRule> {
  return {
    mode: "public",
    plan_ids: [],
    one_time_price_cents: null,
    one_time_currency: "PLN",
    teaser_pl: "",
    teaser_en: "",
    metering_policy: "inherit",
  };
}

/**
 * Faza odczytu panelu. "error" to stan OSOBNY od "ready bez reguły": tylko
 * udany odczyt mówi, że reguły nie ma - nieudany nie mówi nic, więc formularz
 * (i przycisk zapisu) w ogóle wtedy nie istnieje.
 */
type LoadState = "loading" | "error" | "ready";

interface LoadedAccess {
  plans: AccessPlan[];
  /** `null` = odczyt SIĘ UDAŁ i wiersza reguły nie ma. */
  rule: ContentAccessRule | null;
  /** `updated_at` przeczytanego wiersza - wersja, względem której idzie UPDATE. */
  version: string | null;
  password: PasswordState;
}

/**
 * Cztery odczyty panelu naraz. RZUCA przy błędzie KTÓREGOKOLWIEK z nich -
 * każdy zasila pole, które zapis odsyła do bazy: reguła (tryb), flaga hasła
 * (wyjście z trybu hasła kasuje hash), podpowiedzi (zapis NULL-uje je przy
 * pustym polu) i plany (przełączniki `plan_ids`). Wcześniej destrukturyzowane
 * było wyłącznie `data`, więc odmowa odczytu (42501, sieć, PostgREST)
 * wyglądała jak „reguły nie ma" i pierwsze „Zapisz dostęp" upsertowało tryb
 * `public` na istniejący paywall.
 */
async function loadAccess(
  entityType: AccessEntityType,
  entityId: string | null,
): Promise<LoadedAccess> {
  const [plansRes, ruleRes, hasPasswordRes, hintsRes] = await Promise.all([
    supabase.from("access_plans").select("*").eq("active", true).order("sort_order"),
    entityId
      ? supabase
          .from("content_access")
          .select(
            "id, entity_type, entity_id, mode, plan_ids, one_time_price_cents, one_time_currency, teaser_pl, teaser_en, min_tier_rank, metering_policy, tenant_id, updated_at",
          )
          .eq("entity_type", entityType)
          .eq("entity_id", entityId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    entityId
      ? supabase.rpc("content_access_has_password", {
          _entity_type: entityType,
          _entity_id: entityId,
        })
      : Promise.resolve({ data: false, error: null }),
    // Kolumny password_hint_* są odebrane rolom klienckim (REVOKE
    // 20260801121000 - kontrakt security_hardening_rls_test) - hinty
    // czytamy przez SECURITY DEFINER get_password_hint, jak Paywall.
    // RPC zwraca wiersz tylko w trybie 'password' - w innych trybach
    // hinty i tak są NULL-owane przy zapisie.
    entityId
      ? supabase
          .rpc("get_password_hint", { _entity_type: entityType, _entity_id: entityId })
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const res of [plansRes, ruleRes, hasPasswordRes, hintsRes]) {
    if (res.error) throw res.error;
  }
  const version = ruleRes.data?.updated_at ?? null;
  const rule = (ruleRes.data as ContentAccessRule | null) ?? null;
  const hintRow = hintsRes.data as { hint_pl?: string | null; hint_en?: string | null } | null;
  return {
    plans: (plansRes.data as AccessPlan[] | null) ?? [],
    rule,
    version,
    // Hash i podpowiedzi żyją w wierszu reguły - bez wiersza nie ma czego
    // pokazywać, niezależnie od tego, co odda RPC.
    password: rule
      ? {
          hasPassword: !!hasPasswordRes.data,
          newPassword: "",
          hintPl: hintRow?.hint_pl ?? "",
          hintEn: hintRow?.hint_en ?? "",
        }
      : NO_PASSWORD,
  };
}

export function AccessSettingsPane(props: Props) {
  // Klucz = byt. Zmiana wpisu/strony na tej samej instancji panelu montuje
  // formularz OD ZERA: stan poprzedniego bytu (reguła, wersja, hasło) i
  // spóźnione `setState` jego odczytu ALBO ZAPISU w locie trafiają w
  // odmontowaną instancję, więc nie mają jak przeciec pod nowe `entityId`.
  return <AccessSettingsForm key={`${props.entityType}:${props.entityId ?? ""}`} {...props} />;
}

function AccessSettingsForm({ entityType, entityId }: Props) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const lang = i18n.language === "en" ? "en" : "pl";
  // Warstwy do progu rangowego (drabinka Plus/Pro dla treści). Tylko warstwy
  // sprzedażowe (ranga > 0), posortowane rosnąco - "Konto bezpłatne" nie jest
  // progiem dostępu.
  const tiersQ = useMembershipTiers();
  const rankTiers = (tiersQ.data ?? [])
    .filter((tier) => tier.rank > 0)
    .sort((a, b) => a.rank - b.rank);
  const [plans, setPlans] = useState<AccessPlan[]>([]);
  const [rule, setRule] = useState<Partial<ContentAccessRule>>(defaultRule);
  // Wersja (`updated_at`) wiersza reguły wg ostatniego udanego odczytu albo
  // zapisu; `null` = wiersza w bazie nie ma. Decyduje o rodzaju zapisu
  // (insert vs update) i jest WARUNKIEM update'u, patrz `save`.
  const [version, setVersion] = useState<string | null>(null);
  // Globalna konfiguracja meteringu - podpowiedź w panelu, gdy jest wyłączona.
  const { data: meterSettings } = useMeteringSettings();
  const [pwd, setPwd] = useState<PasswordState>(NO_PASSWORD);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  // Licznik prób odczytu: „Spróbuj ponownie" i wykryta zmiana reguły w
  // międzyczasie podbijają go, a efekt czyta wtedy wszystko od nowa.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Ponowny odczyt („Spróbuj ponownie", reguła zmieniona w międzyczasie)
    // wraca do "loading": formularz sprzed odczytu nie może zostać na ekranie
    // ani dać się zapisać, a odpowiedź odczytu wyprzedzonego (albo panelu
    // odmontowanego) nie ma prawa nadpisać stanu.
    let superseded = false;
    setLoadState("loading");
    loadAccess(entityType, entityId).then(
      (loaded) => {
        if (superseded) return;
        setPlans(loaded.plans);
        // Brak reguły = formularz domyślny, a nie szkic sprzed ponownego odczytu.
        setRule(loaded.rule ?? defaultRule());
        setVersion(loaded.version);
        setPwd(loaded.password);
        setLoadState("ready");
      },
      (error: unknown) => {
        if (superseded) return;
        toastError(error, "load");
        setLoadState("error");
      },
    );
    return () => {
      superseded = true;
    };
  }, [entityType, entityId, loadAttempt]);

  // Podsumowanie dostępu w zakładce „Ogólne" (PostGeneralOverview) trzyma tę
  // samą regułę w cache ze `staleTime` - po zapisie ma ją przeczytać od nowa.
  const invalidateSummary = () =>
    void queryClient.invalidateQueries({ queryKey: ["content_access", entityType, entityId] });

  // Baza ma inną regułę niż ta, którą panel przeczytał. Zapis byłby ślepy,
  // więc wczytujemy aktualny stan i każemy powtórzyć zmianę.
  const reloadStaleRule = () => {
    toast.error(t("adminPostPanes.access.staleRule"));
    setLoadAttempt((n) => n + 1);
  };

  // RPC-e hasła same robią UPDATE wiersza (`updated_at = now()`), więc po nich
  // wersja znana panelowi jest nieaktualna i KOLEJNY zapis zderzyłby się z
  // własną zmianą. Doczytujemy samą wersję; gdy to się nie uda, panel czyta
  // wszystko od nowa, zamiast zapisywać względem wersji, której nie zna.
  const refreshVersion = async (id: string) => {
    const { data, error } = await supabase
      .from("content_access")
      .select("updated_at")
      .eq("entity_type", entityType)
      .eq("entity_id", id)
      .maybeSingle();
    if (error || !data) return setLoadAttempt((n) => n + 1);
    setVersion(data.updated_at);
  };

  const save = async () => {
    if (!entityId) return toast.error(t("adminPostPanes.access.saveContentFirst"));
    // Formularz istnieje tylko po udanym odczycie - to jest bezpiecznik na
    // wypadek, gdyby ktoś kiedyś wyrenderował przycisk poza tym stanem.
    if (loadState !== "ready") return;
    if (rule.mode === "password" && !pwd.hasPassword && !pwd.newPassword.trim()) {
      return toast.error(t("adminPostPanes.access.setPasswordForMode"));
    }
    setSaving(true);
    try {
      const fields = {
        mode: rule.mode ?? "public",
        plan_ids: rule.plan_ids ?? [],
        one_time_price_cents: rule.one_time_price_cents ?? null,
        one_time_currency: rule.one_time_currency || "PLN",
        teaser_pl: rule.teaser_pl ?? null,
        teaser_en: rule.teaser_en ?? null,
        min_tier_rank: rule.min_tier_rank ?? 0,
        metering_policy: normalizeMeteringPolicy(rule.metering_policy),
        password_hint_pl: rule.mode === "password" ? pwd.hintPl || null : null,
        password_hint_en: rule.mode === "password" ? pwd.hintEn || null : null,
      };
      // ZAPIS ODPOWIADA TEMU, CO PANEL PRZECZYTAŁ - nie ślepy upsert.
      // Upsert po (typ, byt) nadpisywał KAŻDĄ regułę, także taką, której
      // panel nie widział (inna karta, ukryta przed odczytem). Teraz:
      //   - reguły nie było -> INSERT: istniejący wiersz kończy się 23505
      //     (UNIQUE (entity_type, entity_id)) zamiast cichego nadpisania;
      //   - reguła była -> UPDATE warunkowany WERSJĄ z odczytu (optimistic
      //     lock jak `updateOrganization`, `updated_at` bumpuje trigger
      //     trg_content_access_updated). Zero wierszy = reguła zmieniła się w
      //     międzyczasie (inna karta, wyjątki meteringu w /admin/paywall),
      //     zniknęła albo RLS odciął zapis bez błędu - to NIE jest sukces.
      //     Bez warunku wersji karta z nieaktualnym „public" zdejmowała
      //     paywall ustawiony chwilę wcześniej gdzie indziej.
      const { data: written, error } = version
        ? await supabase
            .from("content_access")
            .update(fields)
            .eq("entity_type", entityType)
            .eq("entity_id", entityId)
            .eq("updated_at", version)
            .select("updated_at")
        : await supabase
            .from("content_access")
            .insert({ ...fields, entity_type: entityType, entity_id: entityId })
            .select("updated_at");
      if (error) {
        if (!version && error.code === "23505") return reloadStaleRule();
        return toastError(error, "save");
      }
      const savedVersion = written?.[0]?.updated_at;
      if (!savedVersion) return reloadStaleRule();
      // Nowa baza optimistic-locka - bez niej drugi zapis w tej samej sesji
      // zgłaszałby FAŁSZYWY konflikt z własnym zapisem.
      setVersion(savedVersion);
      invalidateSummary();

      // Password mutations run through SECURITY DEFINER RPCs so the plaintext is
      // bcrypt-hashed server-side and never stored in the base write path.
      if (rule.mode === "password" && pwd.newPassword.trim()) {
        const { error: rpcErr } = await supabase.rpc("admin_set_content_password", {
          _entity_type: entityType,
          _entity_id: entityId,
          _password: pwd.newPassword,
          _hint_pl: pwd.hintPl || "",
          _hint_en: pwd.hintEn || "",
        });
        if (rpcErr) return toastError(rpcErr, "save");
        setPwd((s) => ({ ...s, hasPassword: true, newPassword: "" }));
        await refreshVersion(entityId);
      } else if (rule.mode !== "password" && pwd.hasPassword) {
        // Leaving password mode clears the stored hash so it can't be reused later.
        // Błąd był tu połykany: panel meldował sukces i „zapominał" o haśle,
        // choć hash w bazie zostawał.
        const { error: clearErr } = await supabase.rpc("admin_clear_content_password", {
          _entity_type: entityType,
          _entity_id: entityId,
        });
        if (clearErr) return toastError(clearErr, "save");
        setPwd(NO_PASSWORD);
        await refreshVersion(entityId);
      }

      toast.success(t("adminPostPanes.access.accessSaved"));
    } finally {
      setSaving(false);
    }
  };

  const clearPassword = async () => {
    if (!entityId) return;
    const { error } = await supabase.rpc("admin_clear_content_password", {
      _entity_type: entityType,
      _entity_id: entityId,
    });
    if (error) return toastError(error, "delete");
    setPwd(NO_PASSWORD);
    await refreshVersion(entityId);
    invalidateSummary();
    toast.success(t("adminPostPanes.access.passwordRemoved"));
  };

  const togglePlan = (id: string) => {
    const cur = rule.plan_ids ?? [];
    setRule({ ...rule, plan_ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  if (loadState === "loading")
    return (
      <div className="text-xs text-muted-foreground p-3">{t("adminPostPanes.access.loading")}</div>
    );

  if (loadState === "error")
    return (
      <div role="alert" className="space-y-2 border border-destructive/40 rounded-lg p-4 bg-card">
        <h3 className="font-semibold text-sm">{t("adminPostPanes.access.title")}</h3>
        <p className="text-sm">{t("adminPostPanes.access.loadError")}</p>
        <p className="text-[11px] text-muted-foreground">
          {t("adminPostPanes.access.loadErrorHelper")}
        </p>
        <Button size="sm" variant="outline" onClick={() => setLoadAttempt((n) => n + 1)}>
          {t("adminPostPanes.access.retry")}
        </Button>
      </div>
    );

  return (
    <div className="space-y-4 border border-border rounded-lg p-4 bg-card">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">{t("adminPostPanes.access.title")}</h3>
        <Button size="sm" onClick={save} disabled={saving}>
          {t("adminPostPanes.access.saveAccess")}
        </Button>
      </div>

      <div>
        <Label className="text-xs">{t("adminPostPanes.access.mode")}</Label>
        <Select
          value={rule.mode ?? "public"}
          onValueChange={(v) => setRule({ ...rule, mode: v as AccessMode })}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="public">{t("adminPostPanes.access.modePublic")}</SelectItem>
            <SelectItem value="members">{t("adminPostPanes.access.modeMembers")}</SelectItem>
            <SelectItem value="paid">{t("adminPostPanes.access.modePaid")}</SelectItem>
            <SelectItem value="password">{t("adminPostPanes.access.modePassword")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {rule.mode === "password" && (
        <div className="space-y-3 border border-border rounded-md p-3 bg-muted/30">
          <div className="flex items-center justify-between">
            <Label className="text-xs">
              {pwd.hasPassword
                ? t("adminPostPanes.access.passwordSet")
                : t("adminPostPanes.access.passwordSetLabel")}
            </Label>
            {pwd.hasPassword && (
              <Button size="sm" variant="ghost" onClick={clearPassword}>
                {t("adminPostPanes.access.removePassword")}
              </Button>
            )}
          </div>
          <Input
            type="password"
            autoComplete="new-password"
            value={pwd.newPassword}
            onChange={(e) => setPwd({ ...pwd, newPassword: e.target.value })}
            placeholder={
              pwd.hasPassword
                ? t("adminPostPanes.access.newPasswordPlaceholder")
                : t("adminPostPanes.access.enterPasswordPlaceholder")
            }
            className="h-9"
          />
          <p className="text-[11px] text-muted-foreground">
            {t("adminPostPanes.access.passwordHashedHelper")}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("adminPostPanes.access.hintPl")}</Label>
              <Input
                value={pwd.hintPl}
                onChange={(e) => setPwd({ ...pwd, hintPl: e.target.value })}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">{t("adminPostPanes.access.hintEn")}</Label>
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
            <Label className="text-xs">{t("adminPostPanes.access.plansLabel")}</Label>
            {plans.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-1">
                {t("adminPostPanes.access.noPlans")}
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
                      {p.currency?.toUpperCase() === "PLN" && (
                        <span className="ml-1 text-[11px] text-muted-foreground">
                          (EN:{" "}
                          {(
                            convertToDisplayCurrency(p.price_cents, p.currency, "EUR").cents / 100
                          ).toFixed(2)}{" "}
                          EUR)
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("adminPostPanes.access.oneTimePrice")}</Label>
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
              <Label className="text-xs">{t("adminPostPanes.access.currency")}</Label>
              <Input
                value={rule.one_time_currency ?? "PLN"}
                onChange={(e) => setRule({ ...rule, one_time_currency: e.target.value })}
                className="h-9"
              />
            </div>
          </div>
        </>
      )}

      {(rule.mode === "members" || rule.mode === "paid") && (
        <div>
          <Label className="text-xs">{t("adminPostPanes.access.minTier")}</Label>
          <Select
            value={String(rule.min_tier_rank ?? 0)}
            onValueChange={(v) => setRule({ ...rule, min_tier_rank: Number(v) || 0 })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t("adminPostPanes.access.minTierNone")}</SelectItem>
              {rankTiers.map((tier) => (
                <SelectItem key={tier.id} value={String(tier.rank)}>
                  {tierName(tier, lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("adminPostPanes.access.minTierHint")}
          </p>
        </div>
      )}

      {(rule.mode === "members" || rule.mode === "paid") && (
        <div>
          <Label className="text-xs">{t("adminPostPanes.access.metering")}</Label>
          <Select
            value={normalizeMeteringPolicy(rule.metering_policy)}
            onValueChange={(v) => setRule({ ...rule, metering_policy: v as MeteringPolicy })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">{t("adminPostPanes.access.meteringInherit")}</SelectItem>
              <SelectItem value="metered">{t("adminPostPanes.access.meteringMetered")}</SelectItem>
              <SelectItem value="exempt">{t("adminPostPanes.access.meteringExempt")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("adminPostPanes.access.meteringHelper")}
            {meterSettings && !meterSettings.enabled && (
              <> {t("adminPostPanes.access.meteringDisabledHint")}</>
            )}
          </p>
        </div>
      )}

      {rule.mode !== "public" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">{t("adminPostPanes.access.teaserPl")}</Label>
            <Textarea
              rows={3}
              value={rule.teaser_pl ?? ""}
              onChange={(e) => setRule({ ...rule, teaser_pl: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">{t("adminPostPanes.access.teaserEn")}</Label>
            <Textarea
              rows={3}
              value={rule.teaser_en ?? ""}
              onChange={(e) => setRule({ ...rule, teaser_en: e.target.value })}
            />
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">{t("adminPostPanes.access.teaserHelper")}</p>
    </div>
  );
}
