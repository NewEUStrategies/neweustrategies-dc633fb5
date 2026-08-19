// Podgląd maili autoryzacyjnych (PL/EN) przed wysyłką.
// Renderowanie odbywa się po stronie serwera (React Email -> HTML), a panel
// pokazuje wynik w izolowanej ramce iframe + wersję tekstową.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Copy, Loader2, Mail, Monitor, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FloatingInput } from "@/components/ui/floating-input";
import { toast } from "sonner";
import { uiLang } from "@/lib/i18n/format";
import { ensureI18n as ensureNewsletterAdminI18n } from "@/lib/i18n-newsletter-admin";
import { getAuthEmailPreviews } from "@/lib/auth-email-preview.functions";
import { getTxEmailPreviews } from "@/lib/tx-email-preview.functions";
import {
  activePreview,
  defaultTypeForScope,
  frameMaxWidth,
  previewFirstName,
  previewTypeLabelKey,
  type PreviewDevice as Device,
  type PreviewGender as Gender,
  type PreviewLang as Lang,
  type PreviewScope as Scope,
} from "./authPreviewRules";

export function AuthEmailPreviewPanel() {
  ensureNewsletterAdminI18n();
  const { t, i18n } = useTranslation();

  // Jezyk PODGLADANEGO szablonu - startuje od jezyka panelu, dalej niezalezny.
  const [lang, setLang] = useState<Lang>(uiLang(i18n.language));
  const [firstName, setFirstName] = useState("Marek");
  const [gender, setGender] = useState<Gender>("unknown");
  const [device, setDevice] = useState<Device>("desktop");
  const [activeType, setActiveType] = useState<string>("signup");
  const [scope, setScope] = useState<Scope>("auth");

  const fetchAuthPreviews = useServerFn(getAuthEmailPreviews);
  const fetchTxPreviews = useServerFn(getTxEmailPreviews);
  const { data, isFetching } = useQuery({
    queryKey: ["email-previews", scope, lang, firstName, gender],
    queryFn: async () => {
      const input = {
        data: { lang, firstName: previewFirstName(firstName), gender },
      };
      const rows = scope === "auth" ? await fetchAuthPreviews(input) : await fetchTxPreviews(input);
      return rows as Array<{
        type: string;
        lang: Lang;
        subject: string;
        html: string;
        text: string;
      }>;
    },
    staleTime: 60_000,
  });

  const active = useMemo(() => activePreview(data, activeType), [data, activeType]);

  const copyHtml = async () => {
    if (!active) return;
    await navigator.clipboard.writeText(active.html);
    toast.success(t("adminNewsletter.emailPreview.copied"));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 mr-auto">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Mail className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-base leading-tight">
              {t("adminNewsletter.emailPreview.title")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("adminNewsletter.emailPreview.subtitle")}
            </p>
          </div>
        </div>

        <div className="w-44">
          <FloatingInput
            id="preview-first-name"
            label={t("adminNewsletter.emailPreview.firstName")}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>

        <Segmented
          value={scope}
          onChange={(v) => {
            setScope(v as Scope);
            setActiveType(defaultTypeForScope(v as Scope));
          }}
          options={[
            { value: "auth", label: t("adminNewsletter.emailPreview.scopeAuth") },
            { value: "app", label: t("adminNewsletter.emailPreview.scopeApp") },
          ]}
        />

        <Segmented
          value={gender}
          onChange={(v) => setGender(v as Gender)}
          options={[
            { value: "unknown", label: t("adminNewsletter.emailPreview.genderAuto") },
            { value: "male", label: t("adminNewsletter.emailPreview.genderMale") },
            { value: "female", label: t("adminNewsletter.emailPreview.genderFemale") },
          ]}
        />

        <Segmented
          value={lang}
          onChange={(v) => setLang(v as Lang)}
          options={[
            { value: "pl", label: "PL" },
            { value: "en", label: "EN" },
          ]}
        />

        <Segmented
          value={device}
          onChange={(v) => setDevice(v as Device)}
          options={[
            {
              value: "desktop",
              label: <Monitor className="w-3.5 h-3.5" />,
              ariaLabel: t("adminNewsletter.emailPreview.deviceDesktop"),
            },
            {
              value: "mobile",
              label: <Smartphone className="w-3.5 h-3.5" />,
              ariaLabel: t("adminNewsletter.emailPreview.deviceMobile"),
            },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        <Card className="p-2 h-fit">
          <nav className="flex flex-col gap-1">
            {(data ?? []).map((p) => {
              const labelKey = previewTypeLabelKey(p.type);
              const isActive = active?.type === p.type;
              return (
                <button
                  key={p.type}
                  type="button"
                  onClick={() => setActiveType(p.type)}
                  className={
                    "text-left px-3 py-2 rounded-md text-[0.8125rem] transition-colors " +
                    (isActive
                      ? "bg-primary/10 text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
                  }
                >
                  <span className="block">{labelKey ? t(labelKey) : p.type}</span>
                  <span className="block text-[0.6875rem] text-muted-foreground/80 truncate">
                    {p.subject}
                  </span>
                </button>
              );
            })}
            {!data && (
              <div className="space-y-2 p-1">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="h-10 w-full rounded-md bg-muted animate-pulse" />
                ))}
              </div>
            )}
          </nav>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/40">
            <div className="min-w-0">
              <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                {t("adminNewsletter.emailPreview.subject")}
              </p>
              <p className="text-[0.8125rem] font-medium truncate">{active?.subject ?? "-"}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              <Button variant="outline" size="sm" onClick={copyHtml} disabled={!active}>
                <Copy className="w-3.5 h-3.5 mr-1.5" />
                {t("adminNewsletter.emailPreview.copyHtml")}
              </Button>
            </div>
          </div>

          <div className="bg-muted/30 p-4 flex justify-center">
            {active ? (
              <iframe
                title={`email-preview-${active.type}-${active.lang}`}
                srcDoc={active.html}
                sandbox="allow-same-origin"
                className="bg-white rounded-md border border-border w-full"
                style={{
                  maxWidth: frameMaxWidth(device),
                  height: 880,
                }}
              />
            ) : (
              <div className="w-full h-[600px] rounded-md bg-muted animate-pulse" />
            )}
          </div>

          {active && (
            <details className="border-t border-border">
              <summary className="cursor-pointer px-4 py-3 text-[0.8125rem] text-muted-foreground">
                {t("adminNewsletter.emailPreview.plainText")}
              </summary>
              <pre className="px-4 pb-4 text-[0.75rem] whitespace-pre-wrap text-muted-foreground">
                {active.text}
              </pre>
            </details>
          )}
        </Card>
      </div>
    </div>
  );
}

interface SegmentedProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * `ariaLabel` jest wymagane tylko dla opcji z sama IKONA - taki przycisk nie
   * ma inaczej ZADNEJ nazwy dostepnej dla czytnika ekranu (przelacznik
   * szerokosci ramki: monitor / telefon).
   */
  options: Array<{ value: string; label: React.ReactNode; ariaLabel?: string }>;
}

function Segmented({ value, onChange, options }: SegmentedProps) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border/60">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-label={o.ariaLabel}
          aria-pressed={value === o.value}
          className={
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors " +
            (value === o.value
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

export default AuthEmailPreviewPanel;
