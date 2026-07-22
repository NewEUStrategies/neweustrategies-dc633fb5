// Admin CRM: Marketing Funnel (subskrybenci newslettera).
//
// Ta strona jest lejkiem marketingowym - odpowiednikiem widoku Kontaktów, ale
// źródłem danych są subskrybenci newslettera. Dla każdej pozycji pokazujemy,
// czy dana osoba jest już zarejestrowana w systemie i/lub istnieje jako
// Kontakt CRM. Widok respektuje RLS (security_invoker + staff-only).
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  Filter,
  RefreshCcw,
  UserPlus,
  MailX,
  Mail,
  BadgeCheck,
  UserCheck,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

import {
  listFunnelSubscribers,
  funnelStats,
  bulkUnsubscribeFunnel,
  convertFunnelToContacts,
} from "@/lib/crm-funnel.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BulkActionBar } from "@/components/molecules/BulkActionBar";
import { FaceAwareAvatar } from "@/components/admin/crm/FaceAwareAvatar";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/admin/crm/funnel/")({
  component: FunnelPage,
  head: () => ({
    meta: [
      {
        title: "Lejek marketingowy - CRM | New European Strategies",
      },
      {
        name: "description",
        content:
          "Baza subskrybentów newslettera z oznaczeniem zarejestrowanych użytkowników i Kontaktów CRM.",
      },
    ],
  }),
});

type FunnelRow = {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  language: string;
  source: string | null;
  status: "subscribed" | "pending" | "unsubscribed" | "bounced" | "complained";
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
  user_id: string | null;
  profile_id: string | null;
  avatar_url: string | null;
  is_registered: boolean;
  contact_id: string | null;
  is_contact: boolean;
  contact_stage: string | null;
  contact_score: number | null;
};

type Audience = "all" | "registered" | "unregistered" | "contact" | "non_contact";
type StatusFilter = "all" | FunnelRow["status"];

const T = {
  pl: {
    title: "Lejek marketingowy",
    subtitle:
      "Subskrybenci newslettera z oznaczeniem zarejestrowanych użytkowników i Kontaktów CRM.",
    search: "Szukaj po e-mailu lub imieniu...",

    audience: {
      all: "Wszyscy",
      registered: "Tylko zarejestrowani",
      unregistered: "Tylko niezarejestrowani",
      contact: "Tylko Kontakty",
      non_contact: "Bez Kontaktu",
    } satisfies Record<Audience, string>,
    status: {
      all: "Wszystkie statusy",
      subscribed: "Aktywny",
      pending: "Oczekujący",
      unsubscribed: "Wypisany",
      bounced: "Bounce",
      complained: "Spam",
    } satisfies Record<StatusFilter, string>,
    refresh: "Odśwież",
    stats: {
      total: "Łącznie",
      subscribed: "Aktywni",
      pending: "Oczekujący",
      unsubscribed: "Wypisani",
      registered: "Zarejestrowani",
      contacts: "Kontakty",
    },
    cols: {
      person: "Osoba",
      status: "Status",
      badges: "Powiązania",
      source: "Źródło",
      date: "Zapisany",
      lang: "Język",
    },
    badges: {
      registered: "Zarejestrowany",
      contact: "Kontakt",
      newSubscriber: "Nowy subskrybent",
    },
    empty: "Brak subskrybentów dla wybranych filtrów.",
    bulk: {
      unsubscribe: "Wypisz",
      convert: "Utwórz Kontakty",
      confirmUnsub: "Wypisać zaznaczonych subskrybentów?",
      confirmUnsubDesc:
        "Zmieni status na \"wypisany\" i zablokuje kolejne wysyłki. Możesz cofnąć ręcznie.",
      confirmConvert: "Utworzyć Kontakty CRM?",
      confirmConvertDesc:
        "Zaznaczeni subskrybenci pojawią się w CRM jako Kontakty ze źródłem \"newsletter\". Istniejące Kontakty zostaną zaktualizowane.",
      cancel: "Anuluj",
      confirm: "Potwierdź",
      toastUnsub: "Wypisano subskrybentów",
      toastConvert: "Utworzono Kontakty",
      toastError: "Nie udało się wykonać akcji",
    },
    openContact: "Otwórz Kontakt",
    itemLabel: { pl: "subskrybentów zaznaczonych", en: "subscribers selected" },
  },
  en: {
    title: "Marketing funnel",
    subtitle:
      "Newsletter subscribers, flagged when they are registered users or existing CRM Contacts.",
    tabs: { contacts: "Contacts", funnel: "Marketing funnel" },
    search: "Search by email or name...",
    audience: {
      all: "Everyone",
      registered: "Registered only",
      unregistered: "Unregistered only",
      contact: "Contacts only",
      non_contact: "Non-contacts only",
    } satisfies Record<Audience, string>,
    status: {
      all: "All statuses",
      subscribed: "Active",
      pending: "Pending",
      unsubscribed: "Unsubscribed",
      bounced: "Bounced",
      complained: "Complained",
    } satisfies Record<StatusFilter, string>,
    refresh: "Refresh",
    stats: {
      total: "Total",
      subscribed: "Active",
      pending: "Pending",
      unsubscribed: "Unsubscribed",
      registered: "Registered",
      contacts: "Contacts",
    },
    cols: {
      person: "Person",
      status: "Status",
      badges: "Links",
      source: "Source",
      date: "Signed up",
      lang: "Lang",
    },
    badges: {
      registered: "Registered",
      contact: "Contact",
      newSubscriber: "New subscriber",
    },
    empty: "No subscribers for the selected filters.",
    bulk: {
      unsubscribe: "Unsubscribe",
      convert: "Create Contacts",
      confirmUnsub: "Unsubscribe selected subscribers?",
      confirmUnsubDesc:
        "Sets status to \"unsubscribed\" and blocks further sends. You can revert manually.",
      confirmConvert: "Create CRM Contacts?",
      confirmConvertDesc:
        "Selected subscribers will appear in CRM as Contacts with source \"newsletter\". Existing Contacts are updated in place.",
      cancel: "Cancel",
      confirm: "Confirm",
      toastUnsub: "Subscribers unsubscribed",
      toastConvert: "Contacts created",
      toastError: "Action failed",
    },
    openContact: "Open Contact",
    itemLabel: { pl: "subskrybentów zaznaczonych", en: "subscribers selected" },
  },
} as const;

function initialsOf(name: string, email: string): string {
  const src = name.trim() || email;
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase();
}

type Copy = (typeof T)["pl"] | (typeof T)["en"];

function StatusPill({ status, L }: { status: FunnelRow["status"]; L: Copy }) {
  const tone: Record<FunnelRow["status"], string> = {
    subscribed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
    pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
    unsubscribed: "bg-muted text-muted-foreground border-border/60",
    bounced: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20",
    complained: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20",
  };
  return (
    <span
      className={`inline-flex h-6 items-center rounded-[6px] border px-2 text-[11px] font-medium ${tone[status]}`}
    >
      {L.status[status]}
    </span>
  );
}

function FunnelPage() {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const L = T[lang];
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const listQ = useQuery({
    queryKey: ["crm-funnel", { search, audience, status }],
    queryFn: async () => {
      const r = await listFunnelSubscribers({
        data: {
          search: search || undefined,
          audience,
          status: status === "all" ? undefined : status,
          limit: 300,
        },
      });
      return JSON.parse(r.json) as FunnelRow[];
    },
  });

  const statsQ = useQuery({
    queryKey: ["crm-funnel-stats"],
    queryFn: async () => funnelStats(),
    staleTime: 30_000,
  });

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size >= rows.length) return new Set();
      return new Set(rows.map((r) => r.id));
    });
  };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["crm-funnel"] });
    void qc.invalidateQueries({ queryKey: ["crm-funnel-stats"] });
    void qc.invalidateQueries({ queryKey: ["crm-leads"] });
  };

  const unsubM = useMutation({
    mutationFn: () => bulkUnsubscribeFunnel({ data: { ids: Array.from(selected) } }),
    onSuccess: () => {
      toast.success(L.bulk.toastUnsub);
      setSelected(new Set());
      invalidate();
    },
    onError: (e: Error) => toast.error(`${L.bulk.toastError}: ${e.message}`),
  });

  const convertM = useMutation({
    mutationFn: () => convertFunnelToContacts({ data: { ids: Array.from(selected) } }),
    onSuccess: () => {
      toast.success(L.bulk.toastConvert);
      setSelected(new Set());
      invalidate();
    },
    onError: (e: Error) => toast.error(`${L.bulk.toastError}: ${e.message}`),
  });

  const stats = statsQ.data;

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <Users className="w-5 h-5 text-brand" aria-hidden />
        <div>
          <h1 className="text-xl font-semibold leading-tight">{L.title}</h1>
          <p className="text-[12px] text-muted-foreground">{L.subtitle}</p>
        </div>
      </header>


      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { key: "total", value: stats?.total ?? 0, icon: Users },
          { key: "subscribed", value: stats?.subscribed ?? 0, icon: Mail },
          { key: "pending", value: stats?.pending ?? 0, icon: Mail },
          { key: "unsubscribed", value: stats?.unsubscribed ?? 0, icon: MailX },
          { key: "registered", value: stats?.registered ?? 0, icon: BadgeCheck },
          { key: "contacts", value: stats?.contacts ?? 0, icon: UserCheck },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.key}
              className="rounded-[6px] border border-border/60 bg-card px-3 py-2"
            >
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {L.stats[s.key as keyof typeof L.stats]}
              </div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums">{s.value}</div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-[6px] border border-border/60 bg-card p-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={L.search}
          className="h-9 max-w-xs"
          aria-label={L.search}
        />
        <Select value={audience} onValueChange={(v) => setAudience(v as Audience)}>
          <SelectTrigger className="h-9 w-[200px]">
            <Filter className="mr-1.5 h-3.5 w-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(L.audience) as Audience[]).map((k) => (
              <SelectItem key={k} value={k}>
                {L.audience[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(L.status) as StatusFilter[]).map((k) => (
              <SelectItem key={k} value={k}>
                {L.status[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => void listQ.refetch()}
            disabled={listQ.isFetching}
          >
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {L.refresh}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-[6px] border border-border/60 bg-card">
        <ScrollArea className="max-h-[calc(100vh-320px)]">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2">
                  <Checkbox
                    checked={rows.length > 0 && selected.size === rows.length}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-2 py-2 text-left">{L.cols.person}</th>
                <th className="px-2 py-2 text-left">{L.cols.status}</th>
                <th className="px-2 py-2 text-left">{L.cols.badges}</th>
                <th className="px-2 py-2 text-left">{L.cols.source}</th>
                <th className="px-2 py-2 text-left">{L.cols.lang}</th>
                <th className="px-2 py-2 text-left">{L.cols.date}</th>
                <th className="w-16 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !listQ.isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    {L.empty}
                  </td>
                </tr>
              ) : null}
              {rows.map((r) => {
                const name =
                  r.display_name ||
                  [r.first_name, r.last_name].filter(Boolean).join(" ") ||
                  r.email;
                return (
                  <tr
                    key={r.id}
                    className="border-t border-border/40 transition-colors hover:bg-muted/30"
                  >
                    <td className="px-2 py-2">
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={() => toggle(r.id)}
                        aria-label={`Select ${r.email}`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <FaceAwareAvatar
                          url={r.avatar_url}
                          name={name}
                          initials={initialsOf(name, r.email)}
                          className="h-8 w-8"
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">{name}</div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {r.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <StatusPill status={r.status} L={L} />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.is_registered ? (
                          <Badge
                            variant="outline"
                            className="h-5 gap-1 rounded-[6px] border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                          >
                            <BadgeCheck className="h-3 w-3" aria-hidden />
                            {L.badges.registered}
                          </Badge>
                        ) : null}
                        {r.is_contact ? (
                          <Badge
                            variant="outline"
                            className="h-5 gap-1 rounded-[6px] border-brand/30 bg-brand/10 px-1.5 text-[10px] font-medium text-brand"
                          >
                            <UserCheck className="h-3 w-3" aria-hidden />
                            {L.badges.contact}
                          </Badge>
                        ) : null}
                        {!r.is_registered && !r.is_contact ? (
                          <Badge
                            variant="outline"
                            className="h-5 rounded-[6px] px-1.5 text-[10px] font-normal text-muted-foreground"
                          >
                            {L.badges.newSubscriber}
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-[12px] text-muted-foreground">
                      {r.source ?? "-"}
                    </td>
                    <td className="px-2 py-2 text-[12px] uppercase text-muted-foreground">
                      {r.language}
                    </td>
                    <td className="px-2 py-2 text-[12px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString(
                        lang === "pl" ? "pl-PL" : "en-GB",
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {r.contact_id ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          onClick={() =>
                            void navigate({
                              to: "/admin/crm/$id",
                              params: { id: r.contact_id as string },
                            })
                          }
                        >
                          <ExternalLink className="mr-1 h-3 w-3" aria-hidden />
                          {L.openContact}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
      </div>

      {/* Bulk actions */}
      <BulkActionBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        lang={lang}
        itemLabel={L.itemLabel}
      >
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 gap-1">
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              {L.bulk.convert}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{L.bulk.confirmConvert}</AlertDialogTitle>
              <AlertDialogDescription>{L.bulk.confirmConvertDesc}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{L.bulk.cancel}</AlertDialogCancel>
              <AlertDialogAction onClick={() => convertM.mutate()}>
                {L.bulk.confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-rose-500/40 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300"
            >
              <MailX className="h-3.5 w-3.5" aria-hidden />
              {L.bulk.unsubscribe}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{L.bulk.confirmUnsub}</AlertDialogTitle>
              <AlertDialogDescription>{L.bulk.confirmUnsubDesc}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{L.bulk.cancel}</AlertDialogCancel>
              <AlertDialogAction onClick={() => unsubM.mutate()}>
                {L.bulk.confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </BulkActionBar>
    </div>
  );
}
