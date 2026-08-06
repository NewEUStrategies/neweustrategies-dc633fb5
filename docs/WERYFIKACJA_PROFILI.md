# Proces weryfikacji profili

## Cel
Odznaka „Zweryfikowany” potwierdza, że konto należy do osoby z organizacji o zaufanej
domenie e-mail (m.in. `neweuropeanstrategies.com`, `neweustrategies.com`). Wszyscy
członkowie New European Strategies są weryfikowani automatycznie.

## Ścieżka automatyczna (domyślna)
1. Administrator dodaje domenę w Panel → Społeczność → Odznaki → **Weryfikacja domenowa**.
2. Użytkownik rejestruje się adresem w tej domenie i **potwierdza e-mail**
   (jeśli domena ma włączone „Wymagaj potwierdzenia e-mail”).
3. Trigger `profiles_org_verification_trg` uruchamia `sync_org_verification(user_id)`:
   - nadaje wpis w `profile_badges` (`badge = verified`, `grant_source = system`),
   - ustawia `profiles.verified_at`.
4. Zmiana adresu na spoza zaufanej domeny cofa **wyłącznie** nadania automatyczne
   (`grant_source = system`); nadania ręczne pozostają nietknięte.

## Ścieżka ręczna (wyjątki)
Dla osób bez firmowego adresu (partnerzy, eksperci zewnętrzni): Panel → Społeczność →
Odznaki → **Przyznaj odznakę**, z obowiązkową notatką uzasadniającą (kto/na jakiej
podstawie). Takie nadania mają `grant_source = manual` i są odporne na przeglądy.

## Przegląd zbiorczy
Przycisk **Uruchom przegląd** wywołuje `admin_run_org_verification()` - przechodzi po
wszystkich profilach tenanta, dopina brakujące odznaki i cofa nieaktualne automatyczne.
Zwraca licznik `checked / granted / revoked`. Uruchamiaj po dodaniu nowej domeny lub
po masowym imporcie kont.

## Bezpieczeństwo
- `verification_domains` jest RLS-owane i skalowane per tenant; zapis wyłącznie przez
  RPC SECURITY DEFINER (`admin_upsert_verification_domain`, `admin_delete_verification_domain`).
- `profiles.verified_at` i kolumny uprzywilejowane chroni `profiles_guard_privileged_columns()`;
  zapis przechodzi tylko z flagą `app.verification_sync` ustawianą przez funkcję synchronizującą.
- Sama deklaracja adresu nie wystarcza - liczy się `email_confirmed_at`, co blokuje
  eskalację uprawnień przez rejestrację cudzym adresem.
