import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { getVerifiedTotpFactorId, verifyTotpCode } from "@/lib/auth/mfa";
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

/**
 * Shared AAL2 step-up used by both /login and the login popup. Renders a modal
 * asking for the 6-digit TOTP code and runs mfa.challenge + mfa.verify. On
 * success it calls onVerified() (the session is now aal2). Cancelling signs the
 * user out, because a lingering password-only (aal1) session is not desirable.
 */
export function MfaChallenge({
  open,
  onVerified,
  onCancel,
}: {
  open: boolean;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCode("");
      return;
    }
    let active = true;
    void getVerifiedTotpFactorId().then((id) => {
      if (active) setFactorId(id);
    });
    return () => {
      active = false;
    };
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId) return toast.error(t("profile.security.mfa.challenge.noFactor"));
    if (!/^\d{6}$/.test(code)) return toast.error(t("profile.security.mfa.invalidCode"));
    setBusy(true);
    try {
      await verifyTotpCode(factorId, code);
      setCode("");
      onVerified();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("profile.security.mfa.challenge.failed"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    // A password-only (aal1) session must not linger when the user backs out of
    // the step-up - sign out so the next attempt restarts cleanly.
    await supabase.auth.signOut().catch(() => {});
    setCode("");
    onCancel();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) void cancel();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("profile.security.mfa.challenge.title")}</DialogTitle>
          <DialogDescription>{t("profile.security.mfa.challenge.description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mfa-challenge-code" className="text-sm">
              {t("profile.security.mfa.challenge.codeLabel")}
            </Label>
            <Input
              id="mfa-challenge-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder={t("profile.security.mfa.codePlaceholder")}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={busy}>
              {t("profile.security.mfa.challenge.verify")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => void cancel()} disabled={busy}>
              {t("profile.security.mfa.challenge.cancel")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
