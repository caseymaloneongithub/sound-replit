-- Store-first ordering: the visitor's chosen delivery location rides the sign-in email.
ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS claim_location_id varchar;
