import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { changeMyEmail, deleteMyAccount } from "@/lib/account.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FieldLabel } from "@/components/profile/FieldLabel";
import { PasswordStrengthMeter } from "@/components/molecules/PasswordStrengthMeter";
import { toast } from "sonner";

export const Route = createFileRoute("/profile/security")({
  component: SecurityPage,
});

function SecurityPage() {
  const { t, i18n } = useTranslation();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const isPl = i18n.language?.startsWith("pl") ?? false;

  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [othersBusy, setOthersBusy] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [emailPw, setEmailPw] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  const [delPw, setDelPw] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);

  const updatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return toast.error(t("profile.security.tooShort"));
    if (pw !== pw2) return toast.error(t("profile.security.mismatch"));
    if (!user?.email) return;
    setBusy(true);
    try {
      // Re-uwierzytelnienie: potwierdź obecne hasło zanim je zmienimy.
      const { error: reauthErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: current,
      });
      if (reauthErr) {
        toast.error(t("profile.security.wrongCurrent"));
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) {
        toast.error(error.message);
        return;
      }
      // Zmiana hasła ubija pozostałe sesje - dotychczasowe tokeny mogły wyciec.
      await supabase.auth.signOut({ scope: "others" });
      setCurrent("");
      setPw("");
      setPw2("");
      toast.success(t("profile.security.updated"));
    } finally {
      setBusy(false);
    }
  };

  const updateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = newEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      return toast.error(t("profile.security.email.invalid"));
    }
    if (!emailPw) {
      return toast.error(
        t("profile.security.email.needPassword", {
          defaultValue: isPl
            ? "Podaj obecne hasło, aby potwierdzić."
            : "Enter your current password to confirm.",
        }),
      );
    }
    setEmailBusy(true);
    try {
      await changeMyEmail({ data: { email: value, password: emailPw } });
      setNewEmail("");
      setEmailPw("");
      toast.success(t("profile.security.email.sent"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("profile.security.email.invalid"));
    } finally {
      setEmailBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!delPw) return;
    setDelBusy(true);
    try {
      await deleteMyAccount({ data: { password: delPw } });
      setDelOpen(false);
      toast.success(t("profile.security.danger.deleted"));
      // Konto już nie istnieje - czyścimy lokalną sesję i wracamy na stronę główną.
      await supabase.auth.signOut().catch(() => {});
      navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("profile.security.danger.failed"));
    } finally {
      setDelBusy(false);
    }
  };

  const signOutOthers = async () => {
    setOthersBusy(true);
    try {
      // Supabase-js nie potrafi listować sesji po stronie klienta - jedyne, co
      // możemy zrobić, to ubić wszystkie pozostałe sesje konta (inne urządzenia).
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(
        t("profile.security.signedOutOthers", {
          defaultValue: isPl ? "Wylogowano pozostałe sesje." : "Signed out other sessions.",
        }),
      );
    } finally {
      setOthersBusy(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("profile.security.changePassword")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 max-w-sm" onSubmit={updatePassword}>
              <div className="grid gap-2">
                <FieldLabel htmlFor="cur" tip={t("profile.security.tip.currentPassword")}>
                  {t("profile.security.currentPassword")}
                </FieldLabel>
                <Input
                  id="cur"
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="pw" tip={t("profile.security.tip.newPassword")}>
                  {t("profile.security.newPassword")}
                </FieldLabel>
                <Input
                  id="pw"
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
                <PasswordStrengthMeter password={pw} lang={isPl ? "pl" : "en"} />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="pw2" tip={t("profile.security.tip.confirmPassword")}>
                  {t("profile.security.confirmPassword")}
                </FieldLabel>
                <Input
                  id="pw2"
                  type="password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" disabled={busy} title={t("profile.security.tip.update")}>
                {t("profile.security.update")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("profile.security.email.title")}</CardTitle>
            <CardDescription>{t("profile.security.email.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 max-w-sm" onSubmit={updateEmail}>
              <div className="grid gap-2">
                <FieldLabel htmlFor="cur-email">{t("profile.security.email.current")}</FieldLabel>
                <Input id="cur-email" value={user?.email ?? ""} disabled readOnly />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="new-email">{t("profile.security.email.newEmail")}</FieldLabel>
                <Input
                  id="new-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="email-pw">{t("profile.security.currentPassword")}</FieldLabel>
                <Input
                  id="email-pw"
                  type="password"
                  value={emailPw}
                  onChange={(e) => setEmailPw(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" variant="outline" disabled={emailBusy}>
                {t("profile.security.email.submit")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {t("profile.security.sessions", { defaultValue: isPl ? "Sesje" : "Sessions" })}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              {t("profile.security.lastSignIn", {
                defaultValue: isPl ? "Ostatnie logowanie" : "Last sign-in",
              })}
              :{" "}
              <span className="font-medium text-foreground">
                {user?.last_sign_in_at
                  ? new Date(user.last_sign_in_at).toLocaleString(isPl ? "pl-PL" : "en-US")
                  : "—"}
              </span>
            </p>
            <Button
              variant="outline"
              className="justify-self-start"
              onClick={() => void signOutOthers()}
              disabled={othersBusy}
              title={t("profile.security.tip.signOutOthers", {
                defaultValue: isPl
                  ? "Wylogowuje wszystkie pozostałe sesje na innych urządzeniach."
                  : "Signs out all your other sessions on other devices.",
              })}
            >
              {t("profile.security.signOutOthers", {
                defaultValue: isPl ? "Wyloguj pozostałe sesje" : "Sign out other sessions",
              })}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <Button
              variant="outline"
              onClick={() => void signOut()}
              title={t("profile.security.tip.signOut")}
            >
              {t("profile.security.signOut")}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">{t("profile.security.danger.title")}</CardTitle>
            <CardDescription>{t("profile.security.danger.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog
              open={delOpen}
              onOpenChange={(o) => {
                setDelOpen(o);
                if (!o) setDelPw("");
              }}
            >
              <AlertDialogTrigger asChild>
                <Button variant="destructive">{t("profile.security.danger.button")}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("profile.security.danger.confirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("profile.security.danger.confirmBody")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="grid gap-2 py-2">
                  <FieldLabel htmlFor="del-pw">
                    {t("profile.security.danger.passwordLabel")}
                  </FieldLabel>
                  <Input
                    id="del-pw"
                    type="password"
                    value={delPw}
                    onChange={(e) => setDelPw(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("profile.security.danger.cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      void confirmDelete();
                    }}
                    disabled={delBusy || !delPw}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {t("profile.security.danger.confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
