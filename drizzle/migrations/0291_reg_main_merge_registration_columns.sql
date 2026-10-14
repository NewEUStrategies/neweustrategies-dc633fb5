DO $grants$
DECLARE
  v_spec record;
  v_cols text;
  v_private text;
BEGIN
  FOR v_spec IN
    SELECT *
      FROM (VALUES
        ('public.event_registrations'::regclass,
         ARRAY['decision_note', 'submitted_profile', 'manage_token_hash', 'qr_token_hash',
               'decided_by', 'cancel_reason',
               'paid_amount_recorded_by',
               'badge_token_hash']),
        ('public.event_people'::regclass, ARRAY['notes'])
      ) AS t(rel, private_cols)
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
            FILTER (WHERE NOT a.attname = ANY (v_spec.private_cols)),
           string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
            FILTER (WHERE a.attname = ANY (v_spec.private_cols))
      INTO v_cols, v_private
      FROM pg_attribute a
     WHERE a.attrelid = v_spec.rel
       AND a.attnum > 0
       AND NOT a.attisdropped;

    EXECUTE format('REVOKE SELECT ON %s FROM authenticated', v_spec.rel);
    EXECUTE format('GRANT SELECT (%s) ON %s TO authenticated', v_cols, v_spec.rel);
    IF v_private IS NOT NULL THEN
      EXECUTE format('REVOKE SELECT (%s) ON %s FROM authenticated, anon', v_private, v_spec.rel);
    END IF;
  END LOOP;
END
$grants$;

COMMENT ON TABLE public.event_registrations IS
  'Zapis osoby na wydarzenie: osiem stanow cyklu zycia, tryb zapisu, bilet, grupa, odpowiedzi formularza, slad decyzji i HASZ tokenu QR. Jeden aktywny zapis na osobe i wydarzenie. REG-06 (D10): authenticated ma SELECT KOLUMNOWY - bez decision_note, submitted_profile, manage_token_hash, qr_token_hash (20261012170200), decided_by i cancel_reason (20261012181500) oraz paid_amount_recorded_by i badge_token_hash (20261013900600). Kolumna dodana pozniej jest PRYWATNA, dopoki jej migracja nie nada jawnie GRANT SELECT (kolumna) TO authenticated.';