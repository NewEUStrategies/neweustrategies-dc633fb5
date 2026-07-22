## Cel

Rozdzielić obecny CRM na dwie odrębne domeny:

1. **Kontakty** — osoby powiązane z organizacją (zarejestrowani użytkownicy, subskrybenci płatni, uczestnicy wydarzeń, paneliści, eksperci, kontakty dodane ręcznie).
2. **Lejek marketingowy / Subskrybenci newslettera** — baza subskrybentów (`newsletter_subscribers`) prezentowana w tym samym stylu co Kontakty, z oznaczeniem czy dana osoba jest już Kontaktem/zarejestrowanym użytkownikiem, czy jeszcze nie.

## Zakres zmian

### Nawigacja (Sidebar admina)

```text
CRM
├── Kontakty            → /admin/crm            (dotychczasowy widok, przemianowany)
├── Firmy               → /admin/companies      (bez zmian)
└── Lejek marketingowy  → /admin/crm/funnel     (NOWE — subskrybenci newslettera)
```

### Kontakty (`/admin/crm`)

- Etykiety UI już przemianowane na "Kontakty" (poprzedni turn).
- Auto-populacja poszerzona: obecny `crm_backfill_all_leads` (profile) uzupełniamy o:
  - płatnych subskrybentów (`user_subscriptions` aktywne),
  - uczestników wydarzeń (`event_rsvps` → dopasowanie po email/user_id),
  - panelistów/prelegentów (`event_speakers`, `podcast_episode_people`),
  - ekspertów (`author_profiles` / `expert_expertise_areas`).
- Dodajemy pole `source_type` (enum: `registered`, `paid_subscriber`, `event_participant`, `speaker`, `expert`, `manual`, `contact_form`) do `crm_leads`, żeby filtrować i pokazywać badge źródła. Trigger `profile_sync_crm_lead` aktualizuje `source_type` na podstawie relacji.

### Lejek marketingowy (`/admin/crm/funnel`)

- Nowa strona listowa w stylu `/admin/crm` (te same karty statystyk, filtry, bulk actions, sticky header).
- Źródło danych: tabela `newsletter_subscribers` (już istnieje, 23 kolumny).
- Kolumny widoku:
  - Avatar (face-aware, jeśli email pasuje do `profiles.avatar_url`),
  - Email + imię/nazwisko (jeśli znane),
  - Status subskrypcji (confirmed / pending / unsubscribed),
  - **Badge "Kontakt"** — jeśli email istnieje w `crm_leads` w tym samym tenant,
  - **Badge "Zarejestrowany"** — jeśli email istnieje w `profiles`,
  - Data zapisu, źródło (`source`), tagi.
- Bulk actions: eksport CSV, unsubscribe, tag, "Konwertuj do Kontaktu" (tworzy wpis w `crm_leads` z `source_type=manual`).
- Karta szczegółów (drawer + `/admin/crm/funnel/$id`): historia kampanii (`newsletter_campaign_recipients`, `newsletter_campaign_events`), zgody (`user_consents`), preferencje.
- Filtry: status, źródło, tag, "tylko zarejestrowani", "tylko niezarejestrowani", "tylko Kontakty", zakres dat zapisu.

### Baza / migracje

1. `ALTER TABLE crm_leads ADD COLUMN source_type text` + CHECK constraint na wartości enum.
2. Backfill `source_type` na podstawie istniejących relacji.
3. Rozszerzenie funkcji `crm_backfill_all_leads()` / triggerów, żeby importowała nowe źródła (subskrybenci płatni, event_rsvps, speakers, experts).
4. Widok `crm_funnel_view` łączący `newsletter_subscribers` z `profiles` i `crm_leads` (flagi `is_registered`, `is_contact`, `contact_id`, `avatar_url`). Widok respektuje RLS przez `security_invoker`.
5. Server fn `listFunnelSubscribers`, `getFunnelSubscriber`, `convertSubscriberToContact`, `bulkTagSubscribers`, `bulkUnsubscribe`.

### Kod frontend

- `src/routes/admin.crm.tsx` — layout CRM z zakładkami: Kontakty, Lejek (subskrybenci).
- `src/routes/admin.crm.funnel.index.tsx` — lista (analogiczna struktura do `admin.crm.index.tsx`, ~90% kodu reużyte przez wspólne komponenty).
- `src/routes/admin.crm.funnel.$id.tsx` — karta subskrybenta.
- `src/components/admin/crm/SubscriberBadges.tsx` — badge "Zarejestrowany" / "Kontakt".
- `src/lib/crm-funnel.functions.ts` — server functions.
- i18n (PL/EN) w istniejących słownikach.

### Bezpieczeństwo / RLS

- `newsletter_subscribers` ma już 3 polityki; dodajemy widok/funkcje z `SECURITY DEFINER` tylko dla adminów tenanta (`has_role(auth.uid(),'admin')` + `tenant_id = current_tenant()`).
- Bulk operacje sprawdzają `tenant_id` po stronie serwera; brak `any`/`as any`.

### Testy

- Vitest: `crm-funnel.functions.test.ts` (badge flags, konwersja do kontaktu, filtry).
- RLS smoke test w `supabase--read_query` po migracji.

## Kolejność wdrożenia

1. Migracja: `source_type`, widok `crm_funnel_view`, rozszerzony backfill.
2. Server functions (`crm-funnel.functions.ts`).
3. Layout CRM z zakładkami + strona lejka + karta subskrybenta.
4. Rozbudowa auto-populacji Kontaktów (subskrybenci płatni, wydarzenia, eksperci).
5. Testy + weryfikacja UI (Playwright screenshot listy lejka i karty).

## Poza zakresem (świadomie)

- Zmiana etykiet w publicznej części strony ("Zapisz się do newslettera" itd.).
- Segmentacja/automatyzacja kampanii — pozostawiona pod istniejący `newsletter_campaigns`.
- Migracja historycznych leadów spoza tenanta zalogowanego użytkownika.
