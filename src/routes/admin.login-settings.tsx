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
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { Image as ImageIcon, Upload, X, Sun, Moon } from "@/lib/lucide-shim";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/login-settings")({
  component: LoginSettingsPage,
});

function LoginSettingsPage() {
  const remote = useAuthSettings();
  const save = useSaveAuthSettings();
  const [s, setS] = useState<AuthSettings>(remote);

  useEffect(() => {
    setS(remote);
  }, [remote]);

  const update = <K extends keyof AuthSettings>(k: K, v: AuthSettings[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    try {
      await save.mutateAsync(s);
      toast.success("Zapisano");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Błąd");
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Logowanie i rejestracja</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setS(AUTH_DEFAULTS)}>
            Resetuj
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? "Zapisywanie…" : "Zapisz zmiany"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="page" className="w-full">
        <TabsList>
          <TabsTrigger value="page">Strona /login</TabsTrigger>
          <TabsTrigger value="popup">Popup Sign-In</TabsTrigger>
          <TabsTrigger value="signup">Rejestracja</TabsTrigger>
        </TabsList>

        <TabsContent value="popup" className="space-y-4 mt-4">
          <Card
            title="Włącz popup logowania"
            description="Modal logowania w headerze. Wyłączony = przekierowanie do /login."
          >
            <Switch checked={s.popup_enabled} onCheckedChange={(v) => update("popup_enabled", v)} />
          </Card>
          <BiField
            label="Nagłówek"
            valPl={s.popup_heading_pl}
            valEn={s.popup_heading_en}
            onPl={(v) => update("popup_heading_pl", v)}
            onEn={(v) => update("popup_heading_en", v)}
          />
          <BiField
            label="Opis"
            textarea
            valPl={s.popup_description_pl}
            valEn={s.popup_description_en}
            onPl={(v) => update("popup_description_pl", v)}
            onEn={(v) => update("popup_description_en", v)}
          />
          <ImageField
            label="Logo formularza"
            value={s.form_logo_url}
            onChange={(v) => update("form_logo_url", v)}
            hint="PNG / SVG z przezroczystym tłem. Zalecana wysokość 48–80 px, szerokość do 240 px, waga < 100 KB."
            aspect="240 / 80"
          />
        </TabsContent>

        <TabsContent value="page" className="space-y-6 mt-4">
          <BiField
            label="Tytuł hero"
            valPl={s.hero_title_pl}
            valEn={s.hero_title_en}
            onPl={(v) => update("hero_title_pl", v)}
            onEn={(v) => update("hero_title_en", v)}
          />
          <BiField
            label="Podtytuł hero"
            textarea
            valPl={s.hero_subtitle_pl}
            valEn={s.hero_subtitle_en}
            onPl={(v) => update("hero_subtitle_pl", v)}
            onEn={(v) => update("hero_subtitle_en", v)}
          />

          <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
            <header className="space-y-1">
              <h2 className="font-semibold text-base">Ilustracje hero (split-screen)</h2>
              <p className="text-xs text-muted-foreground">
                Obraz po prawej stronie formularza. Wgraj dwie wersje – dla jasnego i ciemnego
                motywu – żeby zachować kontrast i czytelność. <br />
                Zalecane wymiary: <strong>1200 × 1600 px</strong> (portret 3:4), minimum 800 × 1200
                px. Format WebP/JPG, waga do 400 KB. Focal point centralnie lub po prawej.
              </p>
            </header>
            <div className="grid md:grid-cols-2 gap-4">
              <ImageField
                label="Motyw jasny"
                icon="light"
                value={s.hero_image_url_light}
                onChange={(v) => update("hero_image_url_light", v)}
                aspect="3 / 4"
                previewBg="light"
                hint="1200×1600 px · jasne tło, ciemne akcenty."
              />
              <ImageField
                label="Motyw ciemny"
                icon="dark"
                value={s.hero_image_url_dark}
                onChange={(v) => update("hero_image_url_dark", v)}
                aspect="3 / 4"
                previewBg="dark"
                hint="1200×1600 px · ciemne tło, jasne akcenty."
              />
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
            <header className="space-y-1">
              <h2 className="font-semibold text-base">Pełnoekranowe tło</h2>
              <p className="text-xs text-muted-foreground">
                Używane, gdy formularz jest w trybie full-page. Zalecane wymiary:{" "}
                <strong>1920 × 1080 px</strong> (16:9), format WebP, waga do 500 KB. Preferuj
                obrazy z niskim kontrastem centralnym, żeby nie konkurowały z formularzem.
              </p>
            </header>
            <ImageField
              label="Tło strony logowania"
              value={s.login_bg_url}
              onChange={(v) => update("login_bg_url", v)}
              aspect="16 / 9"
              hint="1920×1080 px · WebP, < 500 KB."
            />
            <div>
              <Label>Kolor tła (hex / oklch / var) – fallback bez zdjęcia</Label>
              <Input
                value={s.login_bg_color}
                onChange={(e) => update("login_bg_color", e.target.value)}
                placeholder="#0a0a0a"
              />
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Link do Polityki prywatności</Label>
              <Input
                value={s.privacy_url}
                onChange={(e) => update("privacy_url", e.target.value)}
                placeholder="/polityka-prywatnosci"
              />
            </div>
            <div>
              <Label>Link do Regulaminu</Label>
              <Input
                value={s.terms_url}
                onChange={(e) => update("terms_url", e.target.value)}
                placeholder="/regulamin"
              />
            </div>
          </div>
          <Card
            title="Przełącznik języka PL/EN"
            description="Pokazuje przyciski PL/EN w prawym górnym rogu strony /login."
          >
            <Switch
              checked={s.show_language_switcher}
              onCheckedChange={(v) => update("show_language_switcher", v)}
            />
          </Card>
          <div>
            <Label>Pozycja formularza</Label>
            <select
              className="w-full mt-1 border rounded p-2 bg-background"
              value={s.login_position}
              onChange={(e) =>
                update("login_position", e.target.value as AuthSettings["login_position"])
              }
            >
              <option value="left">Lewa</option>
              <option value="center">Środek</option>
              <option value="right">Prawa</option>
            </select>
          </div>
          <Card title="Pokaż link 'Wróć na stronę główną'" description="">
            <Switch
              checked={s.show_back_to_home}
              onCheckedChange={(v) => update("show_back_to_home", v)}
            />
          </Card>
          <div>
            <Label>Niestandardowy URL strony logowania (opcjonalnie)</Label>
            <Input
              value={s.custom_login_url}
              onChange={(e) => update("custom_login_url", e.target.value)}
              placeholder="/membership/login"
            />
          </div>
        </TabsContent>

        <TabsContent value="signup" className="space-y-4 mt-4">
          <Card
            title="Pozwól na publiczną rejestrację"
            description="Czytelnicy mogą zakładać konta (rola: user)."
          >
            <Switch
              checked={s.allow_public_signup}
              onCheckedChange={(v) => update("allow_public_signup", v)}
            />
          </Card>
          <BiField
            label="Etykieta 'Zaloguj'"
            valPl={s.signin_label_pl}
            valEn={s.signin_label_en}
            onPl={(v) => update("signin_label_pl", v)}
            onEn={(v) => update("signin_label_en", v)}
          />
          <BiField
            label="Etykieta 'Zarejestruj'"
            valPl={s.signup_label_pl}
            valEn={s.signup_label_en}
            onPl={(v) => update("signup_label_pl", v)}
            onEn={(v) => update("signup_label_en", v)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ImageField({
  label,
  value,
  onChange,
  hint,
  aspect = "16 / 9",
  previewBg,
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  aspect?: string;
  previewBg?: "light" | "dark";
  icon?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const bgClass =
    previewBg === "dark"
      ? "bg-neutral-900 border-neutral-800"
      : previewBg === "light"
        ? "bg-neutral-50 border-neutral-200"
        : "bg-muted border-border";
  const IconEl = icon === "dark" ? Moon : icon === "light" ? Sun : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          {IconEl ? <IconEl className="w-3.5 h-3.5" aria-hidden /> : null}
          {label}
        </Label>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Wyczyść
          </button>
        )}
      </div>
      <div
        className={`relative w-full rounded-lg border overflow-hidden ${bgClass} flex items-center justify-center`}
        style={{ aspectRatio: aspect }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={label}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground text-xs">
            <ImageIcon className="w-6 h-6 opacity-60" />
            <span>Brak obrazu</span>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…/obraz.jpg"
          className="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Upload className="w-3.5 h-3.5 mr-1.5" /> Wybierz
        </Button>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>}
      <MediaPickerDialog
        open={open}
        onOpenChange={setOpen}
        onPick={(url) => {
          onChange(url);
          setOpen(false);
        }}
        accept="image"
        title={`Wybierz obraz: ${label}`}
      />
    </div>
  );
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
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

function BiField({
  label,
  valPl,
  valEn,
  onPl,
  onEn,
  textarea,
}: {
  label: string;
  valPl: string;
  valEn: string;
  onPl: (v: string) => void;
  onEn: (v: string) => void;
  textarea?: boolean;
}) {
  const C = textarea ? Textarea : Input;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label>{label} (PL)</Label>
        <C
          value={valPl}
          onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onPl(e.target.value)
          }
        />
      </div>
      <div>
        <Label>{label} (EN)</Label>
        <C
          value={valEn}
          onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onEn(e.target.value)
          }
        />
      </div>
    </div>
  );
}
