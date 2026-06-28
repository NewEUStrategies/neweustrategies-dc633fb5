import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FieldLabel } from "@/components/profile/FieldLabel";
import { toast } from "sonner";

export const Route = createFileRoute("/profile/security")({
  component: SecurityPage,
});

function SecurityPage() {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const update = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) {
      toast.error(t("profile.security.tooShort"));
      return;
    }
    if (pw !== pw2) {
      toast.error(t("profile.security.mismatch"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPw(""); setPw2("");
    toast.success(t("profile.security.updated"));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.security.changePassword")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 max-w-sm" onSubmit={update}>
            <div className="grid gap-2">
              <Label htmlFor="pw">{t("profile.security.newPassword")}</Label>
              <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required autoComplete="new-password" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pw2">{t("profile.security.confirmPassword")}</Label>
              <Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={8} required autoComplete="new-password" />
            </div>
            <Button type="submit" disabled={busy}>{t("profile.security.update")}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Button variant="outline" onClick={() => void signOut()}>
            {t("profile.security.signOut")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
