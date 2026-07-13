# Organizacje: dedykowane strony + branding premium

Zamiana popupu na dedykowane strony tworzenia i edycji organizacji, w stylu naszej strony publicznej (kompaktowe, mniejsze czcionki, spójny grid). Do tego rozbudowany moduł brandingu z live-podglądem logo na jasnych/ciemnych tłach.

## Zmiany danych (migracja SQL)

Dodanie kolumn brandingowych do `public.member_organizations`:

- `slug` text unique (auto z nazwy, do URL publicznego)
- `description` text, `website_url` text, `sector` text, `city` text, `country` text
- `brand_primary` text (hex), `brand_accent` text (hex), `brand_ink` text (hex, kolor tekstu na tle marki)
- `logo_h_light` text (url), `logo_h_dark` text (url), `logo_v_light` text (url), `logo_v_dark` text (url)
- `logo_favicon` text (url)
- Indeks unique na `slug` (nullable OK)
- GRANT-y i policy bez zmian (nadal admin-only write); publiczny read tylko jeśli już istnieje - nie ruszam.

Bucket storage: `org-branding` (public read, admin write) na assets logo.

## Trasy (routing)

- `/admin/organizations` — lista (bez popupu). Przycisk „Nowa organizacja" → `Link to="/admin/organizations/new"`. Każda karta ma link „Edytuj" → `/admin/organizations/$id`.
- `/admin/organizations/new` — dedykowana strona formularza (ta sama kompozycja co edycja, ale bez zakładek brandingu przed zapisem albo z lekkim FormState). Po zapisie redirect do `/admin/organizations/$id`.
- `/admin/organizations/$id` — strona edycji z zakładkami:
  1. **Ogólne** — nazwa, slug, warstwa, limit miejsc, status, opis, sektor, kontakt, notatka, www, miasto/kraj.
  2. **Branding** — kolory (primary/accent/ink, color-picker + hex input), 4 sloty logo (poziome light/dark, pionowe light/dark), favicon. Każdy slot ma upload (Supabase Storage) + preview na 4 kaflach: białe tło, jasne tło marki, ciemne tło, tło marki (primary). Podgląd „na żywo" nagłówka strony publicznej z użyciem wybranych kolorów i logo.
  3. **Miejsca** — istniejący `SeatManager`, przeniesiony bez zmian logiki.
  4. **Audit** — created_at, updated_at, ostatnie zmiany (read-only).

## UI / styl

- Kontenery `max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6`, karty `rounded-xl border bg-card`, nagłówki `text-lg font-semibold`, labelki `text-xs uppercase tracking-wide text-muted-foreground`, inputy `h-9 text-sm`. Zero dialogów.
- Grid dwukolumnowy `md:grid-cols-[1fr,320px]` — lewo formularz, prawo sticky preview brandingu.
- Tokeny wyłącznie z design systemu (`bg-background/foreground/primary/accent/muted`) — brak hardkodowanych kolorów.

## Preview brandingu (komponent `OrgBrandPreview`)

- 4 kafle 2×2 z etykietami: „Białe tło", „Tło marki", „Ciemne tło", „Tło akcentu". Renderują wybrane logo (poziome domyślnie, pionowe w drugiej sekcji) z użyciem odpowiedniej wersji (light/dark) zgodnie z tłem.
- Mini-nagłówek pod spodem: pasek `bg-[--brand-primary]` z logo poziomym dark + przykładowym przyciskiem `bg-[--brand-accent]` — pokazuje realny wygląd nagłówka publicznego.
- Wszystko sterowane CSS custom properties ustawianymi na wrapperze (`style={{ ['--brand-primary']: primary }}`) — bez inline any.

## Upload logo

Nowa util `src/lib/admin/org-branding.ts`:

- `uploadOrgAsset(orgId, slot, file): Promise<string>` — wysyła do bucketu `org-branding/${orgId}/${slot}-${timestamp}.${ext}`, zwraca public URL.
- `updateOrgBranding(orgId, patch)` — cienki wrapper na update kolumn brandingu.
- Walidacja typu (svg/png/webp), rozmiar ≤ 2 MB, komunikaty PL/EN.

## i18n

Wszystkie napisy przez lokalny helper `L(pl, en)` (spójnie z resztą modułu) — bez zmian w globalnych plikach i18n.

## Bezpieczeństwo

- Storage bucket `org-branding`: public SELECT, INSERT/UPDATE/DELETE tylko dla `has_role(auth.uid(),'admin')`.
- RLS na `member_organizations` bez zmian; wszystkie mutacje kolumn brandingu przez istniejące admin policies.
- Walidacja MIME i rozmiaru po stronie klienta + hard limit po stronie bucketu.

## Testy

- SQL: migracja + policy check w `supabase/migrations/`.
- Unit: `org-branding.test.ts` (walidacja pliku, budowa ścieżki).
- E2E manualny: utworzenie org na `/new`, upload 4 logo, zmiana kolorów, sprawdzenie preview.

## Deliverable (pliki)

1. `supabase/migrations/<ts>_org_branding.sql` — kolumny + bucket + policy.
2. `src/lib/admin/org-branding.ts` — upload/update util + typy.
3. `src/lib/admin/membership-admin.ts` — rozszerzenie `OrgInput` / patch typu (bez łamania obecnego API).
4. `src/routes/admin.organizations.tsx` — usunięcie dialogu, dodanie linków.
5. `src/routes/admin.organizations.new.tsx` — strona tworzenia.
6. `src/routes/admin.organizations.$id.tsx` — strona edycji z 4 zakładkami.
7. `src/components/admin/organizations/OrgBrandPreview.tsx` — komponent podglądu.
8. `src/components/admin/organizations/OrgBrandingForm.tsx` — formularz kolorów + upload slotów.
9. `src/components/admin/organizations/OrgGeneralForm.tsx` — formularz ogólny (współdzielony z /new).

Po Twojej akceptacji wdrażam całość w jednej iteracji.
