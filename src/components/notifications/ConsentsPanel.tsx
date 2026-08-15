// Widok zarządzania zgodami RODO dla zalogowanego użytkownika. Każda zgoda:
// - definicja z katalogu (`consentCatalog.ts`) - klucz, wersja, kategoria,
// - bieżący stan z `user_consents` (via server-fn),
// - przełącznik natychmiast zapisujący decyzję (audit-log w `user_consent_events`).
//
// Kluczowa własność: klient nigdy nie pisze do tabel bezpośrednio - server-fn
// wywołuje `set_user_consent`, które atomowo aktualizuje stan i dopisuje wpis
// audit-logu wraz z IP i User-Agent czytanymi po stronie serwera.
//
// Unifikacja z CMP: kategoria "cookies" jest dwukierunkowo spięta z banerem
// zgód. Przełącznik cookie zapisuje przez ścieżkę CMP (useConsent().save),
// która sama dopisuje wpis do rejestru (registryBridge) - jeden pisarz,
// zero rozjazdu między stanem runtime a audytem. Stan tych wierszy pochodzi
// z CMP (źródło prawdy dla bramkowania skryptów), metadane dat z rejestru.
import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, Cookie, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  buildConsentViews,
  useMyConsentEvents,
  useMyConsents,
  useSetMyConsent,
  type ConsentView,
} from "@/lib/notifications/useConsents";
import type { ConsentCategory } from "@/lib/notifications/consentCatalog";
import { useConsent, useGpcSignal } from "@/lib/ads/consent";
import {
  GpcCategoryBadgeSlot,
  GpcEventBadgeSlot,
  GpcNoticeSlot,
  GpcRegistryNoteSlot,
} from "@/components/consent/GpcSurfaceSlots";
import { isGpcClampedRegistryKey, isGpcOverrideValid } from "@/lib/consent/gpc";
import {
  REGISTRY_SYNC_EVENT,
  REGISTRY_TO_CMP,
  type ConsentDecisionSource,
} from "@/lib/consent/registryBridge";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type Lang = "pl" | "en";

const CATEGORY_ORDER: readonly ConsentCategory[] = [
  "cookies",
  "legal",
  "communications",
  "product",
  "analytics",
];

function fmt(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ConsentsPanel({
  source = "notifications_center",
}: {
  /** Skąd pochodzi decyzja - trafia do audit-logu (user_consent_events.source). */
  source?: ConsentDecisionSource;
}) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const { user } = useAuth();
  const qc = useQueryClient();
  const consentsQ = useMyConsents();
  const eventsQ = useMyConsentEvents(50);
  const setConsent = useSetMyConsent();
  const cmp = useConsent();

  // Most CMP->rejestr pisze poza React Query - po jego zapisie odśwież
  // stan i historię, żeby wiersze cookie pokazywały świeże daty/wersje.
  useEffect(() => {
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ["user-consents", user?.id ?? "anon"] });
      void qc.invalidateQueries({ queryKey: ["user-consent-events", user?.id ?? "anon"] });
    };
    window.addEventListener(REGISTRY_SYNC_EVENT, refresh);
    return () => window.removeEventListener(REGISTRY_SYNC_EVENT, refresh);
  }, [qc, user?.id]);

  // Sygnał GPC: `active` decyduje o widoczności noty, `honored` o klamrze na
  // wartościach. Override czytamy ze stanu CMP - tam żyje znacznik świadomej
  // zgody udzielonej wbrew sygnałowi.
  const gpc = useGpcSignal();
  const gpcOverridden = isGpcOverrideValid(cmp.state);
  const gpcHonored = gpc.active && !gpcOverridden;

  const views = useMemo(
    () => buildConsentViews(consentsQ.data, gpcHonored),
    [consentsQ.data, gpcHonored],
  );
  const grouped = useMemo(() => {
    const map = new Map<ConsentCategory, ConsentView[]>();
    for (const v of views) {
      const cat = v.definition.category;
      const arr = map.get(cat) ?? [];
      arr.push(v);
      map.set(cat, arr);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      category: c,
      items: map.get(c) ?? [],
    }));
  }, [views]);

  const onToggle = (view: ConsentView, next: boolean) => {
    if (view.definition.required) return;

    // Kategorie cookie: jedyny pisarz to ścieżka CMP - aktualizuje localStorage/
    // cookie/profil i (przez registryBridge) dopisuje wpis audytowy. Pisanie tu
    // wprost do rejestru odtworzyłoby rozjazd w drugą stronę (audyt bez wpływu
    // na realne bramkowanie skryptów).
    const cmpCat = REGISTRY_TO_CMP[view.definition.key];
    if (cmpCat) {
      const cats = cmp.state?.categories ?? {
        necessary: true as const,
        functional: false,
        analytics: false,
        marketing: false,
      };
      cmp.save({ ...cats, [cmpCat]: next }, source);
      toast.success(t("notifications.consents.saved"));
      return;
    }

    setConsent.mutate(
      {
        key: view.definition.key,
        given: next,
        version: view.definition.version,
        lang,
        source,
      },
      {
        onSuccess: () => toast.success(t("notifications.consents.saved")),
        onError: () => toast.error(t("notifications.consents.saveError")),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6 pb-4">
      <header className="rounded-md border border-border/60 bg-muted/30 px-3.5 py-3">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--brand)]/10 text-[var(--brand)]"
            aria-hidden
          >
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("notifications.consents.title")}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("notifications.consents.subtitle")}
            </p>
          </div>
        </div>
      </header>

      <GpcNoticeSlot
        active={gpc.active}
        source={gpc.source}
        overridden={gpcOverridden}
        onRestore={() =>
          cmp.save(
            {
              functional: !!cmp.state?.categories.functional,
              analytics: false,
              marketing: false,
            },
            source,
          )
        }
      />

      {grouped.map(({ category, items }) => (
        <section key={category} aria-labelledby={`consent-cat-${category}`}>
          <h3
            id={`consent-cat-${category}`}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {category === "cookies" && <Cookie className="h-3 w-3" aria-hidden />}
            {t(`notifications.consents.categories.${category}`, { defaultValue: category })}
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {items.map((view) => {
              const { definition, state } = view;
              const inputId = `consent-${definition.key}`;
              // Wiersze cookie: wartość przełącznika bierzemy z CMP (źródło
              // prawdy dla bramkowania), daty z rejestru; gdy rejestr nie ma
              // jeszcze wpisu (decyzja sprzed unifikacji), pokazujemy datę
              // decyzji CMP zamiast mylącego "nie podjęto decyzji".
              const cmpCat = REGISTRY_TO_CMP[definition.key];
              const cmpDecided = !!cmpCat && !!cmp.state;
              // Klamra GPC nakładana TAKŻE na wiersze cookie: ich wartość
              // pochodzi z CMP (surowy stan), a bez klamry przełącznik
              // pokazywałby „tak" dla kategorii, którą sygnał realnie wyłączył.
              const gpcClamped = gpcHonored && isGpcClampedRegistryKey(definition.key);
              const declaredGiven =
                cmpCat != null && cmp.state ? !!cmp.state.categories[cmpCat] : view.effectiveGiven;
              const effectiveGiven = gpcClamped ? false : declaredGiven;
              const cmpTsIso =
                cmpDecided && cmp.state ? new Date(cmp.state.ts).toISOString() : null;
              const dateIso = effectiveGiven
                ? (state?.given_at ?? state?.updated_at ?? cmpTsIso)
                : (state?.withdrawn_at ?? state?.updated_at ?? cmpTsIso);
              const hasDecision = !!state || cmpDecided;
              const showOutdated = !!state && !view.isCurrent && !definition.required;
              return (
                <li
                  key={definition.key}
                  className={cn(
                    "rounded-md border border-border/60 bg-card px-3.5 py-3 shadow-sm transition-colors",
                    showOutdated && "border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Label htmlFor={inputId} className="text-sm font-semibold">
                          {t(`notifications.consents.items.${definition.key}.title`, {
                            defaultValue: definition.key,
                          })}
                        </Label>
                        {definition.required && (
                          <span className="inline-flex h-4 items-center rounded-md bg-[var(--brand)]/10 px-1.5 text-[10px] font-medium text-[var(--brand)]">
                            {t("notifications.consents.requiredBadge")}
                          </span>
                        )}
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {t("notifications.consents.version", {
                            version: definition.version,
                          })}
                        </span>
                        <GpcCategoryBadgeSlot clamped={gpcClamped} />
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t(`notifications.consents.items.${definition.key}.description`, {
                          defaultValue: "",
                        })}
                      </p>
                      <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground/80">
                        {!hasDecision
                          ? t("notifications.consents.notDecided")
                          : effectiveGiven
                            ? t("notifications.consents.given", {
                                date: fmt(dateIso, lang),
                              })
                            : t("notifications.consents.withdrawn", {
                                date: fmt(dateIso, lang),
                              })}
                      </p>
                      {showOutdated && (
                        <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          {t("notifications.consents.versionOutdated")}
                        </p>
                      )}
                    </div>
                    <Switch
                      id={inputId}
                      checked={effectiveGiven}
                      disabled={definition.required || (!cmpCat && setConsent.isPending)}
                      onCheckedChange={(v) => onToggle(view, v)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section aria-labelledby="consent-history">
        <h3
          id="consent-history"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t("notifications.consents.history")}
        </h3>
        {/* Objaśnienie kolumny GPC pokazujemy TYLKO wtedy, gdy historia realnie
            ją zawiera - inaczej byłby to wykład o skrócie, którego nigdzie nie
            widać. */}
        <GpcRegistryNoteSlot visible={(eventsQ.data ?? []).some((ev) => ev.gpc)} />
        {eventsQ.isLoading ? (
          <p className="mt-2 text-xs text-muted-foreground">…</p>
        ) : !eventsQ.data || eventsQ.data.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("notifications.consents.historyEmpty")}
          </p>
        ) : (
          <ol className="mt-2 flex flex-col gap-1 text-[11px] tabular-nums text-muted-foreground">
            {eventsQ.data.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                    ev.given ? "bg-emerald-500" : "bg-rose-500",
                  )}
                  aria-hidden
                />
                <span>
                  {fmt(ev.created_at, lang)} -{" "}
                  <span className="font-medium text-foreground">
                    {t(`notifications.consents.items.${ev.consent_key}.title`, {
                      defaultValue: ev.consent_key,
                    })}
                  </span>{" "}
                  -{" "}
                  {ev.given
                    ? t("notifications.consents.stateGiven")
                    : t("notifications.consents.stateWithdrawn")}{" "}
                  <span className="text-muted-foreground/70">(v{ev.version})</span>
                </span>
                {/* Znacznik sygnału z CHWILI zapisu - to jedyne miejsce, w którym
                    użytkownik widzi, że decyzja padła wbrew (albo zgodnie z)
                    sygnałem opt-outu jego przeglądarki. Wpis o źródle
                    `gpc_signal` ma ten sam znacznik, więc dublowanie opisu
                    źródła byłoby szumem. */}
                <GpcEventBadgeSlot gpc={ev.gpc} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
