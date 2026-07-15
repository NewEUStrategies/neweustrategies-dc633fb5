
## Cel

Na podstawie 53 widgetów `team-member` na `/o-nas`:
1. Utworzyć konta użytkowników (`auth.users`) z rolą `author` dla każdej osoby.
2. Utworzyć profile prywatne (`profiles`) i publiczne profile eksperckie (`author_profiles`) - hydracja z widgetu (imię, e-mail, telefon, zdjęcie, bio PL/EN, stanowisko, funkcja, socials).
3. Powiązać widgety w builderze z profilami (dopisać `authorSlug` do `content` widgetu → link "Zobacz pełny profil").
4. Panel wysyłki zaproszeń w `/admin/users` (modal + zakładka `/admin/users/invitations`) z wyborem trybu per zaproszenie.

## Architektura

### Backend (Supabase)

Nowa tabela `public.user_invitations`:
- `email`, `display_name`, `role app_role`, `tenant_id`
- `mode` enum: `magic_link` | `temp_password`
- `status` enum: `pending` | `sent` | `accepted` | `revoked` | `failed`
- `invited_by`, `sent_at`, `accepted_at`, `expires_at`
- `source` (np. `team_import:o-nas`), `metadata jsonb` (widget id, bio, photo, itp.)
- `auth_user_id` (po utworzeniu konta)
- GRANT dla `authenticated` + `service_role`; RLS: tylko admin/super_admin tenanta może SELECT/INSERT/UPDATE, każdy zalogowany może SELECT swojego (po email).

### Server functions (`src/lib/admin/invitations.functions.ts`)

Wszystkie chronione `requireSupabaseAuth` + weryfikacja `has_role(admin|super_admin)`:

- `previewTeamImport({ pageSlug })` - parsuje `builder_data`, wyciąga `team-member` widgety, deduplikuje po e-mailu, zwraca listę kandydatów (`email`, `name`, `position`, `bio_pl`, `bio_en`, `photo`, `phone`, socials, `programLabel` → mapowanie na przyszłe funkcje) + informację, czy user o takim e-mailu już istnieje.
- `createInvitations({ items, mode, role })` - masowe utworzenie rekordów `user_invitations` (status: `pending`).
- `sendInvitation({ id })` - wywołuje `supabaseAdmin.auth.admin.inviteUserByEmail` (magic link) lub `createUser` z tymczasowym hasłem (`crypto.randomBytes` → base32), zapisuje `auth_user_id`, `profiles`, `author_profiles`, `user_roles`, wysyła mail (dla trybu temp_password używa istniejącej infrastruktury `email_domain` - queue). Zapisuje `sent_at`.
- `sendInvitationsBulk({ ids })` - orkiestruje wysyłkę w batchach z rate-limit.
- `revokeInvitation({ id })` / `resendInvitation({ id })`.
- `linkTeamWidgetsToProfiles({ pageSlug })` - po utworzeniu profili przechodzi `builder_data`, dopisuje `content.authorSlug` + `content.authorUserId` do wszystkich widgetów `team-member` matchowanych po e-mailu, zapisuje stronę i tworzy revision.

### Profile hydration

Po `inviteUserByEmail`/`createUser`:
- `INSERT INTO profiles` (id=auth.uid, tenant_id, display_name, slug=slugify(name), avatar_url=photo, bio_pl, bio_en).
- `INSERT INTO author_profiles` (user_id, job_title=position_pl/en, org_functions=[{pl:programLabel_pl, en:programLabel_en}], full_bio_pl/en, contact_email/phone, linkedin/x/website, is_public=true).
- `INSERT INTO user_roles` (user_id, role='author').
- `INSERT INTO profile_badges` (badge='expert') - opcjonalne per wybór admina.

### UI

`/admin/users/index.tsx` - dodać przyciski:
- "Zaproś użytkownika" → `<InviteUserDialog />` (pojedyncze zaproszenie, wybór trybu).
- "Zaimportuj zespół z /o-nas" → `<TeamImportDialog />` z preview tabelą (checkbox per osoba, wybór trybu globalnie lub per wiersz, wybór roli, "Powiąż widgety w builderze" toggle).

Nowa trasa `src/routes/admin.users.invitations.tsx` - lista `user_invitations` z filtrami (status, source, mode), akcje: resend / revoke / view details. Kolumny: e-mail, imię, rola, tryb, status, wysłano, source.

Komponenty:
- `src/components/admin/users/InviteUserDialog.tsx`
- `src/components/admin/users/TeamImportDialog.tsx`
- `src/components/admin/users/InvitationRow.tsx`
- `src/lib/admin/inviteMode.ts` - enum + i18n labels.

### Widget link

`TeamMemberWidget.tsx` już umie renderować link „Zobacz pełny profil eksperta" gdy `authorSlug` jest ustawiony (dodane w poprzedniej iteracji). `linkTeamWidgetsToProfiles` uzupełnia to pole automatycznie. Editor widgetu też pokazuje status "Powiązany z: <slug>".

### Email

Auth invite (magic_link): `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: <origin>/auth/set-password, data: { display_name } })` - używa domyślnego szablonu Supabase Auth (tenant ma już `email_domain` skonfigurowany).

Temp password: własna server-fn generuje hasło, tworzy usera `createUser({ email, password, email_confirm: true })`, wysyła transakcyjny email z loginem + hasłem + linkiem do `/auth?email=…` przez istniejącą kolejkę `transactional_emails` (rendered React Email template `TeamInviteCredentialsEmail`).

### i18n

Wszystkie nowe stringi w `src/lib/i18n-*.ts` (PL + EN): `admin.users.invite.*`, `admin.users.import.*`, `admin.users.invitations.*`.

## Kroki wdrożenia

1. Migracja: enum `invitation_mode`, `invitation_status`, tabela `user_invitations` + GRANT + RLS + trigger `updated_at`.
2. Server functions (`invitations.functions.ts` + helper `.server.ts` dla admin/email/slug).
3. React Email template `TeamInviteCredentialsEmail` + rejestracja w kolejce.
4. Komponenty UI (`InviteUserDialog`, `TeamImportDialog`, `InvitationRow`).
5. Trasa `/admin/users/invitations`.
6. Podpięcie w `/admin/users` (przyciski + lazy dialogi).
7. i18n PL/EN.
8. Testy: `invitations.functions.test.ts` (parsing widgetów, dedup, walidacja e-maila, mapowanie na profile).

## Punkty do potwierdzenia

- Wysyłka domyślnie **nie startuje** automatycznie po imporcie - admin zaznacza wiersze i klika "Wyślij zaproszenia" (bezpiecznik przy 53 mailach jednorazowo). OK?
- Wygenerowane hasła tymczasowe wymuszają zmianę hasła przy pierwszym logowaniu (flag w `profiles.metadata`).
