// Admin "Contact Center": list, filter, manage incoming contact-form messages
// and edit per-tenant contact-form settings (recipient, auto-reply, etc.).
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Mail, Mic, Trash2, Send } from "@/lib/lucide-shim";
import { Archive, Inbox, RefreshCw, Check } from "lucide-react";
void Mic;
import { toast } from "sonner";

export const Route = createFileRoute("/admin/contact")({
  head: () => ({
    meta: [{ title: "Centrum kontaktu | Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminContactPage,
});

type ContactMessage = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  subject: string | null;
  message: string;
  lang: string;
  status: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
  newsletter_opt_in: boolean | null;
  recipient: string | null;
  source: string | null;
  confirmation_sent_at: string | null;
};

type Settings = {
  tenant_id: string;
  default_recipient: string | null;
  auto_reply_enabled: boolean;
  auto_reply_subject_pl: string;
  auto_reply_subject_en: string;
  auto_reply_body_pl: string;
  auto_reply_body_en: string;
  notify_admin_enabled: boolean;
  notify_admin_subject_pl: string;
  notify_admin_subject_en: string;
  from_address: string | null;
  from_name: string | null;
  newsletter_double_optin: boolean;
};

function AdminContactPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = lang === "pl" ? PL : EN;
  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      <header className="flex items-center gap-2">
        <Mail className="w-5 h-5 text-brand" />
        <h1 className="text-xl font-semibold">{L.title}</h1>
      </header>
      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox">
            <Inbox className="w-3.5 h-3.5 mr-1.5" />
            {L.tab.inbox}
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Send className="w-3.5 h-3.5 mr-1.5" />
            {L.tab.settings}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="inbox">
          <Inboxes L={L} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab L={L} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Inboxes({ L }: { L: typeof PL }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "unread" | "archived">("unread");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const {
    data: rows = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["admin-contact-messages", filter],
    queryFn: async () => {
      let qb = supabase
        .from("contact_messages")
        .select(
          "id,name,email,phone,company,subject,message,lang,status,created_at,read_at,archived_at,newsletter_opt_in,recipient,source,confirmation_sent_at",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (filter === "unread") qb = qb.is("read_at", null).is("archived_at", null);
      else if (filter === "archived") qb = qb.not("archived_at", "is", null);
      const { data, error } = await qb;
      if (error) throw error;
      return (data ?? []) as ContactMessage[];
    },
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.name, r.email, r.subject ?? "", r.message, r.company ?? ""].some((v) =>
        v.toLowerCase().includes(needle),
      ),
    );
  }, [rows, q]);

  const current = filtered.find((r) => r.id === selected) ?? null;

  const mark = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase
        .from("contact_messages")
        .update(patch as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-contact-messages"] });
    },
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contact_messages").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["admin-contact-messages"] });
      toast.success(L.deleted);
    },
  });

  useEffect(() => {
    if (current && !current.read_at) {
      mark.mutate({ id: current.id, patch: { read_at: new Date().toISOString(), status: "read" } });
    }
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid md:grid-cols-[320px_1fr] gap-3 mt-4">
      <aside className="rounded-md border border-border bg-card overflow-hidden flex flex-col">
        <div className="p-2 border-b border-border flex items-center gap-1">
          {(["unread", "all", "archived"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 text-[11px] rounded ${filter === f ? "bg-brand text-brand-foreground" : "hover:bg-muted"}`}
            >
              {L.filter[f]}
            </button>
          ))}
          <button
            className="ml-auto p-1 text-muted-foreground hover:text-foreground"
            onClick={() => refetch()}
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-2 border-b border-border">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={L.search}
            className="h-8 text-xs"
          />
        </div>
        <ul className="flex-1 overflow-y-auto divide-y divide-border max-h-[70vh]">
          {isLoading && <li className="p-3 text-xs text-muted-foreground">…</li>}
          {!isLoading && filtered.length === 0 && (
            <li className="p-3 text-xs text-muted-foreground italic">{L.empty}</li>
          )}
          {filtered.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => setSelected(m.id)}
                className={`w-full text-left px-3 py-2 hover:bg-muted/60 ${selected === m.id ? "bg-muted" : ""}`}
              >
                <div className="flex items-center gap-2">
                  {!m.read_at && <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" />}
                  <span className="text-xs font-medium truncate flex-1">{m.subject || m.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(m.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {m.name} · {m.email}
                </p>
                <p className="text-[11px] text-muted-foreground/80 line-clamp-1 mt-0.5">
                  {m.message}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="rounded-md border border-border bg-card p-4 min-h-[60vh]">
        {!current && <p className="text-sm text-muted-foreground">{L.pickOne}</p>}
        {current && (
          <div className="space-y-3">
            <header className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-base font-semibold">{current.subject || L.noSubject}</h2>
                <p className="text-xs text-muted-foreground">
                  {current.name} &lt;{current.email}&gt;
                  {current.company ? ` · ${current.company}` : ""}
                  {current.phone ? ` · ${current.phone}` : ""}
                  {" · "}
                  {new Date(current.created_at).toLocaleString()}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  <Badge variant="outline" className="text-[10px]">
                    {current.lang.toUpperCase()}
                  </Badge>
                  {current.newsletter_opt_in && <Badge className="text-[10px]">Newsletter</Badge>}
                  {current.confirmation_sent_at && (
                    <Badge variant="secondary" className="text-[10px]">
                      {L.confirmed}
                    </Badge>
                  )}
                  {current.source && (
                    <Badge variant="outline" className="text-[10px]">
                      {current.source}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" asChild>
                  <a
                    href={`mailto:${current.email}?subject=Re: ${encodeURIComponent(current.subject ?? "")}`}
                  >
                    <Mail className="w-3.5 h-3.5 mr-1.5" />
                    {L.reply}
                  </a>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    mark.mutate({
                      id: current.id,
                      patch: { archived_at: current.archived_at ? null : new Date().toISOString() },
                    })
                  }
                >
                  <Archive className="w-3.5 h-3.5 mr-1.5" />
                  {current.archived_at ? L.unarchive : L.archive}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => mark.mutate({ id: current.id, patch: { status: "done" } })}
                >
                  <Check className="w-3.5 h-3.5 mr-1.5" />
                  {L.done}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    if (confirm(L.confirmDelete)) del.mutate(current.id);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </header>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <p className="whitespace-pre-wrap">{current.message}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function SettingsTab({ L }: { L: typeof PL }) {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ["contact-form-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_form_settings")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as Settings | null;
    },
  });
  const [form, setForm] = useState<Partial<Settings>>({});
  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile?.tenant_id) throw new Error("No tenant");
      const payload = { ...form, tenant_id: profile.tenant_id };
      const { error } = await supabase
        .from("contact_form_settings")
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-form-settings"] });
      toast.success(L.saved);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground mt-4">…</p>;
  const f = form;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  return (
    <div className="mt-4 grid md:grid-cols-2 gap-4 max-w-5xl">
      <Card title={L.section.delivery}>
        <Row label={L.field.recipient}>
          <Input
            value={f.default_recipient ?? ""}
            onChange={(e) => set("default_recipient", e.target.value)}
            placeholder="kontakt@firma.pl"
          />
        </Row>
        <Row label={L.field.fromName}>
          <Input
            value={f.from_name ?? ""}
            onChange={(e) => set("from_name", e.target.value)}
            placeholder="New European Strategies"
          />
        </Row>
        <Row label={L.field.fromAddress}>
          <Input
            value={f.from_address ?? ""}
            onChange={(e) => set("from_address", e.target.value)}
            placeholder="noreply@firma.pl"
          />
        </Row>
        <Row label={L.field.notifyAdmin}>
          <Switch
            checked={!!f.notify_admin_enabled}
            onCheckedChange={(v) => set("notify_admin_enabled", v)}
          />
        </Row>
      </Card>

      <Card title={L.section.autoReply}>
        <Row label={L.field.autoReplyEnabled}>
          <Switch
            checked={!!f.auto_reply_enabled}
            onCheckedChange={(v) => set("auto_reply_enabled", v)}
          />
        </Row>
        <Row label={L.field.subjectPL}>
          <Input
            value={f.auto_reply_subject_pl ?? ""}
            onChange={(e) => set("auto_reply_subject_pl", e.target.value)}
          />
        </Row>
        <Row label={L.field.bodyPL}>
          <Textarea
            rows={4}
            value={f.auto_reply_body_pl ?? ""}
            onChange={(e) => set("auto_reply_body_pl", e.target.value)}
          />
        </Row>
        <Row label={L.field.subjectEN}>
          <Input
            value={f.auto_reply_subject_en ?? ""}
            onChange={(e) => set("auto_reply_subject_en", e.target.value)}
          />
        </Row>
        <Row label={L.field.bodyEN}>
          <Textarea
            rows={4}
            value={f.auto_reply_body_en ?? ""}
            onChange={(e) => set("auto_reply_body_en", e.target.value)}
          />
        </Row>
      </Card>

      <Card title={L.section.newsletter}>
        <Row label={L.field.doubleOptin}>
          <Switch
            checked={!!f.newsletter_double_optin}
            onCheckedChange={(v) => set("newsletter_double_optin", v)}
          />
        </Row>
        <p className="text-[11px] text-muted-foreground">{L.help.newsletter}</p>
      </Card>

      <div className="md:col-span-2 flex items-center gap-3">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "…" : L.save}
        </Button>
        <p className="text-[11px] text-muted-foreground">{L.help.email}</p>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

const PL = {
  title: "Centrum kontaktu",
  tab: { inbox: "Wiadomości", settings: "Ustawienia" },
  filter: { unread: "Nieprzeczytane", all: "Wszystkie", archived: "Archiwum" },
  search: "Szukaj...",
  empty: "Brak wiadomości.",
  pickOne: "Wybierz wiadomość z listy.",
  noSubject: "(brak tematu)",
  reply: "Odpowiedz",
  archive: "Archiwizuj",
  unarchive: "Przywróć",
  done: "Zamknij",
  confirmDelete: "Usunąć tę wiadomość?",
  deleted: "Wiadomość usunięta.",
  confirmed: "Potwierdzenie wysłane",
  save: "Zapisz ustawienia",
  saved: "Zapisano.",
  section: { delivery: "Dostarczanie", autoReply: "Auto-odpowiedź", newsletter: "Newsletter" },
  field: {
    recipient: "Domyślny e-mail odbiorcy",
    fromName: "Nazwa nadawcy",
    fromAddress: "Adres nadawcy (zweryfikowany)",
    notifyAdmin: "Powiadamiaj admina o nowej wiadomości",
    autoReplyEnabled: "Wysyłaj auto-odpowiedź do nadawcy",
    subjectPL: "Temat (PL)",
    subjectEN: "Subject (EN)",
    bodyPL: "Treść (PL)",
    bodyEN: "Body (EN)",
    doubleOptin: "Wymagaj potwierdzenia zapisu (double opt-in)",
  },
  help: {
    email:
      "Wysyłka e-maili wymaga skonfigurowanego konektora Resend (RESEND_API_KEY). Bez niego wiadomości są zapisywane, ale e-maile nie są wysyłane.",
    newsletter:
      "Po wysłaniu wiadomości użytkownik otrzyma osobny e-mail z linkiem potwierdzającym zapis do newslettera.",
  },
};
const EN = {
  title: "Contact Center",
  tab: { inbox: "Messages", settings: "Settings" },
  filter: { unread: "Unread", all: "All", archived: "Archived" },
  search: "Search...",
  empty: "No messages.",
  pickOne: "Pick a message from the list.",
  noSubject: "(no subject)",
  reply: "Reply",
  archive: "Archive",
  unarchive: "Restore",
  done: "Close",
  confirmDelete: "Delete this message?",
  deleted: "Message deleted.",
  confirmed: "Confirmation sent",
  save: "Save settings",
  saved: "Saved.",
  section: { delivery: "Delivery", autoReply: "Auto-reply", newsletter: "Newsletter" },
  field: {
    recipient: "Default recipient email",
    fromName: "Sender name",
    fromAddress: "Sender address (verified)",
    notifyAdmin: "Notify admin of new messages",
    autoReplyEnabled: "Send auto-reply to sender",
    subjectPL: "Subject (PL)",
    subjectEN: "Subject (EN)",
    bodyPL: "Body (PL)",
    bodyEN: "Body (EN)",
    doubleOptin: "Require subscription confirmation (double opt-in)",
  },
  help: {
    email:
      "Email delivery requires the Resend connector (RESEND_API_KEY). Without it, messages are stored but no emails are sent.",
    newsletter:
      "After submitting, the user gets a separate email with a link to confirm their newsletter subscription.",
  },
};
