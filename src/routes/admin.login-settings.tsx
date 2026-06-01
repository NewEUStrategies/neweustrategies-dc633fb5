import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuthSettings, useSaveAuthSettings } from "@/hooks/useAuthSettings";
import { AUTH_DEFAULTS, type AuthSettings } from "@/lib/authSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/login-settings")({
  component: LoginSettingsPage,
});

function LoginSettingsPage() {
  const remote = useAuthSettings();
  const save = useSaveAuthSettings();
  const [s, setS] = useState<AuthSettings>(remote);

  useEffect(() => { setS(remote); }, [remote]);

  const update = <K extends keyof AuthSettings>(k: K, v: AuthSettings[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    try { await save.mutateAsync(s); toast.success("Zapisano"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Błąd"); }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Logowanie i rejestracja</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setS(AUTH_DEFAULTS)}>Resetuj</Button>
          <Button onClick={submit} disabled={save.isPending}>{save.isPending ? "Zapisywanie…" : "Zapisz zmiany"}</Button>
        </div>
      </div>

      <Tabs defaultValue="popup" className="w-full">
        <TabsList>
          <TabsTrigger value="popup">Popup Sign-In</TabsTrigger>
          <TabsTrigger value="page">Strona /login</TabsTrigger>
          <TabsTrigger value="redirects">Przekierowania</TabsTrigger>
          <TabsTrigger value="signup">Rejestracja</TabsTrigger>
        </TabsList>

        <TabsContent value="popup" className="space-y-4 mt-4">
          <Card title="Włącz popup logowania" description="Modal logowania w headerze. Wyłączony = przekierowanie do /login.">
            <Switch checked={s.popup_enabled} onCheckedChange={(v) => update("popup_enabled", v)} />
          </Card>
          <BiField label="Nagłówek" valPl={s.popup_heading_pl} valEn={s.popup_heading_en}
            onPl={(v) => update("popup_heading_pl", v)} onEn={(v) => update("popup_heading_en", v)} />
          <BiField label="Opis" textarea valPl={s.popup_description_pl} valEn={s.popup_description_en}
            onPl={(v) => update("popup_description_pl", v)} onEn={(v) => update("popup_description_en", v)} />
          <div>
            <Label>Logo formularza (URL)</Label>
            <Input value={s.form_logo_url} onChange={(e) => update("form_logo_url", e.target.value)} placeholder="https://…/logo.png" />
            <p className="text-xs text-muted-foreground mt-1">Zalecana wysokość 48–80px.</p>
          </div>
        </TabsContent>

        <TabsContent value="page" className="space-y-4 mt-4">
          <div>
            <Label>Pozycja formularza</Label>
            <select className="w-full mt-1 border rounded p-2 bg-background"
              value={s.login_position}
              onChange={(e) => update("login_position", e.target.value as AuthSettings["login_position"])}>
              <option value="left">Lewa</option>
              <option value="center">Środek</option>
              <option value="right">Prawa</option>
            </select>
          </div>
          <div>
            <Label>Tło strony logowania (URL)</Label>
            <Input value={s.login_bg_url} onChange={(e) => update("login_bg_url", e.target.value)} placeholder="https://…/bg.jpg" />
          </div>
          <div>
            <Label>Kolor tła (hex / oklch / var)</Label>
            <Input value={s.login_bg_color} onChange={(e) => update("login_bg_color", e.target.value)} placeholder="#0a0a0a" />
          </div>
          <Card title="Pokaż link 'Wróć na stronę główną'" description="">
            <Switch checked={s.show_back_to_home} onCheckedChange={(v) => update("show_back_to_home", v)} />
          </Card>
        </TabsContent>

        <TabsContent value="redirects" className="space-y-4 mt-4">
          <div>
            <Label>URL po zalogowaniu (zostaw puste = wraca skąd przyszedł)</Label>
            <Input value={s.logged_in_redirect_url} onChange={(e) => update("logged_in_redirect_url", e.target.value)} placeholder="/me/profile" />
          </div>
          <div>
            <Label>URL po wylogowaniu</Label>
            <Input value={s.logout_redirect_url} onChange={(e) => update("logout_redirect_url", e.target.value)} placeholder="/" />
          </div>
          <div>
            <Label>Niestandardowy URL strony logowania (opcjonalnie)</Label>
            <Input value={s.custom_login_url} onChange={(e) => update("custom_login_url", e.target.value)} placeholder="/membership/login" />
          </div>
        </TabsContent>

        <TabsContent value="signup" className="space-y-4 mt-4">
          <Card title="Pozwól na publiczną rejestrację" description="Czytelnicy mogą zakładać konta (rola: user).">
            <Switch checked={s.allow_public_signup} onCheckedChange={(v) => update("allow_public_signup", v)} />
          </Card>
          <BiField label="Etykieta 'Zaloguj'" valPl={s.signin_label_pl} valEn={s.signin_label_en}
            onPl={(v) => update("signin_label_pl", v)} onEn={(v) => update("signin_label_en", v)} />
          <BiField label="Etykieta 'Zarejestruj'" valPl={s.signup_label_pl} valEn={s.signup_label_en}
            onPl={(v) => update("signup_label_pl", v)} onEn={(v) => update("signup_label_en", v)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Card({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border border-border rounded-lg p-4">
      <div>
        <div className="font-medium">{title}</div>
        {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
      </div>
      {children}
    </div>
  );
}

function BiField({ label, valPl, valEn, onPl, onEn, textarea }: {
  label: string; valPl: string; valEn: string;
  onPl: (v: string) => void; onEn: (v: string) => void; textarea?: boolean;
}) {
  const C = textarea ? Textarea : Input;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label>{label} (PL)</Label>
        <C value={valPl} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onPl(e.target.value)} />
      </div>
      <div>
        <Label>{label} (EN)</Label>
        <C value={valEn} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onEn(e.target.value)} />
      </div>
    </div>
  );
}
