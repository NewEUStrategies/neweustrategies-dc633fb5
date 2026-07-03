import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, Trash2 as Trash } from "@/lib/lucide-shim";
import {
  AD_PAGE_TYPE_LABELS,
  AD_POSITION_LABELS,
  AD_SLOT_KIND_LABELS,
  type AdPageType,
  type AdPlacement,
  type AdPosition,
  type AdSlot,
  type AdSlotKind,
  type AdSlotStatus,
} from "@/lib/ads/types";

export const Route = createFileRoute("/admin/ads")({ component: AdsAdmin });

function emptySlot(): Partial<AdSlot> {
  return {
    name: "",
    kind: "html",
    status: "active",
    requires_consent: true,
    html: "",
    script: "",
    image_url: "",
    image_link: "",
    image_alt: "",
    width: null,
    height: null,
    notes: "",
  };
}

function emptyPlacement(): Partial<AdPlacement> {
  return {
    slot_id: "",
    position: "top_of_post",
    page_type: "post",
    page_id: null,
    config: {},
    sort_order: 0,
    active: true,
  };
}

function AdsAdmin() {
  return (
    <AdminShell hideSidebar>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <header>
          <h1 className="font-display text-2xl font-bold">Reklamy</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sloty reklamowe (HTML/skrypt/grafika) i ich rozmieszczenie na stronach.
          </p>
        </header>
        <Tabs defaultValue="slots">
          <TabsList>
            <TabsTrigger value="slots">Sloty</TabsTrigger>
            <TabsTrigger value="placements">Rozmieszczenie</TabsTrigger>
          </TabsList>
          <TabsContent value="slots" className="mt-4">
            <SlotsPanel />
          </TabsContent>
          <TabsContent value="placements" className="mt-4">
            <PlacementsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </AdminShell>
  );
}

function SlotsPanel() {
  const [slots, setSlots] = useState<AdSlot[]>([]);
  const [draft, setDraft] = useState<Partial<AdSlot>>(emptySlot());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("ad_slots")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setSlots((data as AdSlot[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!draft.name?.trim()) {
      toast.error("Nazwa jest wymagana");
      return;
    }
    setBusy(true);
    const payload = { ...draft } as never;
    const { error } = draft.id
      ? await supabase.from("ad_slots").update(payload).eq("id", draft.id)
      : await supabase.from("ad_slots").insert(payload);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Zapisano slot");
      setDraft(emptySlot());
      load();
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Usunąć slot? Wszystkie powiązane pozycje również znikną.")) return;
    const { error } = await supabase.from("ad_slots").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Usunięto");
      load();
    }
  };

  return (
    <div className="space-y-6">
      <section className="border border-border rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left p-3">Nazwa</th>
              <th className="text-left p-3">Typ</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Zgoda</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={s.id} className="border-b border-border hover:bg-muted/40">
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3">{AD_SLOT_KIND_LABELS[s.kind]}</td>
                <td className="p-3">{s.status === "active" ? "Aktywny" : "Wstrzymany"}</td>
                <td className="p-3">{s.requires_consent ? "Wymaga" : "Nie"}</td>
                <td className="p-3 text-right space-x-2">
                  <Button size="sm" variant="outline" onClick={() => setDraft(s)}>
                    Edytuj
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(s.id)}>
                    <Trash className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {slots.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground text-sm">
                  Brak slotów. Dodaj pierwszy poniżej.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="border border-border rounded-lg bg-card p-5">
        <h2 className="font-semibold mb-4">{draft.id ? "Edytuj slot" : "Nowy slot"}</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>Nazwa</Label>
            <Input
              value={draft.name ?? ""}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="np. AdSense 728x90 góra"
            />
          </div>
          <div>
            <Label>Typ</Label>
            <Select
              value={draft.kind ?? "html"}
              onValueChange={(v) => setDraft({ ...draft, kind: v as AdSlotKind })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AD_SLOT_KIND_LABELS).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {draft.kind === "html" && (
            <div className="sm:col-span-2">
              <Label>Kod HTML</Label>
              <Textarea
                rows={4}
                value={draft.html ?? ""}
                onChange={(e) => setDraft({ ...draft, html: e.target.value })}
                placeholder="<div>…</div>"
                className="font-mono text-xs"
              />
            </div>
          )}
          {draft.kind === "script" && (
            <div className="sm:col-span-2">
              <Label>Skrypt (np. AdSense)</Label>
              <Textarea
                rows={5}
                value={draft.script ?? ""}
                onChange={(e) => setDraft({ ...draft, script: e.target.value })}
                placeholder='<script async src="…"></script>'
                className="font-mono text-xs"
              />
            </div>
          )}
          {draft.kind === "image" && (
            <>
              <div className="sm:col-span-2">
                <Label>URL grafiki</Label>
                <Input
                  value={draft.image_url ?? ""}
                  onChange={(e) => setDraft({ ...draft, image_url: e.target.value })}
                  placeholder="https://…"
                />
              </div>
              <div>
                <Label>Link kliknięcia</Label>
                <Input
                  value={draft.image_link ?? ""}
                  onChange={(e) => setDraft({ ...draft, image_link: e.target.value })}
                  placeholder="https://…"
                />
              </div>
              <div>
                <Label>Alt (dla dostępności)</Label>
                <Input
                  value={draft.image_alt ?? ""}
                  onChange={(e) => setDraft({ ...draft, image_alt: e.target.value })}
                />
              </div>
            </>
          )}

          <div>
            <Label>Szerokość (px)</Label>
            <Input
              type="number"
              value={draft.width ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, width: e.target.value ? Number(e.target.value) : null })
              }
            />
          </div>
          <div>
            <Label>Wysokość (px)</Label>
            <Input
              type="number"
              value={draft.height ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, height: e.target.value ? Number(e.target.value) : null })
              }
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={draft.status === "active"}
              onCheckedChange={(v) => setDraft({ ...draft, status: v ? "active" : "paused" })}
            />
            <Label className="m-0">Aktywny</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={!!draft.requires_consent}
              onCheckedChange={(v) => setDraft({ ...draft, requires_consent: v })}
            />
            <Label className="m-0">Wymaga zgody marketingowej (RODO)</Label>
          </div>

          <div className="sm:col-span-2">
            <Label>Notatki wewnętrzne</Label>
            <Textarea
              rows={2}
              value={draft.notes ?? ""}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <Button onClick={save} disabled={busy}>
            <Plus className="w-4 h-4 mr-2" />
            {draft.id ? "Zapisz" : "Dodaj slot"}
          </Button>
          {draft.id && (
            <Button variant="outline" onClick={() => setDraft(emptySlot())}>
              Anuluj
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

function PlacementsPanel() {
  const [slots, setSlots] = useState<AdSlot[]>([]);
  const [placements, setPlacements] = useState<AdPlacement[]>([]);
  const [draft, setDraft] = useState<Partial<AdPlacement>>(emptyPlacement());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from("ad_slots").select("*").order("name"),
      supabase.from("ad_placements").select("*").order("sort_order"),
    ]);
    setSlots((s as AdSlot[]) ?? []);
    setPlacements((p as AdPlacement[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const slotMap = useMemo(() => Object.fromEntries(slots.map((s) => [s.id, s])), [slots]);

  const save = async () => {
    if (!draft.slot_id) {
      toast.error("Wybierz slot");
      return;
    }
    setBusy(true);
    const payload = { ...draft } as never;
    const { error } = draft.id
      ? await supabase.from("ad_placements").update(payload).eq("id", draft.id)
      : await supabase.from("ad_placements").insert(payload);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Zapisano pozycję");
      setDraft(emptyPlacement());
      load();
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Usunąć pozycję?")) return;
    const { error } = await supabase.from("ad_placements").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Usunięto");
      load();
    }
  };

  const cfg = (draft.config ?? {}) as Record<string, unknown>;
  const setCfg = (key: string, val: unknown) =>
    setDraft({ ...draft, config: { ...cfg, [key]: val } });

  return (
    <div className="space-y-6">
      <section className="border border-border rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left p-3">Slot</th>
              <th className="text-left p-3">Pozycja</th>
              <th className="text-left p-3">Strony</th>
              <th className="text-left p-3">Aktywne</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {placements.map((p) => (
              <tr key={p.id} className="border-b border-border hover:bg-muted/40">
                <td className="p-3 font-medium">{slotMap[p.slot_id]?.name ?? "-"}</td>
                <td className="p-3">{AD_POSITION_LABELS[p.position]}</td>
                <td className="p-3">{AD_PAGE_TYPE_LABELS[p.page_type]}</td>
                <td className="p-3">{p.active ? "✓" : "-"}</td>
                <td className="p-3 text-right space-x-2">
                  <Button size="sm" variant="outline" onClick={() => setDraft(p)}>
                    Edytuj
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(p.id)}>
                    <Trash className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {placements.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground text-sm">
                  Brak pozycji.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="border border-border rounded-lg bg-card p-5">
        <h2 className="font-semibold mb-4">{draft.id ? "Edytuj pozycję" : "Nowa pozycja"}</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>Slot</Label>
            <Select
              value={draft.slot_id ?? ""}
              onValueChange={(v) => setDraft({ ...draft, slot_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Wybierz slot…" />
              </SelectTrigger>
              <SelectContent>
                {slots.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Pozycja na stronie</Label>
            <Select
              value={draft.position ?? "top_of_post"}
              onValueChange={(v) => setDraft({ ...draft, position: v as AdPosition })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AD_POSITION_LABELS).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Typ strony</Label>
            <Select
              value={draft.page_type ?? "all"}
              onValueChange={(v) => setDraft({ ...draft, page_type: v as AdPageType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AD_PAGE_TYPE_LABELS).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Sortowanie</Label>
            <Input
              type="number"
              value={draft.sort_order ?? 0}
              onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })}
            />
          </div>

          {draft.position === "mid_post" && (
            <div>
              <Label>Po którym paragrafie</Label>
              <Input
                type="number"
                min={1}
                value={(cfg.paragraph as number) ?? 4}
                onChange={(e) => setCfg("paragraph", Number(e.target.value))}
              />
            </div>
          )}
          {draft.position === "in_feed" && (
            <div>
              <Label>Co N kart</Label>
              <Input
                type="number"
                min={1}
                value={(cfg.every as number) ?? 5}
                onChange={(e) => setCfg("every", Number(e.target.value))}
              />
            </div>
          )}
          {draft.position === "footer_slideup" && (
            <>
              <div>
                <Label>Opóźnienie pojawienia się (ms)</Label>
                <Input
                  type="number"
                  value={(cfg.delay_ms as number) ?? 3000}
                  onChange={(e) => setCfg("delay_ms", Number(e.target.value))}
                />
              </div>
              <div className="flex items-center gap-2 mt-6">
                <Switch
                  checked={(cfg.dismissible as boolean) ?? true}
                  onCheckedChange={(v) => setCfg("dismissible", v)}
                />
                <Label className="m-0">Można zamknąć</Label>
              </div>
            </>
          )}

          <div>
            <Label>Aktywne od</Label>
            <Input
              type="datetime-local"
              value={draft.starts_at?.slice(0, 16) ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  starts_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
            />
          </div>
          <div>
            <Label>Aktywne do</Label>
            <Input
              type="datetime-local"
              value={draft.ends_at?.slice(0, 16) ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  ends_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={!!draft.active}
              onCheckedChange={(v) => setDraft({ ...draft, active: v })}
            />
            <Label className="m-0">Aktywne</Label>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <Button onClick={save} disabled={busy}>
            <Plus className="w-4 h-4 mr-2" />
            {draft.id ? "Zapisz" : "Dodaj pozycję"}
          </Button>
          {draft.id && (
            <Button variant="outline" onClick={() => setDraft(emptyPlacement())}>
              Anuluj
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
