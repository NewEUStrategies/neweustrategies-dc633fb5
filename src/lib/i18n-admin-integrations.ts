// Słownik ekranu integracji w administracji (PL/EN) - endpointy wychodzące,
// sekrety w Vault, kolejka dostaw i ręczny dispatch.
//
// PO CO POWSTAŁ. Ekran niósł bliźniaka `L(pl, en)` i 50 napisów istniejących
// wyłącznie w kodzie - w tym komunikaty podsumowania dispatchu i treści błędów,
// po których operator poznaje, czy dostawy w ogóle wychodzą.
import i18n from "./i18n";

const pl = {
  adminIntegrations: {
    error: "Błąd: {{message}}",
    dispatcherError: "Błąd dispatchera: {{message}}",
    dispatchSummary: "Wysłano: {{delivered}}, błędy: {{failed}}, przejęto: {{claimed}}",
    disabledEndpointSkipped:
      'Wpis wyłączony jest pomijany przy dispatchu (delivery kończy się z powodem "endpoint disabled" - nie ma retry).',
    confirmDeleteEndpoint:
      "Usunąć endpoint „{{name}}”? Dostawy tego endpointu przestaną być tworzone.",
    secretLivesInVault:
      'Sekret trzymamy w Vault - platforma go nigdy nie zwraca do przeglądarki. Wpisz nową wartość, żeby ustawić lub zrotować; zaznacz "wyczyść", żeby usunąć podpisywanie.',
    webhookGenericJsonHmac: "Webhook (generyczny JSON + HMAC)",
    googleCalendarGenericJson: "Google Calendar (generyczny JSON)",
    confluenceGenericJson: "Confluence (generyczny JSON)",
    crmPartnerLeadsConsents: "Partner CRM (leady + zgody)",
    pasteSlackIncomingWebhookUrl:
      "Wklej URL Slack Incoming Webhook (https://hooks.slack.com/services/…). Zdarzenia są renderowane jako wiadomości Block Kit - podpis HMAC nie jest wysyłany.",
    urlApiBaseUsuallyHttps:
      "URL to baza API (zwykle https://api.hubapi.com). Zdarzenia leadów i newslettera trafiają jako upsert kontaktu po e-mailu; pozostałe zdarzenia są pomijane. W polu sekretu ustaw token prywatnej aplikacji HubSpot (Bearer).",
    crmPartnerEndpointLeadEvents:
      "Endpoint partnera CRM: zdarzenia leadów są wysyłane jako snapshot leada ze zmapowanymi zgodami. Etapy, mapowanie zgód i tryb uwierzytelnienia konfigurujesz w CRM → Integracje.",
    receiverGetsFullEventEnvelope:
      "Odbiorca dostaje pełną kopertę zdarzenia jako JSON POST; przy ustawionym sekrecie payload jest podpisany HMAC-SHA256 (x-nes-signature).",
    saved: "Zapisano",
    endpointRemoved: "Usunięto endpoint",
    outgoingIntegrations: "Integracje wychodzące",
    webhookEndpointsReceivingDomainEvents:
      "Endpointy webhook, do których platforma wysyła zdarzenia domenowe (publikacja wpisu, kampania newsletter, formularz kontaktowy itp.). Podpis HMAC-SHA256 w nagłówku x-nes-signature, sekret w Supabase Vault - nigdy nie jest zwracany do przeglądarki.",
    runDispatcher: "Uruchom dispatcher",
    newEndpoint: "Nowy endpoint",
    delivered: "Dostarczone",
    pending: "W kolejce",
    failed: "Nieudane",
    dead: "Martwe",
    endpoints: "Endpointy",
    loading: "Ładowanie…",
    endpointsYetAddOneStart: "Brak endpointów. Dodaj pierwszy, żeby zacząć wysyłać webhooki.",
    secretSet: "Sekret ustawiony",
    secret: "Brak sekretu",
    allEvents: "wszystkie zdarzenia",
    enabled: "Aktywny",
    disabled: "Wyłączony",
    edit: "Edytuj",
    delete: "Usuń",
    editEndpoint: "Edytuj endpoint",
    urlMustUseHttpsSsrf:
      "Adres URL musi używać HTTPS. Guard SSRF odrzuca adresy prywatne (127.0.0.1, 10.x, metadata cloud itp.).",
    name: "Nazwa",
    eGZapierNewCampaigns: "np. Zapier - nowe kampanie",
    formatAdapter: "Format / adapter",
    eventsCommaSpaceSeparated: "Zdarzenia (oddzielone przecinkiem lub spacją)",
    emptyEveryEventTenant: "Puste = wszystkie zdarzenia tego tenanta.",
    accessTokenBearer: "Token dostępu (Bearer)",
    hmacSigningSecret: "Sekret podpisu HMAC",
    hubspotPrivateAppTokenLives:
      "Token prywatnej aplikacji HubSpot trzymamy w Vault - nigdy nie wraca do przeglądarki. Bez tokenu dostawy do HubSpota kończą się błędem konfiguracji.",
    newSecret16Chars: "Nowy sekret (min. 16 znaków)",
    clearSecretWebhookSendsUnsigned:
      "Wyczyść sekret (webhook wysyła bez podpisu; HubSpot przestaje dostarczać)",
    cancel: "Anuluj",
    save: "Zapisz",
  },
};

const en = {
  adminIntegrations: {
    error: "Error: {{message}}",
    dispatcherError: "Dispatcher error: {{message}}",
    dispatchSummary: "Delivered: {{delivered}}, failed: {{failed}}, claimed: {{claimed}}",
    disabledEndpointSkipped:
      'A disabled endpoint is skipped by the dispatcher (delivery finishes with reason "endpoint disabled", no retry).',
    confirmDeleteEndpoint:
      'Delete endpoint "{{name}}"? New deliveries for this endpoint will stop.',
    secretLivesInVault:
      'Secret lives in Vault - the platform never returns it to the browser. Type a new value to set or rotate it; tick "clear" to remove signing.',
    webhookGenericJsonHmac: "Webhook (generic JSON + HMAC)",
    googleCalendarGenericJson: "Google Calendar (generic JSON)",
    confluenceGenericJson: "Confluence (generic JSON)",
    crmPartnerLeadsConsents: "CRM partner (leads + consents)",
    pasteSlackIncomingWebhookUrl:
      "Paste a Slack Incoming Webhook URL (https://hooks.slack.com/services/…). Events are rendered as Block Kit messages - no HMAC signature is sent.",
    urlApiBaseUsuallyHttps:
      "URL is the API base (usually https://api.hubapi.com). Lead and newsletter events are upserted as contacts by e-mail; other events are skipped. Set the HubSpot private app token (Bearer) in the secret field.",
    crmPartnerEndpointLeadEvents:
      "CRM partner endpoint: lead events are delivered as a lead snapshot with mapped consents. Stages, consent mapping and auth mode are configured in CRM → Integrations.",
    receiverGetsFullEventEnvelope:
      "The receiver gets the full event envelope as a JSON POST; with a secret set the payload is signed with HMAC-SHA256 (x-nes-signature).",
    saved: "Saved",
    endpointRemoved: "Endpoint removed",
    outgoingIntegrations: "Outgoing integrations",
    webhookEndpointsReceivingDomainEvents:
      "Webhook endpoints receiving domain events (post published, newsletter campaign, contact form, etc.). Payload signed with HMAC-SHA256 in header x-nes-signature; secret lives in Supabase Vault and is never returned to the browser.",
    runDispatcher: "Run dispatcher",
    newEndpoint: "New endpoint",
    delivered: "Delivered",
    pending: "Pending",
    failed: "Failed",
    dead: "Dead",
    endpoints: "Endpoints",
    loading: "Loading…",
    endpointsYetAddOneStart: "No endpoints yet. Add one to start delivering webhooks.",
    secretSet: "Secret set",
    secret: "No secret",
    allEvents: "all events",
    enabled: "Enabled",
    disabled: "Disabled",
    edit: "Edit",
    delete: "Delete",
    editEndpoint: "Edit endpoint",
    urlMustUseHttpsSsrf:
      "URL must use HTTPS. The SSRF guard rejects private targets (127.0.0.1, 10.x, cloud metadata, etc.).",
    name: "Name",
    eGZapierNewCampaigns: "e.g. Zapier - new campaigns",
    formatAdapter: "Format / adapter",
    eventsCommaSpaceSeparated: "Events (comma or space separated)",
    emptyEveryEventTenant: "Empty = every event of this tenant.",
    accessTokenBearer: "Access token (Bearer)",
    hmacSigningSecret: "HMAC signing secret",
    hubspotPrivateAppTokenLives:
      "The HubSpot private app token lives in Vault - it is never returned to the browser. Without it, HubSpot deliveries fail as a configuration error.",
    newSecret16Chars: "New secret (16+ chars)",
    clearSecretWebhookSendsUnsigned:
      "Clear secret (webhook sends unsigned; HubSpot stops delivering)",
    cancel: "Cancel",
    save: "Save",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
