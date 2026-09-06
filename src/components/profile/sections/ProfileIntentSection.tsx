// Organizm: edytor warstwy INTENCJI profilu ("czego szukam" / "co oferuję").
//
// Dwa poziomy w jednym formularzu, bo odpowiadają na to samo pytanie w dwóch
// rozdzielczościach:
//   * chipy `open_to` - zamknięty katalog, zasila FASETĘ katalogu osób
//     ("pokaż wszystkich otwartych na konsorcja"),
//   * pola swobodne PL/EN - zasilają trigram (`discovery_search`) i wektor
//     semantyczny profilu, czyli zapytania w rodzaju "kto zna się na CBAM
//     i pracował w Brukseli".
//
// Zapis jest JEDNĄ transakcją formularza (nie per pole jak InlineText):
// intencja czytana w połowie - z zaznaczonym "konsorcjum" i pustym opisem -
// jest gorsza niż intencja niezapisana, bo trafia do rankingu jako szum.
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Compass, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IntentChip } from "@/components/atoms/IntentChip";
import { ProfileCompletenessCard } from "@/components/molecules/ProfileCompletenessCard";
import { currentLang } from "@/lib/i18n/localeRuntime";
import { formatDateShort } from "@/lib/i18n/format";
import {
  PROFILE_INTENT_CODES,
  PROFILE_INTENT_MAX,
  PROFILE_INTENT_TEXT_MAX,
  PROFILE_SEEKING_MIN,
  profileIntentLabelKey,
  type ProfileIntentCode,
} from "@/lib/profile/intents";
import { PROFILE_SEMANTIC_MIN_SCORE } from "@/lib/profile/completeness";
import {
  EMPTY_INTENT_DRAFT,
  useIntentToggle,
  useProfileIntent,
  useSaveProfileIntent,
  type ProfileIntentDraft,
} from "@/lib/profile/useProfileIntent";
import "@/lib/i18n-profile-intent";

/** Ile miesięcy bez aktualizacji uznajemy za "intencja się zestarzała". */
const STALE_AFTER_MONTHS = 6;

function monthsSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.floor((Date.now() - then) / (30 * 24 * 60 * 60 * 1000));
}

interface IntentTextFieldProps {
  id: string;
  label: string;
  placeholder: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
}

function IntentTextField({
  id,
  label,
  placeholder,
  hint,
  value,
  onChange,
  rows = 3,
}: IntentTextFieldProps) {
  const { t } = useTranslation();
  const left = PROFILE_INTENT_TEXT_MAX - value.length;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      <Textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={PROFILE_INTENT_TEXT_MAX}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="resize-y text-sm"
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : <span />}
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
          {t("profileIntent.charsLeft", { count: left })}
        </span>
      </div>
    </div>
  );
}

export function ProfileIntentSection({ editable = true }: { editable?: boolean }) {
  const { t } = useTranslation();
  const lang = currentLang();
  const intentQ = useProfileIntent();
  const save = useSaveProfileIntent();
  const baseId = useId();

  const [draft, setDraft] = useState<ProfileIntentDraft>(EMPTY_INTENT_DRAFT);
  const [dirty, setDirty] = useState(false);

  // Serwer jest źródłem prawdy do pierwszej edycji użytkownika; po niej
  // szanujemy niezapisany szkic (odświeżenie cache nie kasuje wpisanego tekstu).
  const server = intentQ.data;
  useEffect(() => {
    if (!server || dirty) return;
    setDraft({
      openTo: [...server.openTo],
      seekingPl: server.seekingPl,
      seekingEn: server.seekingEn,
      offeringPl: server.offeringPl,
      offeringEn: server.offeringEn,
    });
  }, [server, dirty]);

  const toggle = useIntentToggle(draft.openTo, PROFILE_INTENT_MAX);

  const patch = (next: Partial<ProfileIntentDraft>) => {
    setDraft((prev) => ({ ...prev, ...next }));
    setDirty(true);
  };

  const staleMonths = useMemo(() => {
    if (!server?.intentUpdatedAt) return 0;
    const months = monthsSince(server.intentUpdatedAt);
    return months >= STALE_AFTER_MONTHS ? months : 0;
  }, [server?.intentUpdatedAt]);

  if (intentQ.isLoading) {
    return <div className="h-40 animate-pulse rounded-[6px] bg-muted/60" aria-hidden />;
  }
  if (intentQ.isError || !server) return null;

  const onToggle = (code: ProfileIntentCode) => {
    const { next, rejected } = toggle(code);
    if (rejected) {
      toast.error(t("profileIntent.openToLimit", { max: PROFILE_INTENT_MAX }));
      return;
    }
    patch({ openTo: next });
  };

  const onSubmit = () => {
    save.mutate(draft, {
      onSuccess: () => {
        setDirty(false);
        toast.success(t("profileIntent.saved"));
      },
      onError: () => toast.error(t("profileIntent.saveError")),
    });
  };

  const onReset = () => {
    setDraft({
      openTo: [...server.openTo],
      seekingPl: server.seekingPl,
      seekingEn: server.seekingEn,
      offeringPl: server.offeringPl,
      offeringEn: server.offeringEn,
    });
    setDirty(false);
  };

  return (
    <section className="rounded-[6px] border border-border bg-card p-4 sm:p-5">
      <header className="mb-3">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <Compass className="h-3.5 w-3.5 text-primary" aria-hidden />
          <span>{t("profileIntent.title")}</span>
        </h3>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          {t("profileIntent.subtitle")}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-4">
          <fieldset className="space-y-2" disabled={!editable}>
            <legend className="text-xs font-medium">{t("profileIntent.openToLabel")}</legend>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("profileIntent.openToHint", { max: PROFILE_INTENT_MAX })}
            </p>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {PROFILE_INTENT_CODES.map((code) => {
                const selected = draft.openTo.includes(code);
                return (
                  <IntentChip
                    key={code}
                    label={t(`profileIntent.openToShort.${code}`)}
                    ariaLabel={t(profileIntentLabelKey(code))}
                    selected={selected}
                    readOnly={!editable}
                    disabled={!editable || (!selected && draft.openTo.length >= PROFILE_INTENT_MAX)}
                    onToggle={() => onToggle(code)}
                  />
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-3">
            <div
              role="tablist"
              aria-label={t("profileIntent.title")}
              className="inline-flex gap-1 rounded-[6px] border border-border bg-muted/30 p-1"
            >
              {(["pl", "en"] as const).map((code) => {
                const active = textLang === code;
                return (
                  <button
                    key={code}
                    type="button"
                    role="tab"
                    id={`${baseId}-tab-${code}`}
                    aria-selected={active}
                    aria-controls={`${baseId}-panel-${code}`}
                    onClick={() => setTextLang(code)}
                    className={`rounded-[6px] px-3 py-1 text-xs font-medium uppercase tracking-wide transition-colors ${
                      active
                        ? "bg-background text-foreground shadow-none"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {code}
                  </button>
                );
              })}
            </div>

            <div
              role="tabpanel"
              id={`${baseId}-panel-pl`}
              aria-labelledby={`${baseId}-tab-pl`}
              className={`grid gap-4 sm:grid-cols-2 ${textLang === "pl" ? "" : "hidden"}`}
            >
              <IntentTextField
                id={`${baseId}-seeking-pl`}
                label={t("profileIntent.seekingLabelPl")}
                placeholder={t("profileIntent.seekingPlaceholder")}
                hint={t("profileIntent.seekingHint", { min: PROFILE_SEEKING_MIN })}
                value={draft.seekingPl}
                onChange={(next) => patch({ seekingPl: next })}
              />
              <IntentTextField
                id={`${baseId}-offering-pl`}
                label={t("profileIntent.offeringLabelPl")}
                placeholder={t("profileIntent.offeringPlaceholder")}
                value={draft.offeringPl}
                onChange={(next) => patch({ offeringPl: next })}
              />
            </div>

            <div
              role="tabpanel"
              id={`${baseId}-panel-en`}
              aria-labelledby={`${baseId}-tab-en`}
              className={`grid gap-4 sm:grid-cols-2 ${textLang === "en" ? "" : "hidden"}`}
            >
              <IntentTextField
                id={`${baseId}-seeking-en`}
                label={t("profileIntent.seekingLabelEn")}
                placeholder={t("profileIntent.seekingPlaceholder")}
                value={draft.seekingEn}
                onChange={(next) => patch({ seekingEn: next })}
              />
              <IntentTextField
                id={`${baseId}-offering-en`}
                label={t("profileIntent.offeringLabelEn")}
                placeholder={t("profileIntent.offeringPlaceholder")}
                value={draft.offeringEn}
                onChange={(next) => patch({ offeringEn: next })}
              />
            </div>
          </div>


          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={!dirty || save.isPending} onClick={onSubmit}>
              {save.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              )}
              {t("profileIntent.save")}
            </Button>
            {dirty && (
              <Button type="button" size="sm" variant="ghost" onClick={onReset}>
                {t("profileIntent.cancel")}
              </Button>
            )}
            {server.intentUpdatedAt && !dirty && (
              <span className="text-[11px] text-muted-foreground">
                {t("profileIntent.updatedAt", {
                  date: formatDateShort(server.intentUpdatedAt, lang),
                })}
              </span>
            )}
          </div>

          {staleMonths > 0 && (
            <p className="rounded-[4px] border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              {t("profileIntent.stale", { months: staleMonths })}
            </p>
          )}
        </div>

        <aside className="min-w-0 rounded-[6px] border border-border/60 bg-muted/20 p-3">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("profileCompleteness.title")}
          </p>
          <ProfileCompletenessCard status={server.status} />
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            {t("profileIntent.semanticHint", { score: PROFILE_SEMANTIC_MIN_SCORE })}
          </p>
        </aside>
      </div>
    </section>
  );
}
