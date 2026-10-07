// Molekuła: wspólne części rozmowy w karcie strumienia - wiersz wypowiedzi,
// kompozytor i komunikat zamiast kompozytora.
//
// DWA ŹRÓDŁA, JEDEN WYGLĄD. Komentarz pod wpisem ściany (`club_post_comments`)
// i odpowiedź w wątku (`club_replies`) to w bazie różne byty, ale w karcie
// czytają się tak samo: twarz, dymek z nazwiskiem, czasem i treścią, pod nim
// akcje. Gdyby każda sekcja miała własny wiersz, rozjechałyby się przy
// pierwszej poprawce - dokładnie z tego powodu karty strumienia mają jedną
// powłokę (`ClubFeedCard`).
//
// TYPOGRAFIA KLUBU: nazwisko i treść 13 px (`text-sm`), czas i firma 11 px
// (`text-xs`), akcje stopniem kontrolek (`--fs-button`). Nic nie jest
// ucinane - nazwisko, firma i tytuł linku zawijają się do kolejnej linii.
//
// AUTOR ZAWSZE PRZEZ `ClubAuthorLabel`. Pseudonim (Chatham House), konto
// usunięte i autor jawny przychodzą jako jedna etykieta z `toAuthorLabel`;
// bez `profileSlug` wiersz nie ma ani odnośnika, ani dymka, ani „Odpowiedz"
// (wzmianka zdradziłaby, kim jest pseudonim).
//
// FOKUS NIE SPADA NA <body>. Akcja, która znika po kliknięciu („Tak, usuń",
// „Zatwierdź", „Wyślij" zablokowane do kolejnej treści), najpierw oddaje
// fokus elementowi, który zostaje: polu kompozytora, wierszowi albo całej
// sekcji. Inaczej czytelnik klawiatury i czytnika ekranu wracałby na
// początek strony po każdym komentarzu.
import { useEffect, useId, useRef, useState, type MutableRefObject } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Check, EyeOff, Loader2, Lock, LogIn, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubAuthorIdentity } from "@/components/clubs/atoms/ClubAuthorIdentity";
import { HUB_LABEL } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubInlineText } from "@/components/clubs/atoms/ClubInlineText";
import { ClubMentionField } from "@/components/clubs/atoms/ClubMentionField";
import {
  ClubComposerLinkCard,
  ClubComposerLinkStatus,
  ClubLinkSnapshotCard,
} from "@/components/clubs/molecules/ClubComposerLinkCard";
import { ClubFeedTime } from "@/components/clubs/molecules/ClubFeedCard";
import type { ComposerLinkPreview } from "@/components/clubs/molecules/useComposerLinkPreview";
import type { ClubFeedDiscussionMode } from "@/components/clubs/molecules/feedDiscussion";
import type { ClubLinkSnapshot } from "@/lib/clubs/postTypes";
import { showsClubReplyCounter } from "@/lib/clubs/threadComposer";
import type { ClubAuthorLabel } from "@/lib/clubs/types";
import { uiLang } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

/**
 * Akcja tekstowa pod dymkiem i nad listą - stopień pisma kontrolek huba.
 *
 * Zajęta akcja jest `aria-disabled`, nie `disabled`: `disabled` zdejmuje
 * fokus z przycisku, który właśnie go miał, i klawiatura lądowała na <body>.
 */
export const CLUB_FEED_DISCUSSION_ACTION = cn(
  "inline-flex min-h-7 items-center gap-1.5 rounded-md px-1.5 text-left",
  "text-[length:var(--fs-button)] font-semibold leading-tight text-muted-foreground",
  "transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "disabled:pointer-events-none disabled:opacity-60 aria-disabled:cursor-default aria-disabled:opacity-60",
);

const NAME = "text-sm font-semibold leading-5 text-foreground [overflow-wrap:anywhere]";

/** Długość w PUNKTACH KODOWYCH, jak `char_length` w bazie. */
function codePoints(text: string): number {
  return Array.from(text.trim()).length;
}

export function ClubFeedDiscussionItem({
  author,
  createdAt,
  body,
  clubSlug,
  pending = false,
  link = null,
  onReply,
  onDelete,
  deleting = false,
  onApprove,
  onHide,
  moderating = false,
  testId,
}: {
  author: ClubAuthorLabel;
  createdAt: string;
  body: string;
  clubSlug: string;
  /** Wypowiedź w kolejce premoderacji - widzą ją tylko autor i moderacja. */
  pending?: boolean;
  /** Migawka podglądu linku zapisana przy komentarzu. */
  link?: ClubLinkSnapshot | null;
  /** „Odpowiedz" - tylko przy jawnym autorze i otwartym kompozytorze. */
  onReply?: () => void;
  /** „Usuń" - tylko przy prawie zarządzania (autor albo moderator). */
  onDelete?: () => void;
  deleting?: boolean;
  /** „Zatwierdź" - moderator przy komentarzu w kolejce (`can_approve`). */
  onApprove?: () => void;
  /** „Ukryj" - druga decyzja moderatora o komentarzu w kolejce. */
  onHide?: () => void;
  /** Decyzja moderatora w drodze - obie akcje czekają. */
  moderating?: boolean;
  testId?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [confirming, setConfirming] = useState(false);
  const itemRef = useRef<HTMLLIElement | null>(null);
  const deleteRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  // Po „Anuluj" fokus wraca na „Usuń" - nie ginie na <body>, gdy pytanie znika.
  const returnFocus = useRef(false);

  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      deleteRef.current?.focus();
    }
  }, [confirming]);

  return (
    <li
      ref={itemRef}
      // Cel fokusu po „Zatwierdź": przycisk znika, wiersz zostaje (już jawny).
      tabIndex={-1}
      className={cn(
        "club-feed-card-in flex items-start gap-2.5 rounded-lg focus:outline-none",
        (deleting || moderating) && "opacity-60",
      )}
      data-testid={testId}
      data-status={pending ? "pending" : "visible"}
      aria-busy={deleting || moderating || undefined}
    >
      <ClubAuthorAvatar
        name={author.name}
        avatarUrl={author.avatarUrl}
        size="sm"
        muted={author.kind !== "named"}
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "rounded-lg px-3 py-2",
            // Kolejka premoderacji ma INNY dymek, nie tylko plakietkę: autor
            // ma od razu widzieć, że tej wypowiedzi nikt poza nim jeszcze nie czyta.
            // Zwykły dymek stoi na `--secondary`, nie na `--muted`: w ciemnym
            // motywie `--muted` jest kolorem karty i dymek by znikał.
            pending ? "border border-dashed border-amber-500/50 bg-amber-500/5" : "bg-secondary",
          )}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-4 text-muted-foreground">
            <ClubAuthorIdentity author={author} nameClassName={NAME} wrap />
            {/* Kropka jest PRZYKLEJONA do czasu: przy zawinięciu wiersz łamie
                się na „Anna Nowak · Instytut" / „· 40 minut temu", a kropka
                nigdy nie wisi samotnie na końcu linii. */}
            <span className="inline-flex items-center gap-x-1.5 whitespace-nowrap">
              <span aria-hidden="true">·</span>
              <ClubFeedTime iso={createdAt} lang={lang} />
            </span>
            {pending ? (
              <span
                className={cn(
                  HUB_LABEL,
                  "min-h-5 border-amber-500/40 bg-amber-500/10 py-0.5 text-amber-800 dark:text-amber-300",
                )}
                data-testid="club-feed-discussion-pending"
              >
                {t("club.comments.pending")}
              </span>
            ) : null}
          </div>
          {/* Treść jak w całym klubie: adresy jako bezpieczne linki z podglądem,
              @wzmianki z wizytówką, #tagi jako filtr - zero HTML-a z pola. */}
          <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-foreground [overflow-wrap:anywhere]">
            <ClubInlineText body={body} clubSlug={clubSlug} />
          </p>
          {link !== null ? <ClubLinkSnapshotCard snapshot={link} className="mt-2" /> : null}
        </div>

        {onReply !== undefined ||
        onDelete !== undefined ||
        onApprove !== undefined ||
        onHide !== undefined ? (
          confirming && onDelete !== undefined ? (
            <div
              role="group"
              aria-label={t("club.comments.deleteConfirm")}
              className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 pl-1.5"
            >
              <span className="text-xs leading-4 text-foreground">
                {t("club.comments.deleteConfirm")}
              </span>
              <button
                type="button"
                className={cn(
                  CLUB_FEED_DISCUSSION_ACTION,
                  "text-destructive hover:text-destructive",
                )}
                onClick={() => {
                  // Wołający przenosi fokus SYNCHRONICZNIE (przed commitem
                  // `setConfirming(false)`) na element, który przetrwa
                  // zniknięcie tego przycisku i - po odświeżeniu - całego wiersza.
                  setConfirming(false);
                  onDelete();
                }}
                data-testid="club-feed-discussion-delete-confirm"
              >
                {t("club.comments.deleteConfirmAction")}
              </button>
              <button
                ref={cancelRef}
                type="button"
                className={CLUB_FEED_DISCUSSION_ACTION}
                onClick={() => {
                  returnFocus.current = true;
                  setConfirming(false);
                }}
              >
                {t("club.comments.cancel")}
              </button>
            </div>
          ) : (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1 pl-0.5">
              {/* Decyzja moderatora stoi PIERWSZA: w kolejce to jest ta akcja,
                  po którą moderator przyszedł do karty. */}
              {onApprove !== undefined ? (
                <button
                  type="button"
                  className={cn(
                    CLUB_FEED_DISCUSSION_ACTION,
                    "text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300",
                  )}
                  aria-disabled={moderating || undefined}
                  onClick={() => {
                    if (moderating) return;
                    // Przycisk zniknie razem z kolejką - fokus czeka na wierszu.
                    itemRef.current?.focus({ preventScroll: true });
                    onApprove();
                  }}
                  aria-label={t("club.comments.approveTo", { name: author.name })}
                  data-testid="club-feed-discussion-approve"
                >
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {t("club.comments.approve")}
                </button>
              ) : null}
              {onHide !== undefined ? (
                <button
                  type="button"
                  className={CLUB_FEED_DISCUSSION_ACTION}
                  aria-disabled={moderating || undefined}
                  onClick={() => {
                    if (!moderating) onHide();
                  }}
                  aria-label={t("club.comments.hideTo", { name: author.name })}
                  data-testid="club-feed-discussion-hide"
                >
                  <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {t("club.comments.hide")}
                </button>
              ) : null}
              {onReply !== undefined ? (
                <button
                  type="button"
                  className={CLUB_FEED_DISCUSSION_ACTION}
                  onClick={onReply}
                  aria-label={t("club.comments.replyTo", { name: author.name })}
                  data-testid="club-feed-discussion-reply"
                >
                  {t("club.comments.reply")}
                </button>
              ) : null}
              {onDelete !== undefined ? (
                <button
                  ref={deleteRef}
                  type="button"
                  className={cn(CLUB_FEED_DISCUSSION_ACTION, "hover:text-destructive")}
                  onClick={() => {
                    if (!deleting) setConfirming(true);
                  }}
                  aria-disabled={deleting || undefined}
                  data-testid="club-feed-discussion-delete"
                >
                  {t("club.comments.delete")}
                </button>
              ) : null}
            </div>
          )
        ) : null}
      </div>
    </li>
  );
}

/**
 * Kompozytor rozmowy: pole z @wzmiankami, karta linku i „Wyślij".
 *
 * Pole NIE jest blokowane w trakcie wysyłki - blokada zabrałaby fokus
 * i kursor. Podwójną wysyłkę zatrzymuje `canSubmit` (ta sama reguła dla
 * przycisku i dla Ctrl/Cmd+Enter). „Wyślij" oddaje fokus polu, zanim się
 * zablokuje: zablokowany przycisk z fokusem zrzucał go na <body>.
 *
 * PODPOWIEDŹ O @ STOI POD POLEM, nie w placeholderze. Placeholder znika przy
 * fokusie (a „Komentuj" od razu ustawia fokus w polu), a dłuższy zawijał się
 * na telefonie i podwajał wysokość pustego pola. Linia pomocnicza jest
 * widoczna cały czas i połączona z polem przez `aria-describedby`.
 */
export function ClubFeedDiscussionComposer({
  clubId,
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  pending,
  canSubmit,
  onSubmit,
  textareaRef,
  link = null,
  testId,
}: {
  clubId: string;
  value: string;
  onChange: (value: string) => void;
  /** Nazwa pola dla czytnika ekranu. */
  label: string;
  placeholder: string;
  maxLength: number;
  pending: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  /** Podgląd linku - tylko tam, gdzie migawka ma dokąd pojechać (komentarz). */
  link?: ComposerLinkPreview | null;
  testId?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const fieldId = useId();
  const counterId = `${fieldId}-counter`;
  const hintId = `${fieldId}-hint`;
  const used = codePoints(value);
  const showCounter = showsClubReplyCounter(value, maxLength);

  return (
    <div data-testid={testId}>
      <div className="flex items-end gap-2">
        <ClubMentionField
          id={fieldId}
          className="flex-1"
          value={value}
          onChange={onChange}
          lang={lang}
          clubId={clubId}
          label={label}
          placeholder={placeholder}
          maxLength={maxLength}
          onSubmit={() => {
            if (canSubmit) onSubmit();
          }}
          textareaRef={textareaRef}
          invalid={used > maxLength}
          describedBy={showCounter ? `${hintId} ${counterId}` : hintId}
          testId="club-feed-composer-field"
        />
        {/* Wysokość przycisku = wysokość pola w jednej linii (2.5 rem), a przy
            rosnącym polu przycisk zostaje przy dolnej krawędzi. */}
        <Button
          type="button"
          size="sm"
          className="h-10 shrink-0 gap-1.5 rounded-lg px-3"
          disabled={!canSubmit}
          onClick={() => {
            textareaRef.current?.focus();
            onSubmit();
          }}
          aria-label={t("club.comments.submit")}
          data-testid="club-feed-composer-submit"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">{t("club.comments.submit")}</span>
        </Button>
      </div>
      {/* Linia pomocnicza pod polem: podpowiedź o @ po lewej, licznik
          znaków (dopiero blisko limitu) po prawej - jeden rząd 11 px. */}
      <div className="mt-1 flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5">
        <p
          id={hintId}
          className="min-w-0 text-xs leading-4 text-muted-foreground"
          data-testid="club-feed-composer-hint"
        >
          {t("club.comments.mentionHint")}
        </p>
        {showCounter ? (
          <p
            id={counterId}
            aria-live="polite"
            className={cn(
              "ml-auto text-right text-xs leading-4 tabular-nums",
              used > maxLength ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {t("club.comments.counter", { used, max: maxLength })}
          </p>
        ) : null}
      </div>
      {link !== null && link.url !== null ? (
        <ClubComposerLinkCard
          url={link.url}
          snapshot={link.snapshot}
          loading={link.loading}
          onDismiss={link.dismiss}
          className="mt-2"
        />
      ) : null}
      {/* Region statusu stoi ZAWSZE (także bez karty) - patrz
          `ClubComposerLinkStatus`. Kompozytor bez podglądu (odpowiedź
          w wątku) nie ma czego ogłaszać. */}
      {link !== null ? <ClubComposerLinkStatus link={link} /> : null}
    </div>
  );
}

/**
 * Zdanie w miejscu kompozytora - gość, brak prawa głosu, zamknięty wątek.
 *
 * Brak prawa głosu mówi o tym, co wiadomo NA PEWNO: przy powodzie z bazy
 * (`reasonKey`, np. dział za planem) - powód; bez niego - samo prawo głosu,
 * bez „w tym dziale" (wpis bywa poza działem, a karta wątku zna często tylko
 * prawo klubu). Karta wątku mówi o odpowiadaniu, wpis - o komentowaniu.
 */
export function ClubFeedDiscussionNotice({
  mode,
  context = "post",
  reasonKey = null,
}: {
  mode: Exclude<ClubFeedDiscussionMode, "write">;
  context?: "post" | "thread";
  /** Klucz i18n powodu odmowy (`clubBlockedReplyKey`) - tylko przy `readOnly`. */
  reasonKey?: string | null;
}) {
  const { t } = useTranslation();
  const Icon = mode === "guest" ? LogIn : Lock;
  return (
    <p
      className="flex items-start gap-2 rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground"
      data-testid="club-feed-discussion-notice"
      data-mode={mode}
    >
      <Icon className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        {mode === "guest" ? (
          <>
            {t("club.comments.signIn")}{" "}
            <Link
              to="/login"
              search={{ mode: "signin" }}
              className="font-semibold text-primary underline-offset-2 hover:underline"
            >
              {t("club.comments.signInAction")}
            </Link>
          </>
        ) : mode === "locked" ? (
          t("club.comments.locked")
        ) : reasonKey !== null ? (
          t(reasonKey)
        ) : context === "thread" ? (
          t("club.comments.threadReadOnly")
        ) : (
          t("club.comments.readOnly")
        )}
      </span>
    </p>
  );
}
