// Karta „Wprowadzenia" (LinkedIn-style) w zakładce Activity na /profile.
// Trzy sekcje:
//   - Do mnie (bridge): moderacja - Accept / Decline,
//   - Ode mnie (requester): wysłane - status + Withdraw,
//   - O mnie (target): tylko podgląd zaakceptowanych (info kto Cię polecił).
// Wszystko na jednym RPC (`my_introduction_requests`) w trzech wywołaniach.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Check, Clock, Inbox, Send, ShieldCheck, X, MailOpen, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  useMyIntroductions,
  useRespondIntroduction,
  type IntroductionRow,
} from "@/lib/network/useIntroductions";
import { toastError } from "@/lib/toastError";
import { cn } from "@/lib/utils";
import "@/lib/i18n-network";

type Role = "bridge" | "requester" | "target";

function statusChipClass(status: string): string {
  switch (status) {
    case "accepted":
      return "bg-primary/10 text-primary";
    case "declined":
    case "withdrawn":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  }
}

function Row({ row, role }: { row: IntroductionRow; role: Role }) {
  const { t } = useTranslation();
  const respond = useRespondIntroduction();

  const handle = (action: "accept" | "decline" | "withdraw") => {
    respond.mutate(
      { id: row.id, action },
      {
        onSuccess: () => {
          const key =
            action === "accept"
              ? "network.introductions.acceptedToast"
              : action === "decline"
                ? "network.introductions.declinedToast"
                : "network.introductions.withdrawnToast";
          toast.success(t(key));
        },
        onError: (err) => toastError(err, "save"),
      },
    );
  };

  const otherName =
    role === "bridge"
      ? row.requester_name
      : role === "requester"
        ? row.target_name
        : row.bridge_name;
  const otherAvatar =
    role === "bridge"
      ? row.requester_avatar
      : role === "requester"
        ? row.target_avatar
        : "";
  const otherId =
    role === "bridge"
      ? row.requester_id
      : role === "requester"
        ? row.target_id
        : row.bridge_id;

  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="flex items-start gap-3">
        <Link
          to="/author/$slug"
          params={{ slug: otherId }}
          className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border bg-muted"
        >
          {otherAvatar ? (
            <img
              src={otherAvatar}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <UserIcon className="mx-auto h-5 w-5 translate-y-2.5 text-muted-foreground" />
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/author/$slug"
              params={{ slug: otherId }}
              className="truncate text-sm font-semibold text-foreground hover:underline"
            >
              {otherName}
            </Link>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                statusChipClass(row.status),
              )}
            >
              {t(`network.introductions.status.${row.status}`)}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {role === "bridge" &&
              t("network.introductions.wantsIntroTo", { name: row.target_name })}
            {role === "requester" &&
              t("network.introductions.viaBridge", { name: row.bridge_name })}
            {role === "target" &&
              t("network.introductions.introducedBy", { name: row.bridge_name })}
          </div>
          <blockquote className="mt-2 rounded-md border-l-2 border-primary/40 bg-muted/50 px-3 py-2 text-xs italic leading-relaxed text-foreground/90">
            {row.message}
          </blockquote>

          {role === "bridge" && row.status === "pending" && (
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                className="h-8 gap-1"
                disabled={respond.isPending}
                onClick={() => handle("accept")}
              >
                <Check className="h-3.5 w-3.5" />
                {t("network.introductions.accept")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1"
                disabled={respond.isPending}
                onClick={() => handle("decline")}
              >
                <X className="h-3.5 w-3.5" />
                {t("network.introductions.decline")}
              </Button>
            </div>
          )}
          {role === "requester" && row.status === "pending" && (
            <div className="mt-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs text-muted-foreground"
                disabled={respond.isPending}
                onClick={() => handle("withdraw")}
              >
                <X className="h-3.5 w-3.5" />
                {t("network.introductions.withdraw")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function List({
  rows,
  role,
  emptyKey,
}: {
  rows: ReadonlyArray<IntroductionRow>;
  role: Role;
  emptyKey: string;
}) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-background/40 p-4 text-center text-xs italic text-muted-foreground">
        {t(emptyKey)}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Row key={r.id} row={r} role={role} />
      ))}
    </div>
  );
}

export function IntroductionsCard() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Role>("bridge");

  const bridgeQ = useMyIntroductions("bridge");
  const requesterQ = useMyIntroductions("requester");
  const targetQ = useMyIntroductions("target");

  const pendingIn = (bridgeQ.data ?? []).filter((r) => r.status === "pending").length;
  const pendingOut = (requesterQ.data ?? []).filter((r) => r.status === "pending").length;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Role)}>
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="bridge" className="gap-1.5 text-xs">
          <Inbox className="h-3.5 w-3.5" />
          {t("network.introductions.tabBridge")}
          {pendingIn > 0 && (
            <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {pendingIn}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="requester" className="gap-1.5 text-xs">
          <Send className="h-3.5 w-3.5" />
          {t("network.introductions.tabRequester")}
          {pendingOut > 0 && (
            <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {pendingOut}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="target" className="gap-1.5 text-xs">
          <MailOpen className="h-3.5 w-3.5" />
          {t("network.introductions.tabTarget")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="bridge" className="mt-3">
        <List
          rows={bridgeQ.data ?? []}
          role="bridge"
          emptyKey="network.introductions.emptyBridge"
        />
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
          {t("network.introductions.bridgeHint")}
        </p>
      </TabsContent>
      <TabsContent value="requester" className="mt-3">
        <List
          rows={requesterQ.data ?? []}
          role="requester"
          emptyKey="network.introductions.emptyRequester"
        />
      </TabsContent>
      <TabsContent value="target" className="mt-3">
        <List
          rows={(targetQ.data ?? []).filter((r) => r.status === "accepted")}
          role="target"
          emptyKey="network.introductions.emptyTarget"
        />
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <Clock className="mt-0.5 h-3 w-3 shrink-0" />
          {t("network.introductions.targetHint")}
        </p>
      </TabsContent>
    </Tabs>
  );
}
