update public.membership_tiers
set benefits = jsonb_build_array(
  jsonb_build_object(
    'pl', 'Jedno miejsce w pełnym cyklu Decision Lab - cztery zamknięte sesje robocze',
    'en', 'One seat in the full Decision Lab cycle - four closed working sessions'
  ),
  jsonb_build_object(
    'pl', 'Raport końcowy z rekomendacjami dla Twojej organizacji',
    'en', 'A closing report with recommendations for your organisation'
  ),
  jsonb_build_object(
    'pl', 'Praca w gronie analityków, praktyków i decydentów prowadzona przez ekspertów New European Strategies',
    'en', 'Work alongside analysts, practitioners and decision-makers, led by New European Strategies experts'
  ),
  jsonb_build_object(
    'pl', 'Materiały robocze, notatki i nagrania z każdej sesji',
    'en', 'Working materials, notes and recordings from every session'
  ),
  jsonb_build_object(
    'pl', 'Faktura wystawiana na organizację, zakup jednorazowy bez subskrypcji',
    'en', 'Invoice issued to the organisation, a one-time purchase with no subscription'
  )
),
updated_at = now()
where key = 'decision_lab'
  and coalesce(jsonb_array_length(coalesce(benefits, '[]'::jsonb)), 0) = 0;