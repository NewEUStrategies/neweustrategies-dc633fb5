// Organizm: wersje konfiguracji bannera cookies i zgód. Historia pochodzi z
// site_settings_revisions (migawki wyzwalacza), podgląd renderuje treść danej
// wersji, a przywrócenie zapisuje ją z powrotem do ustawień serwisu.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { PreviewFrame } from "../atoms/PreviewFrame";
import { VersionRow } from "../molecules/VersionRow";
import { useSiteSettingsRevisions } from "@/lib/admin/useSiteSettingsRevisions";
import { uiLocale } from "@/lib/i18n/format";
import { toJson } from "@/lib/builder/types";
import {
  COOKIE_BANNER_DEFAULTS,
  COOKIE_BANNER_SETTINGS_KEY,
  bannerStyleVars,
  useCookieBannerConfig,
  type CookieBannerConfig,
} from "@/lib/cookieBanner/config";

function asConfig(value: unknown): CookieBannerConfig {
  if (typeof value !== "object" || value === null) return COOKIE_BANNER_DEFAULTS;
  const raw = value as Partial<CookieBannerConfig>;
  return {
    enabled: raw.enabled ?? COOKIE_BANNER_DEFAULTS.enabled,
    languageSwitcher: raw.languageSwitcher ?? COOKIE_BANNER_DEFAULTS.languageSwitcher,
    autoInventory: raw.autoInventory ?? COOKIE_BANNER_DEFAULTS.autoInventory,
    logo: { ...COOKIE_BANNER_DEFAULTS.logo, ...(raw.logo ?? {}) },
    links: Array.isArray(raw.links) ? raw.links : COOKIE_BANNER_DEFAULTS.links,
    colors: { ...COOKIE_BANNER_DEFAULTS.colors, ...(raw.colors ?? {}) },
    copy: {
      pl: { ...COOKIE_BANNER_DEFAULTS.copy.pl, ...(raw.copy?.pl ?? {}) },
      en: { ...COOKIE_BANNER_DEFAULTS.copy.en, ...(raw.copy?.en ?? {}) },
    },
  };
}

function formatDate(iso: string, lang: "pl" | "en") {
  try {
    return new Intl.DateTimeFormat(uiLocale(lang), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const CURRENT_ID = "__current__";

export function CookieVersionsPane({ lang }: { lang: "pl" | "en" }) {
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const revisions = useSiteSettingsRevisions(COOKIE_BANNER_SETTINGS_KEY);
  const current = useCookieBannerConfig();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>(CURRENT_ID);
  const [previewLang, setPreviewLang] = useState<"pl" | "en">(lang);

  const selected = useMemo(
    () => revisions.data?.find((r) => r.id === selectedId) ?? null,
    [revisions.data, selectedId],
  );
  const config = selected ? asConfig(selected.value) : current;
  const copy = config.copy[previewLang];

  const restore = useMutation({
    mutationFn: async (value: CookieBannerConfig) => {
      const { error } = await supabase
        .from("site_settings")
        .upsert(
          { key: COOKIE_BANNER_SETTINGS_KEY, value: toJson(value) },
          { onConflict: "tenant_id,key" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["site-setting", COOKIE_BANNER_SETTINGS_KEY] });
      void qc.invalidateQueries({ queryKey: ["site_settings_revisions"] });
      toast.success(L("Przywrócono wersję bannera", "Banner version restored"));
    },
    onError: () => toast.error(L("Nie udało się przywrócić", "Restore failed")),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="space-y-2">
        <div className="rounded-md border border-border overflow-hidden">
          <ul className="divide-y divide-border">
            <VersionRow
              title={L("Wersja aktywna", "Live version")}
              meta={L("Obecna konfiguracja bannera", "Current banner configuration")}
              active={selectedId === CURRENT_ID}
              onSelect={() => setSelectedId(CURRENT_ID)}
            />
            {(revisions.data ?? []).map((r) => (
              <VersionRow
                key={r.id}
                title={r.author_name ?? L("Zmiana", "Change")}
                meta={formatDate(r.changed_at, lang)}
                active={selectedId === r.id}
                onSelect={() => setSelectedId(r.id)}
              />
            ))}
          </ul>
        </div>
        {selected ? (
          <Button
            size="sm"
            variant="outline"
            disabled={restore.isPending}
            onClick={() => restore.mutate(asConfig(selected.value))}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {L("Przywróć tę wersję", "Restore this version")}
          </Button>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {L("Podgląd języka:", "Preview language:")}
          </span>
          {(["pl", "en"] as const).map((l) => (
            <Button
              key={l}
              size="sm"
              variant={previewLang === l ? "default" : "outline"}
              aria-pressed={previewLang === l}
              onClick={() => setPreviewLang(l)}
            >
              {l.toUpperCase()}
            </Button>
          ))}
        </div>
        <PreviewFrame
          height={420}
          label={L("Tak zobaczy to odwiedzający", "What a visitor will see")}
        >
          <div className="p-4">
            <div
              className="rounded-lg border border-border bg-card p-5 shadow-sm"
              style={bannerStyleVars(config.colors)}
            >
              <h3 className="text-base font-semibold">{copy.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{copy.intro}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {[
                  [copy.categoryNecessary, copy.descNecessary],
                  [copy.categoryFunctional, copy.descFunctional],
                  [copy.categoryAnalytics, copy.descAnalytics],
                  [copy.categoryMarketing, copy.descMarketing],
                ].map(([name, desc]) => (
                  <div key={name} className="rounded-md border border-border p-3">
                    <p className="text-xs font-medium">{name}</p>
                    <p className="mt-1 text-[0.6875rem] text-muted-foreground">{desc}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm">{copy.acceptAll}</Button>
                <Button size="sm" variant="outline">
                  {copy.rejectAll}
                </Button>
                <Button size="sm" variant="ghost">
                  {copy.saveSelection}
                </Button>
              </div>
              <p className="mt-3 text-[0.6875rem] text-muted-foreground">
                {config.enabled
                  ? L("Banner włączony", "Banner enabled")
                  : L("Banner wyłączony", "Banner disabled")}
              </p>
            </div>
          </div>
        </PreviewFrame>
      </div>
    </div>
  );
}
