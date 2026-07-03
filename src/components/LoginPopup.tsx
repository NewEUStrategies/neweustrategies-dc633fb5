import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAuthSettings } from "@/hooks/useAuthSettings";
import { onOpenLoginPopup } from "@/lib/loginPopupBus";
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
import { toast } from "sonner";

type Mode = "signin" | "signup";

export function LoginPopup() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { session } = useAuth();
  const settings = useAuthSettings();
  const lang = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<{ title?: string; description?: string }>({});

  useEffect(() => {
    return onOpenLoginPopup((opts) => {
      const m = opts.mode ?? "signin";
      setOverride({ title: opts.title, description: opts.description });
      if (!settings.popup_enabled) {
        navigate({ to: "/login", search: { mode: m } });
        return;
      }
      setMode(m);
      setOpen(true);
    });
  }, [settings.popup_enabled, navigate]);

  useEffect(() => {
    if (session && open) setOpen(false);
  }, [session, open]);

  const heading =
    override.title ?? (lang === "pl" ? settings.popup_heading_pl : settings.popup_heading_en);
  const description =
    override.description ??
    (lang === "pl" ? settings.popup_description_pl : settings.popup_description_en);
  const logo = lang === "pl" ? settings.form_logo_url : settings.form_logo_url;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        if (!settings.allow_public_signup) {
          throw new Error(lang === "pl" ? "Rejestracja jest wyłączona." : "Sign-up is disabled.");
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
            emailRedirectTo: `${window.location.origin}${settings.logged_in_redirect_url || "/"}`,
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
            <div>
              <Label htmlFor="lp-name">{lang === "pl" ? "Imię" : "Name"}</Label>
              <Input id="lp-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div>
            <Label htmlFor="lp-email">Email</Label>
            <Input
              id="lp-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="lp-pwd">{lang === "pl" ? "Hasło" : "Password"}</Label>
            <Input
              id="lp-pwd"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
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
                {lang === "pl" ? "Nie masz konta? Zarejestruj się" : "No account? Sign up"}
              </button>
            ) : (
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() => setMode("signin")}
              >
                {lang === "pl" ? "Masz już konto? Zaloguj się" : "Already have an account? Sign in"}
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
