import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { changeMyEmail, deleteMyAccount } from "@/lib/account.functions";
import { exportMyData } from "@/lib/profile/export.functions";
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
import type { Factor } from "@supabase/supabase-js";
import { toQrDataUri } from "@/lib/auth/mfa";

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

  // Two-factor (TOTP): enrolled factors + in-progress enrollment + removal.
  const [factors, setFactors] = useState<Factor[]>([]);
  const [factorsLoading, setFactorsLoading] = useState(true);
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(
    null,
  );
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removePw, setRemovePw] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);

  // Eksport danych (RODO art. 15/20): serwer składa JSON, klient pobiera plik.
  const [exportBusy, setExportBusy] = useState(false);
  const downloadMyData = async () => {
    setExportBusy(true);
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `moje-dane-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("profile.security.exportFailed"));
    } finally {
      setExportBusy(false);
    }
  };

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
      return toast.error(t("profile.security.email.needPassword"));
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
      toast.success(t("profile.security.signedOutOthers"));
    } finally {
      setOthersBusy(false);
    }
  };

  const refreshFactors = async () => {
    setFactorsLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        toast.error(error.message);
        return;
      }
      // Only TOTP is offered here; listFactors().totp is the verified subset.
      setFactors(data?.totp ?? []);
    } finally {
      setFactorsLoading(false);
    }
  };

  useEffect(() => {
    void refreshFactors();
  }, []);

  const startEnroll = async () => {
    setStartBusy(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error || !data) {
        toast.error(t("profile.security.mfa.enrollError"));
        return;
      }
      setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setEnrollCode("");
    } finally {
      setStartBusy(false);
    }
  };

  const cancelEnroll = async () => {
    // Drop the half-created (unverified) factor so it does not linger.
    if (enroll) {
      await supabase.auth.mfa.unenroll({ factorId: enroll.factorId }).catch(() => {});
    }
    setEnroll(null);
    setEnrollCode("");
  };

  const activateEnroll = async () => {
    if (!enroll) return;
    if (!/^\d{6}$/.test(enrollCode)) return toast.error(t("profile.security.mfa.invalidCode"));
    setEnrollBusy(true);
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: enroll.factorId,
      });
      if (challengeError || !challenge) {
        toast.error(t("profile.security.mfa.verifyError"));
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enroll.factorId,
        challengeId: challenge.id,
        code: enrollCode,
      });
      if (verifyError) {
        toast.error(t("profile.security.mfa.verifyError"));
        return;
      }
      setEnroll(null);
      setEnrollCode("");
      toast.success(t("profile.security.mfa.activated"));
      await refreshFactors();
    } finally {
      setEnrollBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!removeId || !removePw || !user?.email) return;
    setRemoveBusy(true);
    try {
      // Re-uwierzytelnienie hasłem (spójnie ze zmianą hasła / usuwaniem konta).
      const { error: reauthErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: removePw,
      });
      if (reauthErr) {
        toast.error(t("profile.security.mfa.wrongPassword"));
        return;
      }
      const { error } = await supabase.auth.mfa.unenroll({ factorId: removeId });
      if (error) {
        toast.error(t("profile.security.mfa.removeError"));
        return;
      }
      setRemoveId(null);
      setRemovePw("");
      toast.success(t("profile.security.mfa.removed"));
      await refreshFactors();
    } finally {
      setRemoveBusy(false);
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
            <CardTitle>{t("profile.security.sessions")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              {t("profile.security.lastSignIn")}:{" "}
              <span className="font-medium text-foreground">
                {user?.last_sign_in_at
                  ? new Date(user.last_sign_in_at).toLocaleString(isPl ? "pl-PL" : "en-GB")
                  : "-"}
              </span>
            </p>
            <Button
              variant="outline"
              className="justify-self-start"
              onClick={() => void signOutOthers()}
              disabled={othersBusy}
              title={t("profile.security.tip.signOutOthers")}
            >
              {t("profile.security.signOutOthers")}
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

        <Card>
          <CardHeader>
            <CardTitle>{t("profile.security.mfa.title")}</CardTitle>
            <CardDescription>{t("profile.security.mfa.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 max-w-md">
            <p className="text-sm">
              <span className="text-muted-foreground">Status: </span>
              <span className="font-medium">
                {factors.length > 0
                  ? t("profile.security.mfa.statusEnabled")
                  : t("profile.security.mfa.statusDisabled")}
              </span>
            </p>

            {factorsLoading ? (
              <p className="text-sm text-muted-foreground">{t("profile.security.mfa.loading")}</p>
            ) : factors.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("profile.security.mfa.none")}</p>
            ) : (
              <div className="grid gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("profile.security.mfa.enrolledTitle")}
                </p>
                <ul className="grid gap-2">
                  {factors.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                    >
                      <span className="grid">
                        <span className="text-sm font-medium">
                          {f.friendly_name || t("profile.security.mfa.defaultFactorName")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t("profile.security.mfa.addedOn", {
                            date: new Date(f.created_at).toLocaleDateString(
                              isPl ? "pl-PL" : "en-GB",
                            ),
                          })}
                        </span>
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRemoveId(f.id);
                          setRemovePw("");
                        }}
                      >
                        {t("profile.security.mfa.remove")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {enroll ? (
              <div className="grid gap-3 rounded-md border border-border p-3">
                <p className="text-sm text-muted-foreground">
                  {t("profile.security.mfa.scanInstruction")}
                </p>
                <img
                  src={toQrDataUri(enroll.qr)}
                  alt=""
                  width={180}
                  height={180}
                  className="self-start rounded bg-white p-2"
                />
                <p className="text-xs text-muted-foreground">
                  {t("profile.security.mfa.manualIntro")}
                </p>
                <code className="select-all break-all rounded bg-muted px-2 py-1 text-xs">
                  {enroll.secret}
                </code>
                <div className="grid gap-2">
                  <FieldLabel htmlFor="mfa-code">{t("profile.security.mfa.codeLabel")}</FieldLabel>
                  <Input
                    id="mfa-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={enrollCode}
                    onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, ""))}
                    placeholder={t("profile.security.mfa.codePlaceholder")}
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => void activateEnroll()} disabled={enrollBusy}>
                    {t("profile.security.mfa.activate")}
                  </Button>
                  <Button variant="ghost" onClick={() => void cancelEnroll()} disabled={enrollBusy}>
                    {t("profile.security.mfa.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                className="justify-self-start"
                onClick={() => void startEnroll()}
                disabled={startBusy}
              >
                {t("profile.security.mfa.enroll")}
              </Button>
            )}
          </CardContent>
        </Card>

        <AlertDialog
          open={removeId !== null}
          onOpenChange={(o) => {
            if (!o) {
              setRemoveId(null);
              setRemovePw("");
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("profile.security.mfa.removeTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("profile.security.mfa.removeBody")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-2 py-2">
              <FieldLabel htmlFor="mfa-remove-pw">
                {t("profile.security.mfa.removePasswordLabel")}
              </FieldLabel>
              <Input
                id="mfa-remove-pw"
                type="password"
                value={removePw}
                onChange={(e) => setRemovePw(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("profile.security.mfa.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void confirmRemove();
                }}
                disabled={removeBusy || !removePw}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("profile.security.mfa.removeConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Card>
          <CardHeader>
            <CardTitle>
              {t("profile.security.export.title", {
                defaultValue: i18n.language === "en" ? "Your data (GDPR)" : "Twoje dane (RODO)",
              })}
            </CardTitle>
            <CardDescription>
              {t("profile.security.export.subtitle", {
                defaultValue:
                  i18n.language === "en"
                    ? "Download a copy of the personal data we store about you (Art. 15 and 20 GDPR): profile, comments, follows, orders and preferences - as a JSON file."
                    : "Pobierz kopię danych osobowych, które o Tobie przechowujemy (art. 15 i 20 RODO): profil, komentarze, obserwacje, zamówienia i preferencje - jako plik JSON.",
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void downloadMyData()} disabled={exportBusy}>
              {exportBusy
                ? t("profile.security.export.busy", {
                    defaultValue: i18n.language === "en" ? "Preparing..." : "Przygotowywanie...",
                  })
                : t("profile.security.export.download", {
                    defaultValue:
                      i18n.language === "en"
                        ? "Download my data (JSON)"
                        : "Pobierz moje dane (JSON)",
                  })}
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
