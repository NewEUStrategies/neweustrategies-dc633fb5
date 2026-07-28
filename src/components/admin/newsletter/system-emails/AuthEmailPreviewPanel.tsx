// Podgląd maili autoryzacyjnych (PL/EN) przed wysyłką.
// Renderowanie odbywa się po stronie serwera (React Email -> HTML), a panel
// pokazuje wynik w izolowanej ramce iframe + wersję tekstową.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Copy, Loader2, Mail, Monitor, Smartphone } from "lucide-react";

import { NewsletterSubNav } from "@/components/admin/newsletter/NewsletterSubNav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FloatingInput } from "@/components/ui/floating-input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { getAuthEmailPreviews } from "@/lib/auth-email-preview.functions";

type Lang = "pl" | "en";
type Gender = "male" | "female" | "unknown";
type Device = "desktop" | "mobile";

const TYPE_LABELS: Record<string, { pl: string; en: string }> = {
  signup: { pl: "Rejestracja - potwierdzenie e-mail", en: "Signup confirmation" },
  magiclink: { pl: "Logowanie bez hasła (magic link)", en: "Magic link sign-in" },
  recovery: { pl: "Reset hasła", en: "Password reset" },
  invite: { pl: "Zaproszenie do platformy", en: "Platform invitation" },
  email_change: { pl: "Zmiana adresu e-mail", en: "Email address change" },
  reauthentication: { pl: "Kod weryfikacyjny", en: "Verification code" },
};

export function AuthEmailPreviewPanel() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");

  const [lang, setLang] = useState<Lang>(isPl ? "pl" : "en");
  const [firstName, setFirstName] = useState("Marek");
  const [gender, setGender] = useState<Gender>("unknown");
  const [device, setDevice] = useState<Device>("desktop");
  const [activeType, setActiveType] = useState<string>("signup");

  const fetchPreviews = useServerFn(getAuthEmailPreviews);
  const { data, isFetching } = useQuery({
    queryKey: ["auth-email-previews", lang, firstName, gender],
    queryFn: () =>
      fetchPreviews({
        data: { lang, firstName: firstName.trim() ? firstName.trim() : null, gender },
      }),
    staleTime: 60_000,
  });

  const active = useMemo(
    () => data?.find((p) => p.type === activeType) ?? data?.[0],
    [data, activeType],
  );

  const copyHtml = async () => {
    if (!active) return;
    await navigator.clipboard.writeText(active.html);
    toast.success(isPl ? "Skopiowano HTML maila" : "Email HTML copied");
  };

  return (
    <div className="space-y-4">
      <NewsletterSubNav />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 mr-auto">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Mail className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-base leading-tight">
              {isPl ? "Podgląd maili autoryzacyjnych" : "Auth email preview"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isPl
                ? "Dokładnie te szablony wychodzą do użytkowników - dane w podglądzie są przykładowe."
                : "These are the exact templates sent to users - preview data is illustrative."}
            </p>
          </div>
        </div>

        <div className="w-44">
          <FloatingInput
            id="preview-first-name"
            label={isPl ? "Imię odbiorcy" : "Recipient first name"}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>

        <Segmented
          value={gender}
          onChange={(v) => setGender(v as Gender)}
          options={[
            { value: "unknown", label: isPl ? "Auto" : "Auto" },
            { value: "male", label: isPl ? "Mężczyzna" : "Male" },
            { value: "female", label: isPl ? "Kobieta" : "Female" },
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
            { value: "desktop", label: <Monitor className="w-3.5 h-3.5" /> },
            { value: "mobile", label: <Smartphone className="w-3.5 h-3.5" /> },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        <Card className="p-2 h-fit">
          <nav className="flex flex-col gap-1">
            {(data ?? []).map((p) => {
              const label = TYPE_LABELS[p.type];
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
                  <span className="block">{label ? (isPl ? label.pl : label.en) : p.type}</span>
                  <span className="block text-[0.6875rem] text-muted-foreground/80 truncate">
                    {p.subject}
                  </span>
                </button>
              );
            })}
            {!data && (
              <div className="space-y-2 p-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}
          </nav>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/40">
            <div className="min-w-0">
              <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                {isPl ? "Temat" : "Subject"}
              </p>
              <p className="text-[0.8125rem] font-medium truncate">{active?.subject ?? "-"}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              <Button variant="outline" size="sm" onClick={copyHtml} disabled={!active}>
                <Copy className="w-3.5 h-3.5 mr-1.5" />
                {isPl ? "Kopiuj HTML" : "Copy HTML"}
              </Button>
            </div>
          </div>

          <div className="bg-muted/30 p-4 flex justify-center">
            {active ? (
              <iframe
                title={`email-preview-${active.type}-${active.lang}`}
                srcDoc={active.html}
                sandbox=""
                className="bg-white rounded-md border border-border w-full"
                style={{
                  maxWidth: device === "mobile" ? 390 : 720,
                  height: 880,
                }}
              />
            ) : (
              <Skeleton className="w-full h-[600px]" />
            )}
          </div>

          {active && (
            <details className="border-t border-border">
              <summary className="cursor-pointer px-4 py-3 text-[0.8125rem] text-muted-foreground">
                {isPl ? "Wersja tekstowa (plain text)" : "Plain text version"}
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
