import i18n from "./i18n";

// Overlay dla kampanii newslettera (/admin/newsletter/campaigns), akcji
// statusu subskrybentów oraz publicznej strony wypisu (/newsletter/unsubscribe).

const pl = {
  adminNewsletter: {
    campaigns: {
      title: "Kampanie newslettera",
      subtitle:
        "Twórz i wysyłaj wydania newslettera do potwierdzonych subskrybentów. Wysyłka odbywa się partiami i jest odporna na ponowienia.",
      newCampaign: "Nowa kampania",
      colName: "Nazwa",
      colSubject: "Temat",
      colSegment: "Segment",
      colStatus: "Status",
      colProgress: "Wysłane",
      colUpdated: "Aktualizacja",
      empty: "Brak kampanii. Utwórz pierwszą powyżej.",
      status: {
        draft: "Szkic",
        sending: "Wysyłanie",
        sent: "Wysłana",
        canceled: "Anulowana",
      },
      segmentAll: "Wszyscy",
      editTitle: "Edytuj kampanię",
      createTitle: "Nowa kampania",
      name: "Nazwa robocza",
      namePlaceholder: "np. Briefing tygodnia 24",
      subjectPl: "Temat (PL)",
      subjectEn: "Temat (EN)",
      introPl: "Wstęp (PL)",
      introEn: "Wstęp (EN)",
      segment: "Segment językowy",
      segmentHint: "Subskrybenci z językiem EN dostaną wersję EN (fallback: PL).",
      ctaLabelPl: "Etykieta CTA (PL)",
      ctaLabelEn: "Etykieta CTA (EN)",
      ctaUrl: "Adres CTA",
      posts: "Posty w wydaniu",
      postsHint: "Kolejność wyboru = kolejność w mailu.",
      postsEmpty: "Brak opublikowanych postów do wyboru.",
      save: "Zapisz kampanię",
      saved: "Kampania zapisana",
      saveError: "Nie udało się zapisać kampanii.",
      subjectRequired: "Temat (PL) jest wymagany.",
      cancelEdit: "Anuluj",
      delete: "Usuń",
      deleteConfirm: "Usunąć tę kampanię? Tej operacji nie można cofnąć.",
      deleted: "Kampania usunięta",
      preview: "Podgląd",
      previewPl: "Podgląd PL",
      previewEn: "Podgląd EN",
      send: "Wyślij",
      sendConfirmTitle: "Wysłać kampanię?",
      sendConfirmBody:
        "Wiadomość trafi do wszystkich potwierdzonych subskrybentów wybranego segmentu. Wysyłki nie można cofnąć.",
      sendStart: "Rozpocznij wysyłkę",
      sending: "Wysyłanie... {{sent}}/{{total}} (błędy: {{failed}})",
      sendDone: "Wysyłka zakończona: {{sent}} dostarczonych, {{failed}} błędów.",
      sendError: "Wysyłka przerwana. Możesz ją wznowić przyciskiem Wyślij.",
      resume: "Wznów wysyłkę",
      emailNotConfigured:
        "Wysyłka e-mail nie jest skonfigurowana (RESEND_API_KEY / LOVABLE_API_KEY). Kampania pozostała w kolejce - skonfiguruj klucze i wznów wysyłkę.",
      noRecipients:
        "Brak odbiorców w wybranym segmencie - kampania pozostała szkicem. Sprawdź listę subskrybentów.",
      results: "Wyniki",
      recipients: "Odbiorcy",
    },
    subscribers: {
      unsubscribeAction: "Wypisz",
      resubscribeAction: "Przywróć",
      unsubscribed: "Subskrybent wypisany",
      resubscribed: "Subskrypcja przywrócona",
      actionError: "Nie udało się zmienić statusu.",
    },
  },
  newsletterUnsubscribe: {
    loading: "Przetwarzamy Twoje żądanie...",
    okTitle: "Wypisano z newslettera",
    okBody:
      "Nie będziesz już otrzymywać od nas wiadomości. Możesz zapisać się ponownie w każdej chwili.",
    alreadyTitle: "Ten adres jest już wypisany",
    alreadyBody: "Nie wysyłamy już wiadomości na ten adres.",
    invalidTitle: "Nieprawidłowy link",
    invalidBody:
      "Link wypisu jest niekompletny lub wygasł. Skorzystaj z linku z najnowszej wiadomości.",
    rateLimitedTitle: "Zbyt wiele prób",
    rateLimitedBody: "Spróbuj ponownie za kilka minut.",
    backHome: "Wróć na stronę główną",
  },
};

const en: typeof pl = {
  adminNewsletter: {
    campaigns: {
      title: "Newsletter campaigns",
      subtitle:
        "Create and send newsletter issues to confirmed subscribers. Delivery runs in batches and is retry-safe.",
      newCampaign: "New campaign",
      colName: "Name",
      colSubject: "Subject",
      colSegment: "Segment",
      colStatus: "Status",
      colProgress: "Sent",
      colUpdated: "Updated",
      empty: "No campaigns yet. Create the first one above.",
      status: {
        draft: "Draft",
        sending: "Sending",
        sent: "Sent",
        canceled: "Canceled",
      },
      segmentAll: "Everyone",
      editTitle: "Edit campaign",
      createTitle: "New campaign",
      name: "Internal name",
      namePlaceholder: "e.g. Weekly briefing 24",
      subjectPl: "Subject (PL)",
      subjectEn: "Subject (EN)",
      introPl: "Intro (PL)",
      introEn: "Intro (EN)",
      segment: "Language segment",
      segmentHint: "Subscribers with EN language get the EN version (fallback: PL).",
      ctaLabelPl: "CTA label (PL)",
      ctaLabelEn: "CTA label (EN)",
      ctaUrl: "CTA URL",
      posts: "Posts in this issue",
      postsHint: "Selection order = order in the email.",
      postsEmpty: "No published posts to choose from.",
      save: "Save campaign",
      saved: "Campaign saved",
      saveError: "Could not save the campaign.",
      subjectRequired: "Subject (PL) is required.",
      cancelEdit: "Cancel",
      delete: "Delete",
      deleteConfirm: "Delete this campaign? This cannot be undone.",
      deleted: "Campaign deleted",
      preview: "Preview",
      previewPl: "PL preview",
      previewEn: "EN preview",
      send: "Send",
      sendConfirmTitle: "Send this campaign?",
      sendConfirmBody:
        "The message will reach every confirmed subscriber in the selected segment. Sending cannot be undone.",
      sendStart: "Start sending",
      sending: "Sending... {{sent}}/{{total}} (failed: {{failed}})",
      sendDone: "Send complete: {{sent}} delivered, {{failed}} failed.",
      sendError: "Sending interrupted. You can resume with the Send button.",
      resume: "Resume sending",
      emailNotConfigured:
        "Email delivery is not configured (RESEND_API_KEY / LOVABLE_API_KEY). The campaign stays queued - configure the keys and resume.",
      noRecipients:
        "No recipients in the selected segment - the campaign stays a draft. Check the subscriber list.",
      results: "Results",
      recipients: "Recipients",
    },
    subscribers: {
      unsubscribeAction: "Unsubscribe",
      resubscribeAction: "Restore",
      unsubscribed: "Subscriber unsubscribed",
      resubscribed: "Subscription restored",
      actionError: "Could not change the status.",
    },
  },
  newsletterUnsubscribe: {
    loading: "Processing your request...",
    okTitle: "You have been unsubscribed",
    okBody: "You will no longer receive our messages. You can subscribe again at any time.",
    alreadyTitle: "This address is already unsubscribed",
    alreadyBody: "We no longer send messages to this address.",
    invalidTitle: "Invalid link",
    invalidBody:
      "The unsubscribe link is incomplete or expired. Use the link from the latest message.",
    rateLimitedTitle: "Too many attempts",
    rateLimitedBody: "Please try again in a few minutes.",
    backHome: "Back to the homepage",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
