# Pakiet I9d-5 – treść zgody marketingowej i pomiar otwarć/kliknięć tylko za zgodą (I9d-Y2, EDPB 2/2023)

Stan: gałąź PR #530 (`4b1aa96d3`). Tylko odczyt. Zadanie źródłowe:
`docs/PROMPT_KONTYNUACJI_HUB_2026-10-20.md` §8.2 (linie 550-584), zasady §4 (110-185),
procedura §5 (211-268). Y2 idzie PO S7 i PO Y1 (ten sam blok I9).

---

## 1. Decyzja właściciela (skrót §8.2) i tło w dzienniku

- Uzupełnić DOMYŚLNĄ treść zgody PL/EN o: (a) wiadomości mogą zawierać elementy mierzące
  otwarcia i kliknięcia, (b) cel (dopasowanie treści i częstotliwości, statystyka),
  (c) zgodę można wycofać w każdej chwili (link). **Jedno źródło** tekstu domyślnego.
  Tekstów admina NIE nadpisywać (aktualizacja tylko, gdy zapisany == stary domyślny);
  ostrzeżenie w panelu, gdy własny tekst nie wspomina o pomiarze. Akapit w polityce.
- Wersja treści przy KAŻDEJ zgodzie; wersja „z pomiarem”. Piksel i spersonalizowane linki
  (ścieżki + kampanie) TYLKO dla odbiorców ze zgodą obejmującą pomiar ORAZ przy włączonym
  przełączniku najemcy; reszta bez piksela, linki bez identyfikatora odbiorcy.
  Dymek w statystykach. Z-I9c-09: wspólny przełącznik dla ścieżek i kampanii.
- Opcjonalnie: „Poproś o zgodę na pomiar” – jednorazowy mail (podgląd liczby, potwierdzenie,
  treść PL/EN edytowalna, link z podpisanym tokenem aktualizującym wersję).
- Rejestr czynności + dziennik „21.x Treść zgody i pomiar (I9d-Y2)”; rekomendację EDPB
  w §21.21 oznaczyć jako wykonaną. Testy: vitest, pgTAP, RTL/axe.

Dziennik `docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md`:
- §21.21 (od linii 3753), pkt 5 „Pomiar otwarć (piksel)” ≈ linie 3849-3864: przełącznik
  `journey_settings.open_tracking_enabled` (domyślnie WŁĄCZONY), tylko ścieżki, tylko piksel
  (kliknięcia bez zmian), **„Rekomendacja dla administratora danych: uzupełnić treść zgody…
  albo przenieść pomiar otwarć pod zgodę - EDPB 2/2023”** ← to oznaczyć „Wykonane (I9d-Y2, §21.x)”.
- Tabela zgłoszeń I9c (≈3878-3889): **Z-I9c-09** (wspólny przełącznik + rekomendacja treści),
  Z-I9c-05 (czytelnicy surowych zdarzeń kampanii), Z-I9c-08 (wygaszanie – Y1).
- §20 S5 (2172-2495): tracking 1:1 `jm:`/`ju:` (≈2240), Z-S5-04 (wspólny pomocnik wycofania
  zgody, ≈2335), Z-S5-06 (Apple MPP: otwarcia ludzkie i CTOR to górna granica – dymek, ≈2337).
- Migracje X2 i bliźniaki: tabela ≈3893-3900; „Następny wolny numer: 0373, wersja 20261020161500”
  (ale patrz §10 – S7 i Y1 zajmą numery wcześniej).

`docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md`: §4 „Ścieżki e-mail” (148-160; wiersz „Okres
przechowywania” l.158 kończy się zdaniem o braku informacji o pomiarze), §5 CRM (161-173,
„zgody (treść, wersja, IP, UA)” l.169), wyjątki (187-196, `crm_consent_log` l.194),
„Zgłoszenia do IOD” – punkt **„Rekomendacja (pomiar otwarć)”** l.216-221 → zamknąć.

---

## 2. Inwentarz miejsc zgody marketingowej/newslettera (tekst → zapis → dowód)

Legenda: **[D]** domyślny tekst w kodzie, **[A]** tekst edytowalny przez admina (gdzie zapisany),
**[Z]** jaki tekst trafia do `consents`/rejestru, **[W]** wersja.

| # | Miejsce | Tekst domyślny / źródło | Zapis zgody | Uwagi / pułapki |
|---|---|---|---|---|
| 1 | `src/components/NewsletterForm.tsx` (widget inline) | wyświetla `policy_html` (l.327, 574-579 `dangerouslySetInnerHTML` + `sanitizeHtml`); do zapisu `pickLocalized(s,"policy_html",lang) \|\| t("newsletterForm.consentDefault")` (l.263-264) | `subscribeToNewsletter` `consents:[{key:"newsletter",text,given:true,lang}]` (l.298) | **[W] brak** (`version` nie wysyłane). Brak checkboxa – zgoda = klik „Zapisz”. Pola `custom_*` typu checkbox → `ConsentCheckboxField` (l.695-730) tylko do `custom`, nie do `consents` |
| 2 | `src/lib/i18n-public.ts` `newsletterForm.consentDefault` | PL l.29-30 „Wyrażam zgodę na otrzymywanie newslettera i przetwarzanie mojego adresu e-mail w tym celu.”, EN l.141-142 | – | fallback, gdy `policy_html` puste |
| 3 | `newsletter_settings.policy_html_pl/_en` **[A]** | DEFAULT SQL `20260601054247_…sql:134-135` „Zapisując się akceptujesz <a href="/polityka-prywatnosci">Politykę prywatności</a>. Możesz wypisać się w każdej chwili.” / EN `…<a href="/privacy-policy">…` ; lustro TS `src/hooks/useNewsletterSettings.ts:119-122` (`defaultNewsletterSettings`) | j.w. | **KOPIA** domyślnego tekstu SQL↔TS. EN link `/privacy-policy` – brak trasy w `src/routes` (jest tylko `polityka-prywatnosci.tsx`) – zweryfikować |
| 4 | Builder newslettera (inline/popup doc) `newsletter_settings.inline_doc/popup_doc` jsonb **[A]**; trasy `admin.newsletter.inline.tsx`/`popup.tsx` → `NewsletterBuilder` | `docSeedFromSettings` (`src/components/admin/newsletter/builder/builderDoc.ts:402-439`) kopiuje `policy_html` do akapitu (`src/lib/newsletter-builder/defaults.ts:231-235`) | `src/components/newsletter/NewsletterDocRenderer.tsx:202-208` dokłada `{key:"newsletter", text: policy_html \|\| "Wyrazam zgode na otrzymywanie newslettera."}` (+ checkboxy `field.checkbox` → `{key:w.key,text:w.html}` l.185) | **trzeci fallback** (bez polskich znaków!) l.205-206. Tekst akapitu w dokumencie jest kopią – zmiana `policy_html` go nie aktualizuje |
| 5 | Popup rejestracji (`src/components/PopupSignupForm.tsx`) | `newsletter_optin` label z `popup_fields` jsonb **[A]**; default `src/lib/newsletter/popupFields.ts:134-139` „Chcę otrzymywać newsletter” / „I want to receive the newsletter”; prywatność `popup_privacy_html_*` **[A]** (kolumny `20260804124634_…:12-13`, edycja `src/components/admin/popups/signup/ConsentsTab.tsx`) z fallbackiem `policy_html` (l.136-138) | `snapshotConsents` (l.287-307) → `signup_consents` w metadanych + `subscribe({consents})` (l.340-349) | **JEDYNE miejsce z wersją**: `src/lib/newsletter/consentSnapshot.ts` – `version = "sha256:"+24 hex` z `JSON.stringify([key,lang,text])` (mieści się w `max(32)`) |
| 6 | `src/components/interests/JoinUsForm.tsx` (widget „Dołącz”) | wyświetla `consentText \|\| t("joinUs.consent")` (l.582; plain text, l.931-934); `src/lib/i18n-interests.ts:42` PL „Zapisując się akceptujesz politykę prywatności. W każdej chwili możesz się wypisać.”, l.87 EN; builder `consentText` (`src/lib/builder/schemas.ts:3133`) **[A]** | `subscribe({consents:[{key:"newsletter", text: nlText}]})` l.481 gdzie **nlText jest zahardkodowany** l.410-414 „Zapisuję się do newslettera i akceptuję otrzymywanie wiadomości marketingowych.” + dla zalogowanego `setMyConsent({key:"marketing_email", version: MARKETING_CONSENT_VERSION})` l.539-551 (rejestr `user_consents`) | **ROZJAZD: wyświetlony ≠ zapisany** (art. 7 ust. 1). `MARKETING_CONSENT_VERSION` z `src/lib/notifications/consentCatalog.ts:37` (`marketing_email` "1.0") |
| 7 | `src/components/blocks/AuthFormBlocks.tsx` (widget rejestracji) + edytor `src/components/admin/blocks/edit/RegisterForm.tsx` (l.40-45, 101-102) | checkbox newslettera `t("authForms.newsletterOptIn")` – `src/lib/i18n-public-auth.ts:42` „Chcę otrzymywać newsletter” / l.97; builder `newsletterLabel` (`schemas.ts:4050`) **[A]**; zgoda RODO `consentDefault` l.45/100 (regulamin – nie marketing) | `buildSignupMetadata` (`src/lib/auth/registrationFields.ts:88-123`) → `marketing_opt_in: true/false` w metadanych `signUp` (l.857) | **Brak zapisu do newslettera i brak wpisu w rejestrze zgód** – `marketing_opt_in` czyta tylko emiter `account.registered.v1` (`20261020120000:77`). Tekst nigdzie nie logowany |
| 8 | `src/components/clubs/organisms/ClubAccessGate.tsx:331,399,541-545` | `t("clubGate.newsletterOptIn")` `src/lib/i18n-club-gate.ts:72/147` | j.w. (`newsletterOptIn` → `marketing_opt_in`) | jak #7 |
| 9 | `src/components/blocks/ContactFormView.tsx` (formularz kontaktu) | lokalny słownik `T` l.58-91: `newsletter` „Zapisz mnie do newslettera” (l.68/84); builder defaults `src/lib/builder/registry.tsx:2352-2353` (`newsletterLabel_*`, `showNewsletterOptIn:false`) **[A]**; `consentText_*` (RODO zapytania) `registry.tsx:697-700, 2331-2334` | `consents.push({key:"newsletter", text:newsletterLabel})` l.302-304 → `contact.functions.ts` (`consents` l.370) → wyzwalacz `contact_messages_to_lead` (najnowsza def. `20261012180900`, l.~281-293 loguje `version` z ładunku) | Subskrybent tworzony w `src/lib/contact.functions.ts:470-510` **bez `consents`** → `newsletter_to_lead` loguje **fallback** „Zapisuję się do newslettera i akceptuję…” (drugi wpis, inny tekst) |
| 10 | Checkout premium | `src/lib/billing/premiumNewsletter.ts:40-50` `PREMIUM_NEWSLETTER_CONSENT_TEXTS["2026-10-12"]` + `PREMIUM_NEWSLETTER_CONSENT_VERSION`; i18n czyta rejestr (`src/lib/i18n-profile.ts:805,1679`) | `src/lib/billing/purchaseEffects.server.ts:594-660` (`insertCheckoutConsentLog`, `ensureCheckoutConsentLogged`) – bezpośredni INSERT do `crm_consent_log` z `consent_version` | **WZORZEC do reużycia** (rejestr wersji, „wersji wydanej nie zmienia się”, i18n = rejestr) |
| 11 | Wydarzenia: `src/components/events/registration/PublicRegistrationForm.tsx:768`, `PackageInviteAccept.tsx:560-562`; CFP `src/components/events/cfp/organisms/CfpSubmitPage.tsx:18-26, 355-375` | `eventRegistration.consents.marketing` – `src/lib/i18n-event-registration.ts:63` „Chcę otrzymywać informacje o kolejnych wydarzeniach.” / l.735; **globalna tabela** `event_consent_texts` (`20261012130600:76-101`, ziarno l.179-186, PK `(purpose,version,lang)`, CHECK `purpose IN (data_processing,marketing,partner_sharing)`, `lang IN (pl,en)`, `body` 10-2000, `body_sha256` GENERATED, `retired_at`, unikalny aktywny `(purpose,lang) WHERE retired_at IS NULL`) | księga `event_consent_records` → most CRM `20261012130800:343-360` wpis `crm_consent_log` `consent_key='marketing'`, `consent_version = format('event-marketing-v%s-%s', text_version, lang)` | Bramka **`src/lib/events/__tests__/eventConsentTexts.gate.test.ts`**: zmiana napisu i18n wymaga nowej wersji w migracji + `EVENT_CONSENT_TEXT_VERSION` (`src/lib/events/consentTexts.ts:21`, dziś `1`). Nowa wersja: najpierw `retired_at` starej, potem INSERT |
| 12 | Wyzwalacz `newsletter_to_lead` (najnowsza def. **`20260708151417_1568b817-…sql:61-119`**) | fallback SQL l.112 „Zapisuję się do newslettera i akceptuję otrzymywanie wiadomości marketingowych.” (gdy `consents` puste) | loguje `consents[]` (`version` z ładunku, l.96) | Wyzwalacz `trg_newsletter_to_lead AFTER INSERT OR UPDATE OF status` (`20260630053403:275`) i loguje tylko przy INSERT albo zmianie statusu na `'confirmed'` (l.80) – **zmiana samych `consents` przy UPDATE NIE trafia do rejestru** |
| 13 | Popup newslettera (doc popup) | #4 | #4 | `PopupPreview.tsx:86` (podgląd w panelu) |

Inne napisy „zgody” poza zakresem marketingu (nie zmieniać treści): `authForms.consentDefault`
(regulamin), `consentText_*` formularza kontaktowego (RODO zapytania), `privacy`/`terms` popupu,
`data_processing`/`partner_sharing` wydarzeń, `cookies`.

**Formaty renderu są trzy** (ważne dla „jednego źródła”): HTML (`policy_html`, popup – `sanitizeHtml`),
markdown-link `[tekst](url)` (`ContactFormView.tsx:98`, `AuthFormBlocks.tsx:270-300`), czysty tekst
(JoinUs l.931, etykiety pól popupu, i18n checkboxów). Link „wycofanie w każdej chwili” musi mieć
adapter na każdy format.

**Gdzie admin trzyma własne teksty [A]** (nie nadpisywać): `newsletter_settings.policy_html_*`,
`popup_privacy_html_*`, `popup_fields[newsletter_optin].label_*`, `inline_doc`/`popup_doc`
(akapity/checkboxy), CMS builder: `pages.builder_data`, `builder_global_widgets`,
`builder_popups`, `builder_templates`, `builder_revisions` (props `consentText_*`, `newsletterLabel_*`
– domyślne z `registry.tsx` są KOPIOWANE do treści strony przy wstawieniu widgetu).

---

## 3. Polityka w kodzie

- `src/lib/legal/content/communications.ts` (dokument `communications`, trasa
  `/komunikacja-i-marketing` – `src/lib/legal/documentIndex.ts:75-81`): sekcja `id:"pomiar"`
  PL l.92-101 („Pomiar skuteczności wysyłki” – już opisuje znacznik graficzny i przekierowanie,
  cel: jakość wysyłki i reputacja), EN l.211-220. Sekcja zgód l.47-60/166-178:
  **l.55/174 „Zmiana treści zgody podbija jej wersję i wymaga nowej decyzji”**, **l.57/176
  „Nie stosujemy … zgód pakietowych - każda zgoda ma osobne pole i osobną treść”** (patrz ryzyka).
  Sekcja `rezygnacja` (l.62) – cel linku „wycofaj”. Data: `COMPLIANCE_PACK_UPDATED = "2026-09-14"`
  (`src/lib/legal/registration.ts:40`).
- `src/lib/legal/content/privacy.ts:37,53,87` (PL) / 162,178,210 (EN) – newsletter, podstawa art. 6.1.a.
- **Pułapka:** wersja opublikowana w bazie (`legal_document_versions`, `src/lib/legal/versions.ts`)
  ma pierwszeństwo nad kodem (`pickLegalCopy`, `src/lib/legal/resolve.ts:34-40`) – zmiana
  w kodzie nie pokaże się, jeśli admin opublikował własną wersję. Nagłówek migracji
  `20261020161300` (l.9-10) błędnie wskazuje „`/rodo`” – faktyczna sekcja jest w
  `/komunikacja-i-marketing#pomiar`.
- Testy: `src/lib/legal/__tests__/{legalContent,documentIndex}.test.ts`, `legalVersions.test.tsx`.

---

## 4. Dziennik zgód `crm_consent_log`

Definicja `20260630053403_8783ac8b-…sql:33-52`:
`id uuid PK`, `tenant_id uuid NOT NULL DEFAULT public_tenant_id()`, `email text NOT NULL`,
`source_type crm_source_type NOT NULL` (ENUM `contact_form,newsletter,comment,webinar,import,other`
+ `'event'` od `20260926085900`), `source_id uuid`, `form_id text`, `form_name text`,
`consent_key text NOT NULL`, `consent_text text NOT NULL`, **`consent_version text` (NULL, bez CHECK)**,
`given boolean NOT NULL`, `ip text`, `user_agent text`, `lang text`, `created_at timestamptz NOT NULL`.
Indeksy `(tenant_id, lower(email), created_at DESC)`, `(source_type, source_id)`.
ACL: od `20260730130000`/`20260730135929` – INSERT tylko service_role/definer; SELECT staff
(polityka „Staff read consent log”: admin/editor w `current_tenant_id()`); REPLICA IDENTITY FULL.
Kontrakt TS: `src/lib/crm/consentLog.ts` (`CONSENT_LOG_TIMELINE_COLUMNS`).

Klucze w użyciu: `newsletter` (formularze), `marketing` (wydarzenia, wycofania: personel
`crm_leads_marketing_consent_withdraw` `20261012180900:~380-400`, wypis ścieżki
`_journey_unsubscribe` `20261020140500:~239`, `email_unsubscribe_by_token` `20261012180900`),
`newsletter_premium`, `rodo`, `privacy`, `terms`, klucze `field.checkbox` dokumentu.
**Pisarze:** `newsletter_to_lead` (#12), `contact_messages_to_lead` (`20261012180900`),
most wydarzeń (`20261012130800`), `purchaseEffects.server.ts`, retencja (`20261020161100:422-429,
660-694` – łańcuch per **(adres, consent_key)**, wpis wygaśnięcia `source_type='other'`; działa
dla dowolnego nowego klucza), RODO konta.
**Czytelnik zgody marketingowej ścieżek:** `_journey_marketing_consent(p_tenant, p_lead) RETURNS text`
(`20261020140200:95-133`, jedyna def., SECURITY DEFINER, REVOKE od PUBLIC/anon/authenticated/service_role):
subskrybent `unsubscribed` → `unsubscribed`; ostatni `crm_consent_log.consent_key='marketing'`
`given=false` → `no_consent`; `ok` gdy `crm_leads.marketing_consent` albo sub `confirmed` albo
(`subscribed` i `double_opt_in=false`).

**Wersja treści dziś:** tylko popup (sha256), premium (data), wydarzenia (`event-marketing-v1-pl`).
NewsletterForm/JoinUs/Contact/DocRenderer – `consent_version` NULL. `ConsentEntry.version`
`max(32)` w `src/lib/newsletter.functions.ts:21-29` i `src/lib/contact.functions.ts:30`.

Drugi rejestr: `user_consents` (zalogowani; `set_user_consent(s)` RPC, `src/lib/consents.functions.ts`),
katalog `src/lib/notifications/consentCatalog.ts` (`marketing_email` "1.0").

---

## 5. Render i tracking – ścieżki (S5)

- `src/lib/journeys/render.server.ts` (230 l.): `JourneyRenderInput` l.38-55 (`messageId: string|null`,
  `unsubscribeUrl`, `openTracking?: boolean` – I9c-X2); `journeyClickUrl` l.78-90 (`/api/public/nl-click?m=<token jm:>&i=&u=&k=`),
  `journeyPixelUrl` l.92-96, `journeyUnsubscribeUrl` l.99-103; `renderJourneyEmail` l.188-230:
  przepisanie linków **zawsze, gdy `messageId`** (l.200-207), stopka wypisu l.215-217 (po przepisaniu),
  piksel l.218-221 `messageId && input.openTracking !== false`.
  → Y2: osobna flaga „spersonalizowane linki” (np. `measurement: boolean`) – bez zgody: brak
  piksela i linki NIEprzepisane (wypis RFC 8058 bez zmian – nie jest trackingiem).
- Runner: `src/lib/server/journeysRunner.server.ts:370-387` – `openTracking: c.open_tracking !== false`
  (pole z `journey_contact_for_send`); `complete(...)` l.250-275 woła `journey_complete_email_step`
  z `p_detail` (miejsce na zapis „mierzone/niemierzone”, jeśli potrzebny mianownik).
- `src/lib/journeys/tracking.server.ts` (66 l.): `recordJourneyMessageEvent` → RPC
  `journey_record_message_event`; `isMailProxyUserAgent`.
- SQL (najnowsze definicje → `-- CIALO-Z`):
  - `journey_contact_for_send(p_enrollment_id uuid, p_node_id text) RETURNS jsonb` – **`20261020161300`**
    (def. l.105-208, `'open_tracking', COALESCE(v_settings.open_tracking_enabled, true)` l.201; ma
    `v_lead.email_norm`, `v_def.category`, `v_e.tenant_id`); granty: REVOKE PUBLIC/anon/authenticated, GRANT service_role.
  - `journey_record_message_event(p_message_id text, p_kind text, p_link_index int DEFAULT -1, p_url text DEFAULT NULL, p_machine boolean DEFAULT false) RETURNS jsonb`
    – **`20261020161300`** (l.38-~96; precedens odmowy `{'recorded':false,'reason':'open_tracking_disabled'}`).
  - `admin_journey_settings_get()` / `admin_journey_settings_save(p_patch jsonb, …)` – **`20261020161300`**
    (klucz `open_tracking_enabled`, `22023 open_tracking_enabled_invalid`); GRANT authenticated, service_role.
  - `journey_complete_email_step(p_enrollment_id uuid, p_lock_token uuid, p_node_id text, p_result text, p_message_id text DEFAULT NULL, p_variant text DEFAULT NULL, p_locale text DEFAULT NULL, p_detail jsonb DEFAULT '{}')`
    – jedyna def. `20261020140500:89` (INSERT do `journey_messages` l.133).
  - `_journey_marketing_consent` – `20261020140200` (j.w.).
  - Predykaty `email_opened`/`email_clicked` (`_journey_eval_predicate`, `20261020140200:177-195`;
    walidacja przodka l.689) – używa ich szablon **`src/lib/journeys/templates/newsletter_welcome.ts:30-36`**
    (gałąź „engaged”).
- Kolumna `journey_settings.open_tracking_enabled boolean NOT NULL` (dodana w `20261020161000`,
  `lock_timeout`); brak wiersza = włączone. Tabela `journey_messages` (bez kolumny „tracked”):
  `enrollment_id, journey_id, lead_id, locale, message_id, node_id, queued_at, tenant_id, variant, version_id`.
- Czytelnicy przełącznika w TS: `src/lib/journeys/parse.ts:262-263` (`openTrackingEnabled`, brak =
  true), `dto.ts:99`, `journeys.functions.ts:486` (zod patch), `src/lib/privacy/dataRetentionParse.ts:56,245`,
  `src/lib/privacy/dataRetentionQueries.ts:115-140` (`useSaveOpenTracking` → `saveJourneySettings`,
  inwaliduje `dataRetentionKeys.tenant` i `journeyKeys.settings`), UI
  `src/components/admin/settings/dataRetention/DataRetentionCard.tsx:324-345` (region „pixel”),
  S8 (gałąź `hub/s8-sciezki-panel-c`): `src/components/admin/journeys/list/JourneySettingsDialog.tsx:171-245,554-559`
  (`adminJourneys.engineSettings.openTracking[Hint]`).
- i18n karty: `src/lib/i18n-admin-data-retention.ts:257-265` (PL `pixel.title/label/hint/recommendation`),
  l.512-520 (EN) – prefiks `adminDataRetention` jest pod twardą bramką parytetu.

## 6. Render i tracking – kampanie newslettera

- `src/lib/newsletter/renderCampaign.server.ts:25-87` `renderCampaignHtml(rawHtml, vars, lang, unsubscribeUrl, tracking|null)`:
  `tracking` → `rewriteTrackingLinks` + `trackingPixelImg` (z `src/lib/newsletter/tracking.ts:44-88`).
  **Nie zmieniać ciała** – `src/lib/newsletter/__tests__/renderCampaign.server.test.ts` przypina 48
  skrótów SHA-256. Bramkę robić u WOŁAJĄCEGO: `tracking = null` dla odbiorcy bez zgody (wynik
  identyczny jak wysyłka testowa – linki bez identyfikatora, bez piksela).
- Wysyłka: `src/lib/newsletter-campaigns.functions.ts` `runCampaignSend` (l.1223…): select
  subskrybentów l.1249-1258 (`id, email, first_name, last_name, language, unsubscribe_token[, meta]`),
  render l.1486-1503 (`signTrackingToken(camp.id, sub.id)`, `signTrackingLink`), `sendEmail({… tags:{tenant,campaign,subscriber}})`
  l.1504-1511, postęp `sent_count/failed_count` l.1545-1550. Wysyłka testowa `sendCampaignTest` l.787 (bez trackingu).
- Tokeny: `src/lib/newsletter/trackingToken.server.ts` – kampanie `signTrackingToken`/`verifyTrackingToken`
  (l.47-68), `signTrackingLink`/`verifyTrackingLink` (l.77-98); ścieżki `jm:`/`ju:` (l.106-181);
  sekret `SESSION_SECRET || SUPABASE_SERVICE_ROLE_KEY`; podpis 32 hex, `constantTimeEqual`.
- Trasy publiczne: `src/routes/api/public/nl-open.ts` (gałąź `m=` l.50-57, `c=`/`s=` l.59-72,
  zawsze GIF), `nl-click.ts` (gałąź `m` l.44-66 ma pierwszeństwo, kampania l.68-100, zawsze 302;
  bez ważnego podpisu → `url.origin`). Test: `src/routes/api/public/-nl-tracking.test.ts`.
- Zapis: `src/lib/newsletter/trackingEvents.server.ts` → RPC `newsletter_record_campaign_event(p_campaign uuid, p_subscriber uuid, p_kind text, p_url text DEFAULT NULL, p_occurred_at timestamptz DEFAULT NULL) RETURNS jsonb`
  – najnowsza def. **`20260814215302_cd43e60c-…sql:53-121`** (service_role; odrzuca `unknown_subscriber`
  → **anonimowe liczenie kliknięć wymagałoby redefinicji**; `ON CONFLICT … WHERE subscriber_id IS NOT NULL`).
  `newsletter_campaign_events.subscriber_id` jest NULL-owalne.
- Źródło zaangażowania: `src/lib/newsletter/engagementSource.ts` – **zmienna środowiskowa**
  `NEWSLETTER_ENGAGEMENT_SOURCE` (`first_party` domyślnie | `provider`), nie ustawienie najemcy;
  w trybie `provider` piksel/linki wstawia dostawca (Resend) dla WSZYSTKICH odbiorców – nie da się
  bramkować per odbiorca (`src/routes/api/public/webhooks.resend.ts`, `i18n-newsletter-deliverability.ts:197`).
- Statystyki: `newsletter_campaign_engagement(p_campaign uuid) RETURNS TABLE(opens, clicks, unique_openers, unique_clickers bigint)`
  – najnowsza **`20261020161200:435-487`** (właściciel I9, `HUB_CIALO_Z` = `20260814215302`);
  dodanie kolumny wyniku = DROP + CREATE (OUT-y). Server fn `getCampaignEngagement` l.649-663.
  UI: `src/components/admin/newsletter/molecules/CampaignEngagementCard.tsx` (mianownik
  `delivered = campaign.sent_count`, `src/routes/admin.newsletter.campaigns.$id.tsx:701-704`;
  hint `adminNewsletter.campaigns.engagementHint` `src/lib/i18n-newsletter-admin.ts:64/353`).

## 7. Gdzie dodać dymek „tylko odbiorcy ze zgodą na pomiar”

1. `CampaignEngagementCard.tsx` (hint/`MetricTooltip`) – klucze `adminNewsletter.campaigns.*`.
2. Statystyki ścieżek – panel S8.2 (jeszcze niezrobiony; `admin_journey_stats` przez
   `src/lib/journeys/stats.functions.ts`, `queries.ts`) – klucze `adminJourneys.*`; połączyć z Z-S5-06 (MPP).
3. Kokpit `src/components/admin/dashboard/MarketingPanel.tsx:93,189` (`adminDashboard.marketing.openRate`
   – prefiks pod twardą bramką).
4. Rejestr wskaźników `src/lib/analytics/semantic/metrics.ts` – `email_open_rate` (l.1795), CTOR (l.~615-637),
   `journey_open_rate`/`journey_click_rate` (l.2011…) – pola definicji/uwagi PL/EN (czyta je
   `MetricTooltip`/`MetricExplainer`: `src/components/charts/MetricTooltip.tsx`,
   `src/components/admin/analytics/semantic/molecules/MetricExplainer.tsx`); test `registry.test.ts`.
5. Karta retencji (region „pixel”) – zmiana opisu przełącznika na „ścieżki i kampanie”.

---

## 8. Mechanizmy do reużycia

- **Rejestr wersji treści zgody:** `src/lib/billing/premiumNewsletter.ts:31-78` (stały rekord
  wersja → `{pl,en}`, „wersji wydanej nie zmienia się”, i18n czyta rejestr – `i18n-profile.ts:805`).
- **Lustro TS↔SQL z bramką vitest:** `event_consent_texts` + `eventConsentTexts.gate.test.ts`
  (parsuje ziarna z migracji, wymusza zgodność i18n = ziarno bieżącej wersji).
- **Skrót treści jako wersja:** `src/lib/newsletter/consentSnapshot.ts` (`sha256:` 24 hex) – można
  liczyć też na serwerze, gdy klient nie poda `version`.
- **Dopisanie wpisu rejestru dla istniejącego wiersza** (wyzwalacz nie łapie): `ensureCheckoutConsentLogged`
  (`purchaseEffects.server.ts:620-660`, idempotentny odczyt przed INSERT).
- **Tokeny podpisane z domeną:** `trackingToken.server.ts` (`jm:`/`ju:`) – dla „Poproś o zgodę na
  pomiar” nowa domena (np. `nm:`); jednorazowość wg `event_consent_confirmations`
  (`20261012130600:191…`: w bazie tylko sha256 tokenu, 7 dni, jeden otwarty na osobę, tylko service_role).
  Y1 (wygaszanie) potrzebuje takiego samego tokenu („Chcę dalej otrzymywać”) – wspólny pomocnik.
- **Edytowalna treść maila PL/EN:** `src/lib/email/txOverrides.ts` (`EDITABLE_TX_TYPES` l.24-28,
  `tx_email_overrides`), panel `src/components/admin/newsletter/system-emails/TxEmailContentPanel.tsx`,
  podgląd `src/lib/email/tx-preview.server.ts`; kategoria listy wyłączeń `src/lib/email/suppressionPolicy.ts`
  (`newsletter_confirmed: "bulk"` l.200); kolejka `enqueueRawEmail`/`sendTxEmail`
  (`src/lib/email/transactional.server.ts:297,473`).
- **Wspólne atomy UI:** `Switch`/`Label` (karta retencji), `FormSelect`, `MetricTooltip`, `AdminMetricTile`,
  `Checkbox` (formularze publiczne).
- **Precedens odmowy zapisu zdarzenia:** `open_tracking_disabled` w `journey_record_message_event`.

---

## 9. Bramki i rejestry, które dotkniesz

- `src/lib/ci/hubDelivery.ts`: `FUNCTION_TABLE` (l.102-313; nowe funkcje `[name,"I9",kind]`),
  `HUB_CIALO_Z` (l.339-357; pierwsza redefinicja funkcji sprzed huba, np.
  `newsletter_to_lead: "20260708151417"`, `newsletter_record_campaign_event: "20260814215302"`),
  `HUB_I9_REDEFINITIONS` (l.369-387; funkcje innych wycinków – **wartość = najnowsza definicja w hubie**,
  dla redefinicji po X2: `journey_contact_for_send` i `journey_record_message_event` →
  **`20261020161300`**, `admin_journey_settings_get/save` → `20261020161300`,
  `journey_complete_email_step` → `20261020140500`, `_journey_marketing_consent` → `20261020140200`),
  manifest I9 (l.~932-955; dopisać pliki Y2 z komentarzem „(I9d, data) Y2”).
  **Pułapka bramki:** funkcja należąca do I9 z wpisem w `HUB_CIALO_Z` (np. `newsletter_campaign_engagement`)
  redefiniowana DRUGI raz w bloku I9 dostanie `zly-cialo-z` (bramka l.1423-1440 porównuje znacznik
  z `HUB_CIALO_Z`, nie z najnowszą definicją w hubie) – unikać redefinicji albo poprawić regułę.
- Literalne nazwy RPC/tabel w TS (`generate:ts-sql-contract`), `types.ts` (`check:types-freshness`),
  `generate:authz-snapshot --check`, `i18nParity.gate.test.ts` (`GATED_PREFIXES` – `newsletterForm`,
  `joinUs`, `authForms` NIE są bramkowane; rozważyć dodanie), `scripts/hub-slice-guard.ts`.
- Plik migracji ≤ 45 KiB, nagłówek DEFEKT/ZMIANA/KOLEJNOSC/IDEMPOTENTNA/DOWOD, `-- CIALO-Z:`,
  znacznik harnessu, jeśli migracja wspomina `event_*`/`contact_messages`/`club_*` i sięga poza
  moduł (`-- careers-harness: exclude` / `-- pg-harness: exclude` – wzór `20261020160900`; migracja
  z nową wersją `event_consent_texts` ma nagłówek `-- events-harness: include` jak `20261012130600:1`).

---

## 10. Rekomendacja wdrożenia

### Model danych (propozycja)
1. **Klucz `email_measurement` w `crm_consent_log`** (bez ALTER tabeli): zgoda obejmująca pomiar
   zapisuje drugi wiersz `consent_key='email_measurement'`, `given=true`, ta sama treść i wersja.
   Wycofanie pomiaru (bez wypisu) = wiersz `given=false`. Retencja łańcuchów działa per klucz bez zmian.
2. **Rejestr wersji treści domyślnej** (TS, wzór premium): nowy `src/lib/consent/marketingConsentText.ts`
   – `MARKETING_CONSENT_TEXTS: Record<version, {pl,en, measurement: true, link:{href}}>`,
   `CURRENT_*_VERSION`, `LEGACY_DEFAULTS` (dotychczasowe teksty z tabeli §2 jako wersje „bez pomiaru”),
   adaptery `toHtml/toMarkdown/toPlain`, `consentMentionsMeasurement(text, lang)` (ostrzeżenie panelu),
   link do `documentIndex` (`/komunikacja-i-marketing#rezygnacja`). i18n
   (`newsletterForm.consentDefault`, `joinUs.consent`, `authForms.newsletterOptIn`, `clubGate.newsletterOptIn`,
   popup `newsletter_optin`, kontakt `newsletter`) CZYTA rejestr – jak `i18n-profile.ts:805`.
3. **Flagę „z pomiarem” liczy serwer, nie klient**: w `subscribeToNewsletter`/`contact`/checkout
   porównanie przesłanego tekstu z rejestrem (i ewentualnie z tekstem admina oznaczonym w panelu
   „informuje o pomiarze”); klient tylko podaje tekst. `version` = wersja rejestru albo skrót
   `sha256:` liczony na serwerze, gdy brak.
4. **Czytelnik SQL** (internal, SECURITY DEFINER, `search_path = public, pg_temp`):
   `_email_measurement_allowed(p_tenant uuid, p_email text) RETURNS boolean` – ostatni wpis
   `email_measurement` = true **i późniejszy** niż ostatnie wycofanie (`marketing`/`newsletter` false,
   `newsletter_subscribers.unsubscribed_at`), AND `COALESCE(journey_settings.open_tracking_enabled, true)`.
   Batch dla kampanii: service RPC (np. `newsletter_measured_subscribers(p_tenant uuid, p_ids uuid[])`)
   albo pole w zapytaniu wysyłki.

### Kolejność (pliki)
1. **TS – jedno źródło** (`src/lib/consent/marketingConsentText.ts` + test parytetu PL/EN, test
   „i18n = rejestr”, test `consentMentionsMeasurement`). Podpięcie: `i18n-public.ts:29/141`,
   `i18n-interests.ts:42/87`, `i18n-public-auth.ts:42/97`, `i18n-club-gate.ts:72/147`,
   `popupFields.ts:134-139`, `ContactFormView.tsx:68/84` + `builder/registry.tsx:2352-2353`,
   `useNewsletterSettings.ts:119-122`, `NewsletterDocRenderer.tsx:202-208`, `JoinUsForm.tsx:410-414`
   (**logować to, co wyświetlone**), `premiumNewsletter.ts` (nowa wersja z pomiarem, stara zostaje).
   Render-time mapowanie „zapisany == stary domyślny → bieżący” dla treści w JSON buildera
   (bez przepisywania `pages.builder_data` i rewizji).
2. **Migracja A (SQL, blok I9 po Y1):** `ALTER COLUMN … SET DEFAULT` `newsletter_settings.policy_html_*`
   + `UPDATE … WHERE policy_html_pl = '<stary domyślny>'` (i `popup_fields` label, akapity doc
   o treści == stary domyślny – jsonb, ostrożnie); `event_consent_texts`: `retired_at` v1 marketing,
   INSERT v2 PL/EN (+ `EVENT_CONSENT_TEXT_VERSION = 2`, i18n `eventRegistration.consents.marketing`);
   redefinicja `newsletter_to_lead` (CIALO-Z `20260708151417`: fallback z rejestru, log klucza
   `email_measurement` gdy wpis ma flagę; rozważyć `UPDATE OF status, consents` z logiem tylko
   NOWYCH wpisów) ; `_email_measurement_allowed` + batch RPC (granty: REVOKE PUBLIC/anon/authenticated,
   GRANT service_role).
3. **Migracja B (render ścieżek):** redefinicja `journey_contact_for_send` (CIALO-Z `20261020161300`):
   `'open_tracking'` = przełącznik AND zgoda; nowe pole `'link_tracking'`; `journey_record_message_event`
   (CIALO-Z `20261020161300`): odmowa `no_measurement_consent` dla open/click (maile wysłane przed
   zmianą i po wycofaniu). Wpisy `HUB_I9_REDEFINITIONS` zaktualizować na `20261020161300`.
   TS: `render.server.ts` (flaga linków), `journeysRunner.server.ts:386`, `parse.ts`/`dto.ts`.
4. **Kampanie:** `newsletter-campaigns.functions.ts:1486-1503` – `tracking: measured ? {...} : null`
   (render bez zmian), przełącznik najemcy wspólny (czyta `journey_settings.open_tracking_enabled`
   – Z-I9c-09; opis w karcie retencji „ścieżki i kampanie”); opcjonalnie
   `newsletter_campaigns.tracked_count` dla mianownika; gate w `newsletter_record_campaign_event`
   (CIALO-Z `20260814215302`, wpis `HUB_CIALO_Z`) i w webhooku dostawcy.
5. **Panel:** ostrzeżenie „własny tekst nie wspomina o pomiarze” (NewsletterBuilder, `ConsentsTab.tsx`,
   edycja pól popupu, inspektor CMS dla `consentText`/`newsletterLabel`); dymki (§7);
   karta retencji – `adminDataRetention.pixel.*` (rekomendacja → stan „wykonane”).
6. **(Opcjonalnie) „Poproś o zgodę na pomiar”:** panel newslettera (`OverviewPanel`/`SubscribersPanel`,
   sekcyjny `adminPageHead`), RPC panelu `admin_newsletter_measurement_preview()` (liczba subskrybentów
   `subscribed` bez `email_measurement`) i start (admin z sesji), mail przez kolejkę (`bulk`, lista
   wyłączeń), treść w `txOverrides`, token jednorazowy `nm:` (tabela sha256 tokenów, wzór
   `event_consent_confirmations`), trasa publiczna potwierdzenia → wpis `email_measurement` + `consents`;
   brak reakcji = bez zmian. Zgoda na pomiar dla ISTNIEJĄCEGO subskrybenta wyłącznie linkiem z maila
   (formularz publiczny zwraca `exists` bez zapisu – `newsletter.functions.ts:243-248` – i nie dowodzi
   własności skrzynki).
7. **Polityka:** `communications.ts` sekcje `pomiar` (PL l.92-101, EN l.211-220) – podstawa = zgoda,
   wersjonowanie, brak piksela bez zgody; `COMPLIANCE_PACK_UPDATED`.
8. **Dokumenty:** rejestr czynności §4 (Podstawa: pomiar = zgoda, art. 6 ust. 1 lit. a RODO
   + art. 5 ust. 3 dyr. 2002/58/WE, w PL art. 399 PKE – zweryfikować numer), §5, punkt IOD l.216-221
   → zamknięty; dziennik „21.x Treść zgody i pomiar (I9d-Y2)”, §21.21 pkt 5 i Z-I9c-09 → „Zamknięte
   (I9d, §21.x)”; runbook (przełącznik, tryb `provider`).

### Wersje migracji
- Najwyższa istniejąca: `supabase/migrations/20261020161400_data_retention_panel.sql`; bliźniak
  `drizzle/migrations/0372_data_retention_panel.sql` (journal idx 372, `when` 1792477933912).
- S7 doda `20261020150000`, `…150050`, `…150100` (gałąź `hub/s7-zakladki-diagnostyka-c`) → bliźniaki
  ≈ `0373-0375`; Y1 zajmie `2026102016150x+` i kolejne numery drizzle. **Y2: następna wolna wersja
  `2026102016xx00` po Y1** (sprawdź `ls supabase/migrations | grep ^2026102016 | tail` i
  `ls drizzle/migrations | tail`), `when` = poprzedni + 60000, `bun run check:migration-lanes`.
  Kolejność wersji = kolejność dziennika drizzle (migracja B zależy od A).

### Testy
- vitest: rejestr treści (parytet PL/EN, każdy konsument i18n = rejestr, stara wersja nietknięta),
  `consentMentionsMeasurement`, adaptery formatów, JoinUs loguje wyświetlony tekst,
  `render.server.test.ts` (bez zgody: brak piksela, linki nieprzepisane, wypis jest; wzór l.186),
  `journeysRunner.server.test.ts` (wzór l.219-236), kampanie: render z `tracking:null` (SHA-256 bez zmian),
  `-nl-tracking.test.ts` (odmowa zapisu), `eventConsentTexts.gate.test.ts` (v2),
  `premiumNewsletter.test.ts`, `consentSnapshot.test.ts`, testy formularzy
  (`src/components/__tests__/{NewsletterForm,popupSignupForm}.test.tsx`,
  `src/components/popups/__tests__/SignupPopupPanel.test.tsx`,
  `src/lib/billing/__tests__/purchaseEffectsNewsletterConsent.server.test.ts` – asertują obecne napisy).
- pgTAP (nowy `supabase/tests/hub_i9d_consent_measurement_test.sql`, wzory
  `hub_i9c_data_retention_aggregates_test.sql:173-185`, `journeys_consent_test.sql`,
  `journeys_tracking_stats_test.sql`, `consent_evidence_hardening_test.sql`,
  `event_consent_ledger_test.sql`): wersja w rejestrze przy każdej zgodzie, wpis `email_measurement`,
  `_email_measurement_allowed` (zgoda / brak / wycofanie później / ponowny zapis po wypisie / przełącznik
  off), `journey_contact_for_send` pola, odmowa zdarzeń, ACL (anon/authenticated bez EXECUTE,
  panel – admin z sesji, obcy najemca), domyślne SQL vs stare wiersze (UPDATE tylko == stary domyślny).
- RTL/axe: ostrzeżenie panelu, dymki, dialog „Poproś o zgodę” (liczba, potwierdzenie).

---

## 11. Otwarte pytania / ryzyka

1. **Zgoda pakietowa vs polityka:** `communications.ts:57/176` deklaruje brak zgód pakietowych
   („każda zgoda ma osobne pole”). Wplecenie pomiaru w zgodę newslettera bez osobnego pola może być
   uznane za warunkowanie (art. 7 ust. 4 RODO). Alternatywa zgodna z polityką: osobny, niezaznaczony
   checkbox „pomiar otwarć i kliknięć”. Model z kluczem `email_measurement` obsługuje oba warianty –
   decyzja właściciela/IOD.
2. **Własne teksty admina:** czy liczyć je jako „z pomiarem”? Heurystyka słów kluczowych nie jest
   dowodem – proponowane jawne oznaczenie przez admina (z ostrzeżeniem) albo „bez pomiaru” zawsze.
3. **Anonimowe kliknięcia:** dziś niemożliwe (`newsletter_record_campaign_event` odrzuca brak
   subskrybenta; ścieżki liczą po `message_id`). Opcje: linki nieprzepisane (zero pomiaru) albo
   nowy podpis per kampania/węzeł bez odbiorcy (redefinicja RPC). Czy przekierowanie bez
   identyfikatora jest poza art. 5 ust. 3 – do oceny prawnej.
4. **Warunki ścieżek `email_opened/email_clicked`** dla niemierzonych odbiorców zawsze `false` →
   `newsletter_welcome` wyśle „preferences” także osobom, które czytały. Decyzja: ostrzeżenie
   w edytorze / gałąź domyślna dla niemierzonych.
5. **Y1 (wygaszanie):** zaangażowanie = otwarcia/kliknięcia; subskrybent bez zgody na pomiar nie
   wygeneruje sygnałów → trafi do wygaszania po 12 mies. mimo czytania. Uzgodnić z Y1 (wykluczenie
   lub inna definicja zaangażowania dla niemierzonych).
6. **Tryb `provider`** (`NEWSLETTER_ENGAGEMENT_SOURCE`): piksel dostawcy nie daje się bramkować per
   odbiorca – w runbooku wymagać `first_party` i wyłączonego trackingu u dostawcy; webhook
   zdarzeń dostawcy odsiewać wg zgody.
7. **Mianowniki wskaźników** (`sent_count`, „wysłane” per krok) obejmują niemierzonych → wskaźniki
   otwarć spadną skokowo po wdrożeniu (nie realny spadek). Minimum: dymek; lepiej: licznik mierzonych.
8. **Maile serwisowe ścieżek** (kategoria `service`): czy zgoda newslettera na pomiar obejmuje też je?
   Bezpieczniej: pomiar tylko dla `marketing` albo tylko przy zgodzie (decyzja).
9. **Pisarze rejestru niespójni**: AuthFormBlocks/ClubAccessGate nie zapisują zgody ani subskrypcji
   (`marketing_opt_in` tylko w zdarzeniu); kontakt loguje fallback zamiast etykiety; JoinUs loguje inny
   tekst niż wyświetla; wyzwalacz nie loguje UPDATE `consents`. Część to błędy poza Y2 – zgłosić
   jako Z-I9d-NN albo naprawić przy okazji (zakres do decyzji).
10. **Treści w JSON buildera** (`pages.builder_data`, rewizje, szablony, globalne widgety) – masowa
    aktualizacja SQL ryzykowna (rewizje, publikacje); proponowane mapowanie przy renderze.
11. **Opublikowana wersja polityki w bazie** przesłania kod (`legal_document_versions`).
12. **EN `/privacy-policy`** w domyślnych tekstach – brak trasy w `src/routes`; poprawić w nowym
    domyślnym (ścieżki z `documentIndex.ts`).
13. **Wycofanie pomiaru** a Z-S5-04 (wspólny pomocnik wycofania): czytelnik oparty na „później niż
    ostatnie wycofanie” nie wymaga zmian w 4 pisarzach wycofania; jeśli Z-S5-04 powstanie w I9 –
    dopisać tam wiersz `email_measurement=false`.
14. Konflikt plików z Y1 (`src/lib/privacy/**`, karta retencji, `txOverrides`, tokeny) i S8
    (`JourneySettingsDialog`, statystyki S8.2) – Y2 robić po scaleniu S8/S7/Y1.
