// Panel organizacji członkowskich: członkostwo korporacyjne / partner
// strategiczny sprzedawane offline, z wieloma kontami-miejscami. Admin zakłada
// organizację (warstwa + limit miejsc), a następnie zaprasza konta do miejsc.
// Limit i rola miejsc egzekwowane serwerowo (RPC org_add_seat); current_
// membership_tier() rozstrzyga potem realną warstwę zajętego miejsca.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Landmark, Building2, Plus, Trash2, Users, Mail, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useMembershipTiers, tierName, type MembershipTierRow } from "@/lib/billing/tiers";
import {
  fetchOrganizations,
  updateOrganization,
  deleteOrganization,
  fetchAdminOrgSeats,
  addOrgSeat,
  removeOrgSeat,
  type OrganizationRow,
} from "@/lib/admin/membership-admin";

export const Route = createFileRoute("/admin/organizations")({
  component: AdminOrganizationsPage,
});


type Lang = "pl" | "en";
const tr = (lang: Lang) => (pl: string, en: string) => (lang === "pl" ? pl : en);

const ORGS_KEY = ["admin", "member-orgs"] as const;

function AdminOrganizationsPage() {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const L = tr(lang);
  


  const tiersQ = useMembershipTiers();
  const tiers = useMemo<MembershipTierRow[]>(() => tiersQ.data ?? [], [tiersQ.data]);

  // Warstwy organizacyjne: preferuj rangę >= 30 (korporacja / partner); gdy seed
  // ich nie ma, pozwól wybrać spośród wszystkich aktywnych, by formularz działał.
  const tierOptions = useMemo<MembershipTierRow[]>(() => {
    const high = tiers.filter((t) => t.rank >= 30);
    return high.length > 0 ? high : tiers;
  }, [tiers]);

  const tierLabel = (key: string): string => {
    const tier = tiers.find((t) => t.key === key);
    return tier ? `${tierName(tier, lang)}` : key;
  };

  const orgsQ = useQuery({ queryKey: ORGS_KEY, queryFn: fetchOrganizations });
  void tierOptions;

  const orgs = orgsQ.data ?? [];

  return (
    <div className="space-y-4 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Landmark className="h-4 w-4 text-primary" aria-hidden="true" />
            {L("Organizacje członkowskie", "Member organizations")}
          </h1>
          <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
            {L(
              "Członkostwo korporacyjne i partnerstwo strategiczne z wieloma kontami-miejscami. Sprzedaż offline - tu zarządzasz organizacjami, marką i miejscami.",
              "Corporate membership and strategic partnership with multiple seat accounts. Sold offline - here you manage organizations, branding and seats.",
            )}
          </p>
        </div>
        <Button asChild size="sm" className="h-8">
          <Link to="/admin/organizations/new">
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {L("Nowa organizacja", "New organization")}
          </Link>
        </Button>
      </header>


      {orgsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">{L("Wczytywanie...", "Loading...")}</p>
      ) : orgs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {L("Brak organizacji. Utwórz pierwszą.", "No organizations yet. Create the first one.")}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orgs.map((org) => (
            <OrgCard key={org.id} lang={lang} org={org} tierLabel={tierLabel(org.tier_key)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Karta organizacji: dane, przełącznik statusu, usuwanie oraz zarządzanie
// miejscami (osadzony SeatManager).
// ---------------------------------------------------------------------------
function OrgCard({
  lang,
  org,
  tierLabel,
}: {
  lang: Lang;
  org: OrganizationRow;
  tierLabel: string;
}) {
  const L = tr(lang);
  const qc = useQueryClient();

  const setStatus = useMutation({
    mutationFn: (active: boolean) =>
      updateOrganization(org.id, { status: active ? "active" : "suspended" }),
    onSuccess: () => {
      toast.success(L("Zaktualizowano status", "Status updated"));
      void qc.invalidateQueries({ queryKey: ORGS_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeOrg = useMutation({
    mutationFn: () => deleteOrganization(org.id),
    onSuccess: () => {
      toast.success(L("Usunięto organizację", "Organization deleted"));
      void qc.invalidateQueries({ queryKey: ORGS_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isActive = org.status === "active";

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-start justify-between gap-2 text-base">
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">{org.name}</span>
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={L("Usuń organizację", "Delete organization")}
            disabled={removeOrg.isPending}
            onClick={() => {
              if (
                confirm(
                  L(
                    `Usunąć organizację "${org.name}"? Miejsca zostaną skasowane. Operacji nie można cofnąć.`,
                    `Delete organization "${org.name}"? Its seats will be removed. This cannot be undone.`,
                  ),
                )
              ) {
                removeOrg.mutate();
              }
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </CardTitle>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">{tierLabel}</Badge>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {L("limit miejsc", "seat limit")}: {org.seats_limit}
          </span>
          <Button asChild size="sm" variant="outline" className="ml-auto h-6 text-[10px]">
            <Link to="/admin/organizations/$id" params={{ id: org.id }}>
              <Settings2 className="mr-1 h-3 w-3" aria-hidden="true" />
              {L("Zarządzaj", "Manage")}
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2">
          <div className="flex items-center gap-2">
            <Switch
              checked={isActive}
              onCheckedChange={(v) => setStatus.mutate(v)}
              disabled={setStatus.isPending}
              aria-label={L("Status organizacji", "Organization status")}
            />
            <span className="text-xs">
              {isActive ? L("aktywna", "active") : L("wstrzymana", "suspended")}
            </span>
          </div>
          {org.contact_email ? (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{org.contact_email}</span>
            </span>
          ) : null}
        </div>

        <SeatManager lang={lang} orgId={org.id} seatsLimit={org.seats_limit} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Zarządzanie miejscami organizacji: licznik użyte/limit, lista miejsc oraz
// dodawanie po e-mailu z rolą. Limit i unikalność egzekwuje RPC org_add_seat.
// ---------------------------------------------------------------------------
function SeatManager({
  lang,
  orgId,
  seatsLimit,
}: {
  lang: Lang;
  orgId: string;
  seatsLimit: number;
}) {
  const L = tr(lang);
  const qc = useQueryClient();
  const seatsKey = ["admin", "org-seats", orgId] as const;

  const seatsQ = useQuery({
    queryKey: seatsKey,
    queryFn: () => fetchAdminOrgSeats(orgId),
  });
  const seats = seatsQ.data ?? [];
  const used = seats.length;
  const atLimit = used >= seatsLimit;

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");

  const addSeat = useMutation({
    mutationFn: () => addOrgSeat(orgId, email.trim(), role),
    onSuccess: () => {
      toast.success(L("Dodano miejsce", "Seat added"));
      setEmail("");
      void qc.invalidateQueries({ queryKey: seatsKey });
    },
    onError: (err: Error) => {
      const msg = err.message.toLowerCase();
      if (msg.includes("limit")) {
        toast.error(L("Osiągnięto limit miejsc", "Seat limit reached"));
      } else if (msg.includes("exists")) {
        toast.error(L("Miejsce już istnieje", "Seat already exists"));
      } else if (msg.includes("invalid email")) {
        toast.error(L("Nieprawidłowy e-mail", "Invalid email"));
      } else {
        toast.error(L("Nie udało się dodać miejsca", "Could not add seat"));
      }
    },
  });

  const removeSeat = useMutation({
    mutationFn: (seatId: string) => removeOrgSeat(seatId),
    onSuccess: () => {
      toast.success(L("Usunięto miejsce", "Seat removed"));
      void qc.invalidateQueries({ queryKey: seatsKey });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const submitAdd = () => {
    if (!email.trim() || addSeat.isPending || atLimit) return;
    addSeat.mutate();
  };

  return (
    <div className="mt-auto space-y-2 rounded-md border border-border/60 p-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {L("Miejsca", "Seats")}
        </span>
        <span
          className={`text-xs tabular-nums ${atLimit ? "font-semibold text-destructive" : "text-muted-foreground"}`}
        >
          {used}/{seatsLimit}
        </span>
      </div>

      {seatsQ.isLoading ? (
        <p className="text-xs text-muted-foreground">{L("Wczytywanie...", "Loading...")}</p>
      ) : seats.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {L("Brak miejsc. Dodaj pierwsze konto.", "No seats yet. Add the first account.")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {seats.map((seat) => (
            <li
              key={seat.id}
              className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-xs font-medium">{seat.invited_email}</span>
                <span className="flex items-center gap-1">
                  <Badge variant={seat.role === "owner" ? "default" : "secondary"}>
                    {seat.role === "owner" ? L("właściciel", "owner") : L("członek", "member")}
                  </Badge>
                  <Badge variant="outline">
                    {seat.claimed_at ? L("aktywne", "active") : L("zaproszony", "invited")}
                  </Badge>
                </span>
              </div>
              {seat.role !== "owner" ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={L("Usuń miejsce", "Remove seat")}
                  disabled={removeSeat.isPending}
                  onClick={() => removeSeat.mutate(seat.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <div className="relative min-w-0 flex-1">
          <Mail
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={L("e-mail konta", "account email")}
            className="h-8 pl-7 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitAdd();
              }
            }}
          />
        </div>
        <Select value={role} onValueChange={(v) => setRole(v as "owner" | "member")}>
          <SelectTrigger className="h-8 w-28 shrink-0 text-sm" aria-label={L("Rola", "Role")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">{L("członek", "member")}</SelectItem>
            <SelectItem value="owner">{L("właściciel", "owner")}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="h-8 shrink-0"
          disabled={!email.trim() || addSeat.isPending || atLimit}
          onClick={submitAdd}
          title={atLimit ? L("Osiągnięto limit miejsc", "Seat limit reached") : undefined}
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {L("Dodaj miejsce", "Add seat")}
        </Button>
      </div>
    </div>
  );
}

