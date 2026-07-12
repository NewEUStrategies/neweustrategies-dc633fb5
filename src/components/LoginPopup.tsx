import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAuthSettings } from "@/hooks/useAuthSettings";
import { useTheme } from "@/components/ThemeProvider";
import { onOpenLoginPopup } from "@/lib/loginPopupBus";
import "@/lib/i18n-public";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, User, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

type Mode = "signin" | "signup";

export function LoginPopup() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { session } = useAuth();
  const settings = useAuthSettings();
  const { theme } = useTheme();
  const lang = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<{ title?: string; description?: string }>({});

  useEffect(() => {
    return onOpenLoginPopup((opts) => {
      const m = opts.mode ?? "signin";
      setOverride({ title: opts.title, description: opts.description });
      if (!settings.popup_enabled) {
        // Admin may point the full sign-in flow at a custom page instead of
        // /login: an internal path ("/membership/login") uses the router, a
        // full http(s) URL (external IdP) gets a hard navigation. Anything
        // else (including protocol-relative "//host") falls back to /login.
        const custom = settings.custom_login_url.trim();
        if (custom.startsWith("/") && !custom.startsWith("//")) {
          void navigate({ to: custom });
          return;
        }
        if (/^https?:\/\//.test(custom)) {
          window.location.assign(custom);
          return;
        }
        navigate({ to: "/login", search: { mode: m } });
        return;
      }
      setMode(m);
      setOpen(true);
    });
  }, [settings.popup_enabled, settings.custom_login_url, navigate]);

  useEffect(() => {
    if (session && open) setOpen(false);
  }, [session, open]);

  const heading =
    override.title ?? (lang === "pl" ? settings.popup_heading_pl : settings.popup_heading_en);
  const description =
    override.description ??
    (lang === "pl" ? settings.popup_description_pl : settings.popup_description_en);
  // Dark theme prefers the dedicated dark-mode logo and falls back to the
  // light one, so a site configured before the dark variant existed keeps
  // showing its logo.
  const logo =
    theme === "dark"
      ? settings.form_logo_url_dark || settings.form_logo_url
      : settings.form_logo_url;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        if (!settings.allow_public_signup) {
          throw new Error(t("authForms.signupDisabled"));
        }
        const trimmed = name.trim();
        const parts = trimmed.split(/\s+/).filter(Boolean);
        const firstName = parts[0] ?? "";
        const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
        const displayName = trimmed || email.split("@")[0];
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            // Same internal-path guard as /login: a non-"/" value must never
            // leak into the confirmation redirect.
            emailRedirectTo: `${window.location.origin}${
              settings.logged_in_redirect_url?.startsWith("/")
                ? settings.logged_in_redirect_url
                : "/"
            }`,
            data: {
              display_name: displayName,
              first_name: firstName,
              last_name: lastName,
              full_name: trimmed || displayName,
              signup_type: "reader",
            },
          },
        });
        if (error) throw error;
        toast.success(t("auth.signupOk", { defaultValue: "Sprawdź email aby potwierdzić konto." }));
        setOpen(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success(t("auth.signinOk", { defaultValue: "Zalogowano." }));
        setOpen(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center">
          {logo ? <img src={logo} alt="" className="h-12 mx-auto mb-2 object-contain" /> : null}
          <DialogTitle className="font-display text-2xl">{heading}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3 mt-2">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="lp-name" className="text-sm">
                {t("authForms.nameLabel")}
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="lp-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("authForms.namePlaceholder")}
                  className="auth-icon-input"
                />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="lp-email" className="text-sm">
              Email
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                id="lp-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="auth-icon-input"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lp-pwd" className="text-sm">
              {t("authForms.passwordLabel")}
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                id="lp-pwd"
                type={showPw ? "text" : "password"}
                required
                minLength={mode === "signup" ? 8 : undefined}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("authForms.passwordPlaceholder")}
                className="auth-icon-input auth-icon-input-with-action"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
                aria-label={showPw ? t("authForms.hidePassword") : t("authForms.showPassword")}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy
              ? "…"
              : mode === "signin"
                ? lang === "pl"
                  ? settings.signin_label_pl
                  : settings.signin_label_en
                : lang === "pl"
                  ? settings.signup_label_pl
                  : settings.signup_label_en}
          </Button>
        </form>

        {settings.allow_public_signup && (
          <div className="text-center text-sm pt-2 border-t border-border mt-3">
            {mode === "signin" ? (
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() => setMode("signup")}
              >
                {t("authForms.noAccount")}
              </button>
            ) : (
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() => setMode("signin")}
              >
                {t("authForms.haveAccount")}
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
