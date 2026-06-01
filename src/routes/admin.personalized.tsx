import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { DEFAULT_PERSONALIZED_SETTINGS, type PersonalizedSettings, type PersonalizedSectionConfig } from "@/hooks/usePersonalizedSettings";

export const Route = createFileRoute("/admin/personalized")({ component: PersonalizedAdmin });

function PersonalizedAdmin() {
  const [s, setS] = useState<PersonalizedSettings>(DEFAULT_PERSONALIZED_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase.from("site_settings").select("value").eq("key", "personalized_system").maybeSingle().then(({ data }) => {
      if (data?.value) setS({ ...DEFAULT_PERSONALIZED_SETTINGS, ...(data.value as Partial<PersonalizedSettings>) });
      setLoaded(true);
    });
  }, []);

  const save = async () => {
    setBusy(true);
    const { error } = await supabase
      .from("site_settings")
      .upsert({ key: "personalized_system", value: s as unknown as Record<string, unknown> }, { onConflict: "key" });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Zapisano");
  };

  const updateSection = (k: "saved" | "followed" | "recommended", patch: Partial<PersonalizedSectionConfig>) =>
    setS({ ...s, sections: { ...s.sections, [k]: { ...s.sections[k], ...patch } } });

  if (!loaded) return <AdminShell><p>Ładowanie…</p></AdminShell>;

  return (
    <AdminShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl">Personalized System</h1>
          <p className="text-sm text-muted-foreground">Bookmarks, follows, reading list i rekomendacje</p>
        </div>
        <Button onClick={save} disabled={busy}>{busy ? "…" : "Zapisz"}</Button>
      </div>

      <Tabs defaultValue="global">
        <TabsList>
          <TabsTrigger value="global">Global</TabsTrigger>
          <TabsTrigger value="saved">Saved</TabsTrigger>
          <TabsTrigger value="followed">Followed</TabsTrigger>
          <TabsTrigger value="recommended">Recommended</TabsTrigger>
        </TabsList>

        <TabsContent value="global" className="space-y-6 mt-6">
          <Row label="System włączony" hint="Główny włącznik bookmarks/follows/recommendations">
            <Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} />
          </Row>
          <Row label="Pozwól gościom" hint="Niezalogowani mogą zapisywać (cookie). Inaczej: popup logowania">
            <Switch checked={s.allowGuests} onCheckedChange={(v) => setS({ ...s, allowGuests: v })} />
          </Row>
          <Row label="Popup po dodaniu do listy" hint="Toast z linkiem do listy po kliknięciu Zapisz">
            <Switch checked={s.popupNotification} onCheckedChange={(v) => setS({ ...s, popupNotification: v })} />
          </Row>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Expiration guest (dni)</Label>
              <Input type="number" value={s.guestExpirationDays} onChange={(e) => setS({ ...s, guestExpirationDays: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Expiration logged user (dni)</Label>
              <Input type="number" value={s.userExpirationDays} onChange={(e) => setS({ ...s, userExpirationDays: Number(e.target.value) })} />
            </div>
          </div>
          <div className="border-t border-border pt-6 space-y-4">
            <h3 className="font-medium">Restricted (dla gości próbujących zapisać)</h3>
            <div>
              <Label>Tytuł</Label>
              <Input value={s.restrictedTitle} onChange={(e) => setS({ ...s, restrictedTitle: e.target.value })} />
            </div>
            <div>
              <Label>Opis</Label>
              <Textarea value={s.restrictedDescription} onChange={(e) => setS({ ...s, restrictedDescription: e.target.value })} />
            </div>
          </div>
          <div className="border-t border-border pt-6 space-y-4">
            <h3 className="font-medium">Follow buttons w nagłówkach archives</h3>
            <Row label="W headerze kategorii"><Switch checked={s.followInCategoryHeader} onCheckedChange={(v) => setS({ ...s, followInCategoryHeader: v })} /></Row>
            <Row label="W headerze tagu"><Switch checked={s.followInTagHeader} onCheckedChange={(v) => setS({ ...s, followInTagHeader: v })} /></Row>
            <Row label="W headerze autora"><Switch checked={s.followInAuthorHeader} onCheckedChange={(v) => setS({ ...s, followInAuthorHeader: v })} /></Row>
          </div>
          <div className="border-t border-border pt-6">
            <Label>URL strony Reading List</Label>
            <Input value={s.readingListPath} onChange={(e) => setS({ ...s, readingListPath: e.target.value })} />
          </div>
        </TabsContent>

        {(["saved", "followed", "recommended"] as const).map((key) => (
          <TabsContent key={key} value={key} className="space-y-4 mt-6">
            <Row label="Sekcja włączona"><Switch checked={s.sections[key].enabled} onCheckedChange={(v) => updateSection(key, { enabled: v })} /></Row>
            <div>
              <Label>Nagłówek sekcji</Label>
              <Input value={s.sections[key].heading} onChange={(e) => updateSection(key, { heading: e.target.value })} />
            </div>
            <div>
              <Label>Opis sekcji</Label>
              <Textarea value={s.sections[key].description} onChange={(e) => updateSection(key, { description: e.target.value })} />
            </div>
            <div>
              <Label>Kolumny na desktopie (2-4)</Label>
              <Input type="number" min={2} max={4} value={s.sections[key].columns} onChange={(e) => updateSection(key, { columns: Number(e.target.value) })} />
            </div>
            {key === "recommended" && (
              <div>
                <Label>Liczba propozycji</Label>
                <Input type="number" min={3} max={30} value={s.sections.recommended.postsPerPage ?? 9} onChange={(e) => updateSection("recommended", { postsPerPage: Number(e.target.value) })} />
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </AdminShell>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
