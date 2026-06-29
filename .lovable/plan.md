## Plan: Rozbudowa widgetu „Formularz kontaktowy" + centrum kontaktu w Admin Panel

### 1. Rozszerzenie schemy widgetu `contact-form`
Plik: `src/lib/builder/registry.tsx` + `src/lib/builder/schemas.ts`

Nowe pola konfiguracji (PL/EN):
- **Pola formularza** (repeater): typ (`text|email|phone|textarea|select|checkbox|file|date`), label PL/EN, placeholder PL/EN, `required`, `width` (`full|half|third`), opcje (dla select).
- **Layout**: `columns` (1/2/3), `gap`, `labelPosition` (`top|inline|floating`).
- **Przycisk**: `label_pl/en`, `align` (`left|center|right|full`), `position` (`bottom|inline-right`), `variant` (`solid|outline|ghost|gradient`), `size`.
- **Tło**: `bgLight`, `bgDark`, `bgImage` (upload — rekomendowane **1600×900 px**, hero **2400×1200 px**), `bgImageMobile` (**800×1000 px**), `overlay`, `animationVariant` (6 wariantów, p. niżej).
- **Inne**: kolor tekstu light/dark, kolor borderu, radius, padding, ikona nagłówka (upload **128×128 px**).

### 2. Sześć wariantów subtelnej animacji tła
Plik: `src/components/blocks/ContactFormBackgrounds.tsx` (nowy) + CSS w `src/styles.css`:
1. `aurora` - powolne gradientowe „zorze"
2. `mesh-drift` - mesh gradient dryfujący
3. `floating-dots` - cząsteczki/kropki w tle
4. `wave-lines` - delikatne fale SVG
5. `noise-shimmer` - subtle grain + shimmer
6. `orbits` - orbitujące koła z blurem

Każdy wariant: `prefers-reduced-motion` ⇒ static fallback, light/dark aware (CSS vars), GPU-only (transform/opacity).

### 3. Renderer
Plik: `src/components/blocks/ContactFormView.tsx` - generuje pola dynamicznie z konfiguracji, respektuje `columns`/`width`/`position`, zachowuje walidację (zod) i honeypot, integruje warstwę tła.

### 4. Admin panel - „Centrum kontaktu"
- Route: `src/routes/admin.contact.tsx` (tabela `contact_messages` - lista, filtry, status, oznacz jako przeczytane, eksport CSV, podgląd wiadomości).
- Link w bocznym menu admina.
- Tabela `contact_messages` już istnieje (`src/lib/contact.functions.ts`) — dodaję migrację:
  - kolumny: `read_at`, `archived_at`, `tags text[]`, `assigned_to uuid`,
  - GRANT + RLS scoped tenant + has_role('admin'),
  - indeksy `created_at desc`, `status`.

### 5. Auto-potwierdzenie e-mail
Rozszerzenie `submitContactMessage` w `src/lib/contact.functions.ts`:
- Po insercie - wysyłka 2 maili (do nadawcy „dziękujemy" + do `recipient`) przez istniejący kanał Resend/Mailer (sprawdzę secrets/connector).
- Jeśli brak `RESEND_API_KEY` ⇒ degradacja: zapis + log; pokażę userowi co dodać.
- Lokalizacja treści PL/EN, opcjonalny szablon konfigurowalny w `admin.contact` (Tab „Ustawienia").

### 6. i18n / a11y / tenant
- Wszystkie etykiety w `src/lib/i18n.ts` (`contactForm.*`).
- `tenant_id` dopisany do `contact_messages` przy zapisie.
- ARIA: `aria-describedby` dla błędów, `aria-live="polite"` dla sukcesu, focus management.

### 7. Testy
- `src/components/blocks/__tests__/ContactFormView.test.tsx` - render dynamicznych pól, walidacja, layout columns.
- `src/lib/__tests__/contactFormSchema.test.ts` - parsowanie konfiguracji.

### Pytanie do potwierdzenia
1. **E-mail provider**: użyć **Resend** (zalecam, prosty edge-friendly) czy masz preferencję innego (SendGrid / SMTP / Lovable Mail)? Jeśli Resend - poproszę o `RESEND_API_KEY` po akceptacji planu.
2. **Newsletter confirmation** - w treści wspominasz „potwierdzenie zapisania się do newslettera". Czy chodzi o: (a) double opt-in dla istniejącego widgetu Newsletter (osobno), czy (b) auto-odpowiedź dla Formularza kontaktowego po wysłaniu wiadomości? Zakładam **(b) + opcjonalny checkbox „Zapisz mnie do newslettera" w formularzu**, który po zaznaczeniu dodaje subskrybenta i wysyła double opt-in mail. Potwierdzisz?
