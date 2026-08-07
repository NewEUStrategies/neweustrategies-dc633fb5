// /club/$clubSlug/new - kompozytor tematu.
//
// Osobna trasa, nie dialog: temat ma tytuł, treść do 20 000 znaków, rodzaj
// i opcjonalną kotwicę. Dialog na tyle pól zmusza do scrollowania w oknie
// nad przyciemnionym tłem, co przy dłuższym pisaniu jest męczące.
//
// Wybór rodzaju niesie JEDNOZDANIOWE wyjaśnienie, co dany rodzaj zmienia -
// bo rodzaj zmienia cykl życia wątku, a nie tylko etykietę, i użytkownik nie
// ma skąd tego wiedzieć.
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ClubEnumSelect } from "@/components/admin/clubs/molecules/ClubEnumSelect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClubBySlug, useClubGroups, useCreateClubThread } from "@/lib/clubs/useClubs";
import { CLUB_THREAD_KINDS, type ClubThreadKind } from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/new")({
  head: () => ({ meta: [{ name: "robots", content: "noindex,nofollow" }] }),
  component: ClubNewThread,
});

const TITLE_MIN = 5;
const TITLE_MAX = 200;
const BODY_MIN = 10;
const BODY_MAX = 20000;

function ClubNewThread() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const { clubSlug } = Route.useParams();
  const navigate = useNavigate();

  const clubQ = useClubBySlug(clubSlug);
  const club = clubQ.data ?? null;
  const groupsQ = useClubGroups(club?.id);
  const createM = useCreateClubThread(club?.id ?? "");

  const [groupId, setGroupId] = useState("");
  const [kind, setKind] = useState<ClubThreadKind>("discussion");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);

  // Grupa domyślna: pierwsza, w której wolno założyć temat. Bez tego
  // użytkownik z dostępem do jednej grupy i tak musiałby ją wybrać ręcznie.
  const groups = groupsQ.data ?? [];
  const postable = groups.filter((g) => g.can_post_thread);
  useEffect(() => {
    if (groupId === "" && postable.length > 0) setGroupId(postable[0].id);
  }, [groupId, postable]);

  if (clubQ.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <div className="h-64 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
      </div>
    );
  }

  if (!club || !club.can_post_thread) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              {club?.reason ? t(`club.reason.${club.reason}`) : t("club.cannotPost")}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/club/$clubSlug" params={{ clubSlug }}>{t("club.backToClub")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const titleOk = title.trim().length >= TITLE_MIN && title.trim().length <= TITLE_MAX;
  const bodyOk = body.trim().length >= BODY_MIN && body.trim().length <= BODY_MAX;
  const canGoAnonymous = club.attribution_mode === "anonymous_allowed";

  const submit = () => {
    if (!titleOk || !bodyOk || groupId === "") return;
    createM.mutate(
      { groupId, title: title.trim(), body: body.trim(), kind, anonymous },
      {
        onSuccess: ({ slug, status }) => {
          // Wpis w kolejce premoderacji nie prowadzi do wątku, którego
          // jeszcze nie widać - mówimy o tym wprost i wracamy na listę.
          if (status === "pending") {
            toast.success(t("club.threadPending"));
            void navigate({ to: "/club/$clubSlug", params: { clubSlug } });
            return;
          }
          toast.success(t("club.threadCreated"));
          void navigate({
            to: "/club/$clubSlug/t/$threadSlug",
            params: { clubSlug, threadSlug: slug },
          });
        },
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 h-8 px-2">
        <Link to="/club/$clubSlug" params={{ clubSlug }}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          {isPl ? club.name_pl : club.name_en}
        </Link>
      </Button>

      <h1 className="mb-5 text-2xl font-semibold">{t("club.newThread")}</h1>

      <Card>
        <CardContent className="space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="thread-group">{t("club.group")}</Label>
              <Select value={groupId} onValueChange={setGroupId} disabled={createM.isPending}>
                <SelectTrigger id="thread-group">
                  <SelectValue placeholder={t("club.group")} />
                </SelectTrigger>
                <SelectContent>
                  {postable.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {isPl ? g.name_pl : g.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ClubEnumSelect
              id="thread-kind"
              label={t("club.kind.label")}
              value={kind}
              options={CLUB_THREAD_KINDS}
              i18nPrefix="club.kind"
              hintPrefix="club.kindHint"
              onChange={setKind}
              disabled={createM.isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="thread-title">{t("club.threadTitle")}</Label>
            <Input
              id="thread-title"
              value={title}
              maxLength={TITLE_MAX}
              disabled={createM.isPending}
              onChange={(e) => setTitle(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {title.trim().length} / {TITLE_MAX}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="thread-body">{t("club.threadBody")}</Label>
            <Textarea
              id="thread-body"
              rows={12}
              maxLength={BODY_MAX}
              value={body}
              disabled={createM.isPending}
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {body.trim().length} / {BODY_MAX}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
            {canGoAnonymous ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="thread-anon"
                  checked={anonymous}
                  disabled={createM.isPending}
                  onCheckedChange={setAnonymous}
                />
                <Label htmlFor="thread-anon" className="text-sm">
                  {t("club.postAnonymously")}
                </Label>
              </div>
            ) : (
              <span />
            )}
            <Button
              onClick={submit}
              disabled={createM.isPending || !titleOk || !bodyOk || groupId === ""}
            >
              {t("club.publishThread")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
