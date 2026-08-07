// Organizm: „Widoczność i kontakt" - wszystko, co decyduje o tym, KTO Cię
// zobaczy i KTO może się z Tobą skontaktować.
//
// §10 audytu IA prywatności. Ta sekcja mieszkała dotąd WEWNĄTRZ formularza
// edycji tożsamości (`AccountIdentityPanel` na /profile/edit) - między polem
// „imię" a wgrywaniem awatara, pod przyciskiem „Zapisz", którego wcale nie
// dotyczyła (każdy przełącznik zapisuje się natychmiast własną mutacją). Efekt:
// ustawienia prywatności były w trzech różnych miejscach produktu - widoczność
// i kontakt w edytorze profilu, zgody w /profile/privacy, prawa do danych
// w /profile/security - a hub prywatności nie zawierał ANI JEDNEGO ustawienia
// prywatności, tylko zgody marketingowe.
//
// Teraz jest jednym z trzech bloków huba /profile/privacy.
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingRow } from "@/components/molecules/SettingRow";
import { PublicExposureNotice } from "@/components/molecules/PublicExposureNotice";
import {
  useDiscoverable,
  useSetDiscoverable,
  useExpertRequestsEnabled,
  useSetExpertRequestsEnabled,
} from "@/lib/chat/useDiscoverable";
import { usePublicExposure } from "@/lib/profile/usePublicExposure";
import {
  ALLOW_MESSAGES_FROM_LEVELS,
  DEFAULT_NOTIFICATION_PREFERENCES,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  type AllowConnectionsFrom,
  type AllowMessagesFrom,
  type NotificationPreferences,
} from "@/lib/notifications/useNotifications";

/** Klucze i18n opcji „kto może zacząć nowy wątek" - kolejność z modelu. */
const ALLOW_MESSAGES_LABEL_KEYS: Readonly<Record<AllowMessagesFrom, string>> = {
  everyone: "profilePrivacy.allowMessagesEveryone",
  contacts: "profilePrivacy.allowMessagesContacts",
  existing: "profilePrivacy.allowMessagesExisting",
  nobody: "profilePrivacy.allowMessagesNobody",
};

const ALLOW_CONNECTIONS_LEVELS: readonly AllowConnectionsFrom[] = ["everyone", "mutual", "nobody"];

const ALLOW_CONNECTIONS_LABEL_KEYS: Readonly<Record<AllowConnectionsFrom, string>> = {
  everyone: "network.allowConnectionsEveryone",
  mutual: "network.allowConnectionsMutual",
  nobody: "network.allowConnectionsNobody",
};

/** Jeden przełącznik prywatności czatu (etykieta + podpowiedź + switch). */
function ChatPrivacyToggle(props: {
  prefKey: "read_receipts_enabled" | "typing_indicators_enabled" | "show_online_status";
  labelKey: string;
  hintKey: string;
}) {
  const { t } = useTranslation();
  const prefsQ = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();
  const prefs: NotificationPreferences = prefsQ.data ?? DEFAULT_NOTIFICATION_PREFERENCES;
  const checked = prefs[props.prefKey];

  return (
    <SettingRow
      label={t(props.labelKey)}
      hint={t(props.hintKey)}
      control={
        <Switch
          checked={checked}
          disabled={prefsQ.isLoading || updatePrefs.isPending}
          onCheckedChange={(next) =>
            updatePrefs.mutate(
              { [props.prefKey]: next },
              {
                onSuccess: () => toast.success(t("profilePrivacy.saved")),
                onError: () => toast.error(t("profilePrivacy.saveError")),
              },
            )
          }
          aria-label={t(props.labelKey)}
        />
      }
    />
  );
}

export function VisibilityAndContactSection() {
  const { t } = useTranslation();
  const discoverableQ = useDiscoverable();
  const setDiscoverable = useSetDiscoverable();
  const expertRequestsQ = useExpertRequestsEnabled();
  const setExpertRequests = useSetExpertRequestsEnabled();
  const expertRequestsOn = expertRequestsQ.data ?? true;
  const prefsQ = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();
  // Ekspozycja poza platformą jest NIEZALEŻNA od `discoverable` (ten steruje
  // wyłącznie katalogiem wewnętrznym) - stąd osobny odczyt i osobna nota.
  const exposureQ = usePublicExposure();
  const on = discoverableQ.data ?? false;
  const allowFrom: AllowMessagesFrom =
    prefsQ.data?.allow_messages_from ?? DEFAULT_NOTIFICATION_PREFERENCES.allow_messages_from;
  const allowConnections: AllowConnectionsFrom =
    prefsQ.data?.allow_connections_from ?? DEFAULT_NOTIFICATION_PREFERENCES.allow_connections_from;

  return (
    <section
      aria-labelledby="privacy-visibility-heading"
      className={
        "grid gap-3 rounded-[6px] border px-4 py-4 " +
        (on ? "border-border/60 bg-muted/30" : "border-[var(--brand)]/40 bg-[var(--brand)]/5")
      }
    >
      <h3 id="privacy-visibility-heading" className="text-sm font-semibold text-foreground/80">
        {t("profilePrivacy.section")}
      </h3>

      <SettingRow
        first
        label={t("profilePrivacy.discoverableLabel")}
        hint={t("profilePrivacy.discoverableHint")}
        note={
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground/80">
            {t("profilePrivacy.externalNote")}
          </p>
        }
        control={
          <div className="flex items-center gap-2">
            {on ? (
              <Eye
                className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
            ) : (
              <EyeOff className="h-4 w-4 shrink-0 text-[var(--brand)]" aria-hidden />
            )}
            <Switch
              checked={on}
              disabled={discoverableQ.isLoading || setDiscoverable.isPending}
              onCheckedChange={(next) =>
                setDiscoverable.mutate(next, {
                  onSuccess: () => toast.success(t("profilePrivacy.saved")),
                  onError: () => toast.error(t("profilePrivacy.saveError")),
                })
              }
              aria-label={t("profilePrivacy.discoverableLabel")}
            />
            <span className="hidden text-xs font-medium sm:inline">
              {on ? t("profilePrivacy.discoverableOn") : t("profilePrivacy.discoverableOff")}
            </span>
          </div>
        }
      >
        <PublicExposureNotice
          className="mt-2"
          exposure={exposureQ.data ?? null}
          loading={exposureQ.isLoading}
        />
      </SettingRow>

      {/* Zgoda na "Zapytanie do eksperta" - steruje przyciskiem na Twoim profilu
          (obok globalnego przełącznika admina; egzekwowane też w DB). */}
      <SettingRow
        label={t("profilePrivacy.expertRequestsLabel")}
        hint={t("profilePrivacy.expertRequestsHint")}
        control={
          <div className="flex items-center gap-2">
            <Switch
              checked={expertRequestsOn}
              disabled={expertRequestsQ.isLoading || setExpertRequests.isPending}
              onCheckedChange={(next) =>
                setExpertRequests.mutate(next, {
                  onSuccess: () => toast.success(t("profilePrivacy.saved")),
                  onError: () => toast.error(t("profilePrivacy.saveError")),
                })
              }
              aria-label={t("profilePrivacy.expertRequestsLabel")}
            />
            <span className="hidden text-xs font-medium sm:inline">
              {expertRequestsOn
                ? t("profilePrivacy.expertRequestsOn")
                : t("profilePrivacy.expertRequestsOff")}
            </span>
          </div>
        }
      />

      {/* Kto może zacząć NOWY wątek - rozmowę bezpośrednią albo krąg.
          Egzekwuje public.chat_accepts_new_thread, nie interfejs. */}
      <SettingRow
        label={t("profilePrivacy.allowMessagesLabel")}
        hint={t("profilePrivacy.allowMessagesHint")}
        controlWidth="wide"
        control={
          <Select
            value={allowFrom}
            disabled={prefsQ.isLoading || updatePrefs.isPending}
            onValueChange={(next) =>
              updatePrefs.mutate(
                { allow_messages_from: next as AllowMessagesFrom },
                {
                  onSuccess: () => toast.success(t("profilePrivacy.saved")),
                  onError: () => toast.error(t("profilePrivacy.saveError")),
                },
              )
            }
          >
            <SelectTrigger aria-label={t("profilePrivacy.allowMessagesLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALLOW_MESSAGES_FROM_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {t(ALLOW_MESSAGES_LABEL_KEYS[level])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {/* Kto może wysłać zaproszenie do sieci kontaktów (egzekwowane w DB). */}
      <SettingRow
        label={t("network.allowConnectionsLabel")}
        hint={t("network.allowConnectionsHint")}
        controlWidth="wide"
        control={
          <Select
            value={allowConnections}
            disabled={prefsQ.isLoading || updatePrefs.isPending}
            onValueChange={(next) =>
              updatePrefs.mutate(
                { allow_connections_from: next as AllowConnectionsFrom },
                {
                  onSuccess: () => toast.success(t("profilePrivacy.saved")),
                  onError: () => toast.error(t("profilePrivacy.saveError")),
                },
              )
            }
          >
            <SelectTrigger aria-label={t("network.allowConnectionsLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALLOW_CONNECTIONS_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {t(ALLOW_CONNECTIONS_LABEL_KEYS[level])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <ChatPrivacyToggle
        prefKey="read_receipts_enabled"
        labelKey="profilePrivacy.readReceiptsLabel"
        hintKey="profilePrivacy.readReceiptsHint"
      />
      <ChatPrivacyToggle
        prefKey="typing_indicators_enabled"
        labelKey="profilePrivacy.typingLabel"
        hintKey="profilePrivacy.typingHint"
      />
      <ChatPrivacyToggle
        prefKey="show_online_status"
        labelKey="profilePrivacy.onlineStatusLabel"
        hintKey="profilePrivacy.onlineStatusHint"
      />
    </section>
  );
}
