// Organizm: „Twoje dane" - prawa użytkownika z RODO w jednym miejscu:
// eksport kopii (art. 15 i 20) oraz usunięcie konta (art. 17) wraz z notą
// retencyjną mówiącą, co zostaje i dlaczego.
//
// i18n: ta sekcja czyta klucze `profile.security.*`, które mieszkają WYŁĄCZNIE
// w leniwie rejestrowanym słowniku `i18n-profile.ts` - nie ma ich w rdzeniu
// locale. Trasa /profile/privacy rejestrowała tylko słownik sieci kontaktów,
// więc przy wejściu wprost na tę stronę (odświeżenie, link z zewnątrz) karta
// usuwania konta renderowała SUROWE ścieżki kluczy zamiast tekstu, a karta
// eksportu spadała na `defaultValue` - czyli na kopię podtytułu STARSZĄ niż
// słownik (brakowało w niej klubów dyskusyjnych, które eksport już zawiera).
// Dlatego sekcja rejestruje słownik sama i nie ma już ani jednego
// `defaultValue`: jedno źródło prawdy, brak cichego rozjazdu.
//
// §10 audytu IA prywatności. Obie karty mieszkały dotąd na /profile/security -
// między zmianą hasła a dwuskładnikowym logowaniem. To dwie różne sprawy:
// „bezpieczeństwo konta" odpowiada na pytanie „czy ktoś się do mnie włamie",
// a „twoje dane" na „co o mnie wiecie i jak to zabrać". Użytkownik szukający
// eksportu danych po RODO nie szuka go pod kłódką z hasłem.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { deleteMyAccount } from "@/lib/account.functions";
import { exportMyData } from "@/lib/profile/export.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { ensureI18n as ensureProfileI18n } from "@/lib/i18n-profile";
import { LegalRetentionNotice } from "@/components/molecules/LegalRetentionNotice";

export function DataRightsSection() {
  ensureProfileI18n();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [exportBusy, setExportBusy] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);

  // Eksport danych (RODO art. 15/20): serwer składa JSON, klient pobiera plik.
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

  const confirmDelete = async () => {
    if (!delPw) return;
    setDelBusy(true);
    try {
      const result = await deleteMyAccount({ data: { password: delPw } });
      setDelOpen(false);
      // Ile dowodów zostało - liczbą, nie ogólnikiem (art. 12 RODO). Liczymy
      // ZAMÓWIENIA I UPRAWNIENIA ZAKUPOWE razem: dla użytkownika to jedna
      // kategoria („dowody mojej płatności"), a rozbicie na tabele jest
      // szczegółem implementacyjnym. Zero dowodów => zwykły komunikat, bez
      // zbędnej prawniczej adnotacji dla kogoś, kto nigdy u nas nie płacił.
      toast.success(
        result.retainedEvidence > 0
          ? t("profile.security.danger.deletedWithRetention", { count: result.retainedEvidence })
          : t("profile.security.danger.deleted"),
      );
      // Konto już nie istnieje - czyścimy lokalną sesję i wracamy na stronę główną.
      await supabase.auth.signOut().catch(() => {});
      navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("profile.security.danger.failed"));
    } finally {
      setDelBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4 text-primary" aria-hidden />
            {t("profile.security.export.title")}
          </CardTitle>
          <CardDescription>{t("profile.security.export.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Zakres eksportu jest deklarowany w samym pliku (manifest), więc
              użytkownik nie musi wierzyć podtytułowi na słowo. */}
          <p className="text-xs text-muted-foreground">{t("profile.security.export.scopeNote")}</p>
          <Button
            variant="outline"
            className="self-start"
            onClick={() => void downloadMyData()}
            disabled={exportBusy}
          >
            {exportBusy ? t("profile.security.export.busy") : t("profile.security.export.download")}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <Trash2 className="h-4 w-4" aria-hidden />
            {t("profile.security.danger.title")}
          </CardTitle>
          <CardDescription>{t("profile.security.danger.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* Nota retencyjna PRZED przyciskiem: użytkownik ma wiedzieć, co
              zostaje, zanim otworzy dialog - nie dopiero w nim. */}
          <LegalRetentionNotice />
          <AlertDialog
            open={delOpen}
            onOpenChange={(o) => {
              setDelOpen(o);
              if (!o) setDelPw("");
            }}
          >
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="justify-self-start">
                {t("profile.security.danger.button")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("profile.security.danger.confirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("profile.security.danger.confirmBody")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <LegalRetentionNotice variant="compact" />
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
  );
}
