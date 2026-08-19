// /admin/newsletter/email-content - edytor treści maili wysyłanych podczas
// karencji miejsc zespołowych i po wygaśnięciu dostępu (PL/EN).
//
// Puste pole = domyślna treść z szablonu, więc edycja jest zawsze odwracalna.
// Podgląd na żywo korzysta z tego samego renderera co realna wysyłka.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Loader2, Mail, RotateCcw, Save } from "lucide-react";

import { ensureI18n as ensureNewsletterAdminI18n } from "@/lib/i18n-newsletter-admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FloatingInput } from "@/components/ui/floating-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { uiLang } from "@/lib/i18n/format";
import { getTxEmailPreviews } from "@/lib/tx-email-preview.functions";
import {
  EDITABLE_TX_TYPES,
  TX_OVERRIDE_TOKENS,
  useSaveTxOverrides,
  useTxOverrides,
  type EditableTxType,
  type TxCopyOverride,
  type TxOverrides,
} from "@/lib/email/txOverrides";
import {
  FIELDS,
  TYPE_LABEL_KEYS,
  hasUnsavedChanges,
  resetOverrideLang,
  setOverrideField,
  tokensHint,
} from "./txContentRules";

type Lang = "pl" | "en";

export function TxEmailContentPanel() {
  ensureNewsletterAdminI18n();
  const { t, i18n } = useTranslation();

  const saved = useTxOverrides();
  const save = useSaveTxOverrides();

  const [draft, setDraft] = useState<TxOverrides>(saved);
  const [type, setType] = useState<EditableTxType>("team_seat_grace");
  // Jezyk EDYTOWANEJ tresci startuje od jezyka panelu, ale dalej jest niezalezny -
  // stad `uiLang` (jedno miejsce, w ktorym `i18n.language` staje sie kodem), a nie
  // kolejna kopia warunku.
  const [lang, setLang] = useState<Lang>(uiLang(i18n.language));

  // Kolejny odczyt z bazy (np. po zapisie z innego urządzenia) nadpisuje
  // szkic tylko wtedy, gdy nic nie jest w trakcie zapisu.
  useEffect(() => {
    if (!save.isPending) setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(saved)]);

  const current = draft[type][lang];
  const dirty = useMemo(() => hasUnsavedChanges(draft, saved), [draft, saved]);

  const setField = (key: keyof TxCopyOverride, value: string) =>
    setDraft((prev) => setOverrideField(prev, type, lang, key, value));

  const resetLang = () => setDraft((prev) => resetOverrideLang(prev, type, lang));

  const fetchPreviews = useServerFn(getTxEmailPreviews);
  const { data: previews, isFetching } = useQuery({
    queryKey: ["email-previews", "app", lang, "content-editor"],
    queryFn: async () => {
      const rows = await fetchPreviews({
        data: { lang, firstName: "Marek", gender: "unknown" as const },
      });
      return rows as Array<{ type: string; subject: string; html: string }>;
    },
    staleTime: 30_000,
  });

  const activePreview = previews?.find((p) => p.type === type);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 mr-auto">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Mail className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-base leading-tight">
              {t("adminNewsletter.emailContent.title")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("adminNewsletter.emailContent.subtitle")}
            </p>
          </div>
        </div>

        <Segmented
          value={lang}
          onChange={(v) => setLang(v as Lang)}
          options={[
            { value: "pl", label: "PL" },
            { value: "en", label: "EN" },
          ]}
        />

        <Button variant="outline" size="sm" onClick={resetLang} disabled={save.isPending}>
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
          {t("adminNewsletter.emailContent.resetDefaults")}
        </Button>
        <Button size="sm" onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
          {save.isPending ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5 mr-1.5" />
          )}
          {t("adminNewsletter.emailContent.save")}
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <Card className="p-2 h-fit">
          <nav className="flex flex-col gap-1">
            {EDITABLE_TX_TYPES.map((txType) => (
              <button
                key={txType}
                type="button"
                onClick={() => setType(txType)}
                className={
                  "text-left px-3 py-2 rounded-md text-[0.8125rem] transition-colors " +
                  (txType === type
                    ? "bg-primary/10 text-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
                }
              >
                {t(TYPE_LABEL_KEYS[txType])}
              </button>
            ))}
          </nav>
          <p className="mt-3 px-2 pb-1 text-[0.6875rem] leading-relaxed text-muted-foreground">
            {t("adminNewsletter.emailContent.tokensLabel")} {tokensHint(TX_OVERRIDE_TOKENS)}
          </p>
        </Card>

        <Card className="p-4 space-y-4">
          {FIELDS.map((f) =>
            f.multiline ? (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`tx-${f.key}`} className="text-[0.75rem] text-muted-foreground">
                  {t(f.labelKey)}
                </Label>
                <Textarea
                  id={`tx-${f.key}`}
                  rows={3}
                  value={current[f.key]}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder={t("adminNewsletter.emailContent.fieldPlaceholder")}
                />
              </div>
            ) : (
              <FloatingInput
                key={f.key}
                id={`tx-${f.key}`}
                label={t(f.labelKey)}
                value={current[f.key]}
                onChange={(e) => setField(f.key, e.target.value)}
              />
            ),
          )}
        </Card>

        <Card className="p-0 overflow-hidden h-fit">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/40">
            <div className="min-w-0">
              <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                {t("adminNewsletter.emailContent.savedPreview")}
              </p>
              <p className="text-[0.8125rem] font-medium truncate">
                {activePreview?.subject ?? "-"}
              </p>
            </div>
            {isFetching && (
              <Loader2 className="ml-auto w-4 h-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <iframe
            title="tx-email-preview"
            srcDoc={activePreview?.html ?? ""}
            sandbox="allow-same-origin"
            className="w-full h-[620px] bg-white"
          />
        </Card>
      </div>
    </div>
  );
}

interface SegmentedProps {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: React.ReactNode }>;
}

function Segmented({ value, onChange, options }: SegmentedProps) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border/60">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={
            "px-3 py-1.5 rounded-md text-xs font-medium transition-colors " +
            (o.value === value
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default TxEmailContentPanel;
