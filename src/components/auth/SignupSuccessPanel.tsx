// Animowane okienko sukcesu po rejestracji konta.
// Komunikuje jednoznacznie, że konto wymaga potwierdzenia linkiem z e-maila,
// pokazuje adres docelowy i pozwala ponownie wysłać wiadomość aktywacyjną.
// Kolory pochodzą z tokenów popupu (--nl-fg / --nl-muted) lub motywu strony.
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-signup-popup";
import { Check, Mail } from "@/lib/lucide-shim";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  email: string;
  lang: "pl" | "en";
  /** Adres powrotu po kliknięciu linku aktywacyjnego. */
  redirectTo?: string;
  /** Podgląd w adminie - bez realnych wywołań sieciowych. */
  previewOnly?: boolean;
}

type ResendState = "idle" | "sending" | "sent" | "error";

export function SignupSuccessPanel({ email, lang, redirectTo, previewOnly = false }: Props) {
  // `lang` to język popupu (podgląd w adminie renderuje obie wersje obok
  // siebie), więc tłumacz jest przypięty do niego jawnie - `lng` zamiast
  // aktywnego języka interfejsu.
  const { t } = useTranslation();
  const tr = (key: string) => t(`signupPopup.success.${key}`, { lng: lang });
  const [resend, setResend] = useState<ResendState>("idle");

  const onResend = useCallback(async () => {
    if (previewOnly || !email || resend === "sending") return;
    setResend("sending");
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        ...(redirectTo ? { options: { emailRedirectTo: redirectTo } } : {}),
      });
      setResend(error ? "error" : "sent");
    } catch {
      setResend("error");
    }
  }, [email, previewOnly, redirectTo, resend]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="signup-success space-y-4 border border-emerald-500/30 bg-emerald-500/10 p-6 text-center"
      style={{ borderRadius: 6 }}
    >
      <div className="signup-success__badge relative mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
        <span className="signup-success__pulse absolute inset-0 rounded-full border border-emerald-500/40" />
        <Mail className="signup-success__mail h-7 w-7 text-emerald-500" aria-hidden="true" />
        <span className="signup-success__check absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500">
          <Check className="h-3.5 w-3.5 text-white" aria-hidden="true" />
        </span>
      </div>

      <div className="signup-success__body space-y-2">
        <h3 className="font-display text-lg" style={{ color: "var(--nl-fg, var(--foreground))" }}>
          {tr("title")}
        </h3>
        <p
          className="text-sm leading-relaxed"
          style={{ color: "var(--nl-muted, var(--muted-foreground))" }}
        >
          {tr("body")}
        </p>
        {email ? (
          <p
            className="break-all text-sm font-medium"
            style={{ color: "var(--nl-fg, var(--foreground))" }}
          >
            {email}
          </p>
        ) : null}
        <p
          className="text-[11px] opacity-80"
          style={{ color: "var(--nl-muted, var(--muted-foreground))" }}
        >
          {tr("spamHint")}
        </p>
      </div>

      <div className="signup-success__actions space-y-1.5">
        <button
          type="button"
          onClick={() => void onResend()}
          disabled={previewOnly || resend === "sending" || resend === "sent"}
          className="text-xs underline underline-offset-4 transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ color: "var(--nl-fg, var(--foreground))" }}
        >
          {resend === "sending"
            ? tr("resendSending")
            : resend === "sent"
              ? tr("resendSent")
              : tr("resend")}
        </button>
        {resend === "error" ? (
          <p className="text-[11px] text-destructive">{tr("resendError")}</p>
        ) : null}
      </div>
    </div>
  );
}
