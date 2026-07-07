
# Redesign /admin/newsletter

Cel: zamiana obecnego długiego formularza na dedykowany moduł z zakładkami, KPI, wyborem trybu i pełnym drag & drop builderem (osobne kanwy dla inline i popup).

## 1. Nawigacja i struktura URL

```
/admin/newsletter                    -> Overview (redirect na .overview)
/admin/newsletter/overview          -> KPI + logika + wybór trybu + dual preview
/admin/newsletter/inline            -> Inline form builder (drag & drop)
/admin/newsletter/popup             -> Popup builder (drag & drop) + triggery
/admin/newsletter/subscribers       -> Tabela subskrybentów (CRUD, filtry, eksport)
```

Layout ma sticky sub-nav (segmented tabs) i wspólny nagłówek `NewsletterHeader` z tytułem, statusem publikacji i przyciskiem "Zapisz wszystko".

## 2. Overview (nowa strona główna)

Cztery bloki jeden pod drugim:

### 2a. KPI grid (4 karty)
- Subskrybenci (total) + delta 30d
- Wzrost 30d (%) z mini sparklinem
- Opt-in rate (subscribed / all) - jeśli włączony double opt-in
- Unsubscribes 30d + trend

Dane z `newsletter_subscribers` agregowane w server function `getNewsletterKpis` (SQL group by day).

### 2b. Ustawienia logiki
- Enable / disable form globalnie
- Double opt-in on/off
- Domyślne listy mailingowe (multi)
- Sender name/email (nowe pola)
- Reguły triggerów popup: delay / scroll / exit-intent + frequency

### 2c. Wybór trybu (segmented)
`newsletter_mode: 'inline' | 'popup' | 'both' | 'off'` decyduje co jest aktywne na froncie.
Zapisywane w `newsletter_settings`.

### 2d. Dual live preview
Dwie kolumny obok siebie: Inline (render `NewsletterInlineRenderer`) i Popup (render `NewsletterPopupRenderer` w kontenerze udającym viewport). Podgląd PL/EN.

## 3. Inline & Popup builder (Elementor-style)

Nowy dedykowany builder w `src/lib/newsletter-builder/` - osobny od CMS pages buildera, żeby nie mieszać widgetów.

### Model danych
```ts
type NlDoc = {
  version: 1;
  sections: NlSection[];   // pionowe sekcje z background
};
type NlSection = { id; columns: NlColumn[]; style: {...} };
type NlColumn = { id; span: 1..12; widgets: NlWidget[] };
type NlWidget =
  | { type: 'heading', ... }
  | { type: 'paragraph', ... }
  | { type: 'image', ... }
  | { type: 'divider', ... }
  | { type: 'spacer', ... }
  | { type: 'field.email', ... }         // required, jeden w drzewie
  | { type: 'field.text', name, label, required }
  | { type: 'field.select', options, mailingListLink }
  | { type: 'field.checkbox', consentHtml, required }
  | { type: 'field.mailing-lists' }
  | { type: 'submit', label, style }
  | { type: 'success-message' }
  | { type: 'social-proof' }             // "1234 zapisanych"
  | { type: 'countdown' }                // opcjonalny incentive
;
```

### UI buildera (3 panele)
```text
+---------------------------------------------------+
| Toolbar: Undo | Redo | Device | PL/EN | Zapisz    |
+------+-------------------------------+-----+------+
| Lib  |          Canvas (D&D)         |  Properties |
| dnd  |  section > column > widget    |  (panel)    |
+------+-------------------------------+-------------+
```

- Lewy panel: `WidgetLibrary` z pogrupowanymi kafelkami (Layout / Content / Fields / Actions). HTML5 drag.
- Canvas: klik zaznacza element (podświetla), hover pokazuje toolbar (duplikat/usuń/parent), reorder przez drag handle. Sekcje mają `+ dodaj sekcję` między nimi. Kolumny wybierane z presetów (1, 1/1, 1/2/1, 1/3, ...).
- Prawy panel: kontekstowe properties (style, content, layout, advanced) - reużywamy tokenów Theme Design (tak jak w CMS builderze).
- Undo/redo (useUndoRedo), autosave off (manual save + unsaved guard - reuse istniejącej infrastruktury `useUnsavedChangesGuard`).

### Persistence
Nowa migracja: dodać do `newsletter_settings` kolumny:
- `mode text default 'inline'`
- `inline_doc jsonb`
- `popup_doc jsonb`
- `sender_name text`, `sender_email text`

Migracja backfillowa: z obecnych pól (`heading_pl`, `description_pl`, `policy_html_pl`, cover, side_image, colors, popup_title_pl, ...) buduje default `inline_doc` i `popup_doc`, żeby istniejące instalacje wyglądały jak dziś.

### Renderery frontendowe
- `NewsletterInlineRenderer` (używany w widgetach block `newsletter` na stronach)
- `NewsletterPopupRenderer` (używany w `NewsletterPopup`)
Oba czytają `inline_doc` / `popup_doc`. Jeśli doc pusty -> fallback do klasycznego layoutu (backward compat).

## 4. Subscribers (osobna podstrona)

`/admin/newsletter/subscribers`:
- Sticky toolbar: search, filter status, filter language, filter source, date range
- Tabela virtualized (jeżeli > 500) - kolumny: email, imię, język, status (badge), źródło, lista, data, akcje (resend confirm, unsubscribe, delete)
- Bulk actions: export selected, delete, change status
- Modal detalu subskrybenta (custom fields z popup extended fields)
- Import CSV (nowe) - upload pliku, mapowanie kolumn, preview, zapis (server fn)

## 5. Bezpieczeństwo i backend

- Wszystkie mutacje przez `createServerFn` z `requireSupabaseAuth` + `has_role(auth.uid(), 'admin' | 'editor')` (reuse `require-staff.ts`).
- KPI query po stronie serwera (agregaty), nie ciągniemy 10k wierszy do klienta.
- RLS: kolumny `inline_doc/popup_doc/mode/sender_*` wpadają pod istniejące polityki `newsletter_settings`.
- Sanitize HTML we wszystkich widgetach typu `paragraph`/`consent` (istniejący `sanitizeHtml`).
- Walidacja Zod na wszystkich server fn i input z buildera (schema `NlDocSchema`).

## 6. Design system

- Layout builda: dark canvas, sticky panels, radius-md, cień `--shadow-elegant`.
- Kolory z tokenów semantycznych (`--card`, `--border`, `--primary`, `--muted-foreground`).
- Font `Red Hat Display` (memory).
- Section-label widget (jeśli używamy) trzyma z-index >= 20 (memory).
- Motion: fade+scale 150ms na drop targets, spring na drag handle.

## 7. i18n

Wszystkie nowe stringi w `src/locales/pl.json` i `src/locales/en.json` pod `admin.newsletter.builder.*` i `admin.newsletter.overview.*`. Widgety w preview używają `lang` prop (PL/EN toggle w toolbarze).

## 8. Pliki (kluczowe)

Route files:
- `src/routes/admin.newsletter.tsx` -> layout z Outlet + sub-nav
- `src/routes/admin.newsletter.index.tsx` -> redirect na overview
- `src/routes/admin.newsletter.overview.tsx`
- `src/routes/admin.newsletter.inline.tsx`
- `src/routes/admin.newsletter.popup.tsx`
- `src/routes/admin.newsletter.subscribers.tsx`

Builder core:
- `src/lib/newsletter-builder/types.ts`
- `src/lib/newsletter-builder/schema.ts` (Zod)
- `src/lib/newsletter-builder/defaults.ts` (fabryki widgetów + backfill z legacy settings)
- `src/lib/newsletter-builder/history.ts`

Admin UI:
- `src/components/admin/newsletter/NewsletterSubNav.tsx`
- `src/components/admin/newsletter/KpiCards.tsx`
- `src/components/admin/newsletter/ModeSelector.tsx`
- `src/components/admin/newsletter/LogicSettings.tsx`
- `src/components/admin/newsletter/DualPreview.tsx`
- `src/components/admin/newsletter/builder/NewsletterBuilder.tsx`
- `src/components/admin/newsletter/builder/BuilderCanvas.tsx`
- `src/components/admin/newsletter/builder/WidgetLibrary.tsx`
- `src/components/admin/newsletter/builder/PropertiesPanel.tsx`
- `src/components/admin/newsletter/builder/widgets/*` (jeden plik na widget)
- `src/components/admin/newsletter/subscribers/*` (Table, Filters, ImportDialog, DetailDialog)

Runtime rendery:
- `src/components/newsletter/NewsletterDocRenderer.tsx`
- Update `src/components/NewsletterForm.tsx` i `src/components/NewsletterPopup.tsx` do użycia doc-renderera z fallbackiem.

Server fns:
- `src/lib/newsletter.functions.ts` (getKpis, listSubscribers, importSubscribers, updateSubscriber, deleteSubscriber, saveNewsletterDoc)

Migracja:
- `supabase/migrations/<ts>_newsletter_builder.sql`

Testy:
- `src/lib/newsletter-builder/__tests__/schema.test.ts`
- `src/lib/newsletter-builder/__tests__/defaults.test.ts`
- `src/components/admin/newsletter/builder/__tests__/BuilderCanvas.test.tsx`

## 9. Zakres i etapowanie

Rekomendacja: wdrożenie w 2 turach ze względu na rozmiar (~35 nowych plików).

**Tura 1 (ta wiadomość)** - fundament, żeby wszystko było użyteczne od razu:
- Migracja bazy + backfill doców
- Model danych + Zod schema + defaults + history
- Routing (layout + 4 podstrony)
- Overview (KPI, LogicSettings, ModeSelector, DualPreview)
- Subscribers (tabela + filtry + eksport, bez importu CSV)
- Runtime `NewsletterDocRenderer` + spięcie z istniejącym `NewsletterForm`/`NewsletterPopup` (z fallbackiem)
- Builder MVP: canvas, biblioteka, properties, drag & drop dla top-level widgetów (heading, paragraph, field.email, field.text, submit, consent, image, divider) - bez sekcji/kolumn (na kanwie flat list z drag reorder)
- i18n PL/EN, testy jednostkowe schemy i defaults

**Tura 2 (wdrozona)**:
- Nowe widgety: `field.select`, `field.mailing-lists`, `social-proof`, `countdown` (types + schema + defaults + registry + WidgetPreview + PropertiesPanel).
- Runtime `NewsletterDocRenderer` (src/components/newsletter/) - waliduje, submituje przez `subscribeToNewsletter`, renderuje sukces, obsluguje wszystkie widgety, live subscriber count z fallbackiem.
- Wpiecie w produkcje: `NewsletterForm` uzywa doc renderera gdy `settings.inline_doc` + `mode !== off/popup`; `NewsletterPopup` renderuje `settings.popup_doc` w miejscu legacy split/stacked. Fallback zachowany.
- Backfill legacy popup color settings do `doc.popup` przy pierwszym otwarciu buildera (bg/fg/muted/accent/accentFg/overlay/radius/layout/sideImage).
- Import CSV: `importNewsletterSubscribers` (requireStaff), `ImportCsvDialog` z parserem CSV (, i ;), auto-mapowaniem kolumn, podgladem i idempotencja per e-mail.
- Gating trybu w NewsletterPopup (nie pokazuje sie gdy `mode === off/inline`).

**Tura 3 (planowana)**:
- Multi-sekcje w builderze (add/delete/reorder + section-level styling w PropertiesPanel).
- Grid 12-kolumnowy per sekcja + presety ukladow (1, 1/1, 1/2/1, 2/1, itd.).
- Modal detalu subskrybenta (edycja custom fields).
- Testy E2E buildera (Playwright).
- Migracja legacy popup color settings do doc-poziomowych stylow (permanent, nie tylko lazy backfill).

## 10. Ryzyka

- Legacy `NewsletterPopup`/`NewsletterForm` używane na froncie - musimy zachować backward compat (fallback do starych pól, jeśli doc = null).
- `newsletter_settings` ma jeden wiersz per tenant - migracja backfill musi być idempotentna.
- Drag & drop bez ciężkiej biblioteki (chcemy natywny HTML5, jak w istniejącym CMS builderze) - trzeba uważać na touch devices.

---

Potwierdź plan (lub wskaż zmiany) - po akceptacji rusza Tura 1.
