-- Standardize US phone numbers to "(XXX) XXX-XXXX" everywhere. Non-US/unparseable
-- values are left untouched. Idempotent: already-formatted numbers normalize to
-- themselves.
UPDATE users SET phone_number =
  CASE
    WHEN length(regexp_replace(coalesce(phone_number,''), '[^0-9]', '', 'g')) = 10
      THEN '(' || substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 1, 3) || ') ' || substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 4, 3) || '-' || substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 7, 4)
    WHEN length(regexp_replace(coalesce(phone_number,''), '[^0-9]', '', 'g')) = 11 AND regexp_replace(phone_number, '[^0-9]', '', 'g') LIKE '1%'
      THEN '(' || substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 2, 3) || ') ' || substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 5, 3) || '-' || substr(regexp_replace(phone_number, '[^0-9]', '', 'g'), 8, 4)
    ELSE phone_number
  END
WHERE phone_number IS NOT NULL AND phone_number <> '';
UPDATE wholesale_customers SET phone =
  CASE
    WHEN length(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g')) = 10
      THEN '(' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 1, 3) || ') ' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 4, 3) || '-' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 7, 4)
    WHEN length(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g')) = 11 AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE '1%'
      THEN '(' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 2, 3) || ') ' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 5, 3) || '-' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 8, 4)
    ELSE phone
  END
WHERE phone IS NOT NULL AND phone <> '';
UPDATE wholesale_locations SET contact_phone =
  CASE
    WHEN length(regexp_replace(coalesce(contact_phone,''), '[^0-9]', '', 'g')) = 10
      THEN '(' || substr(regexp_replace(contact_phone, '[^0-9]', '', 'g'), 1, 3) || ') ' || substr(regexp_replace(contact_phone, '[^0-9]', '', 'g'), 4, 3) || '-' || substr(regexp_replace(contact_phone, '[^0-9]', '', 'g'), 7, 4)
    WHEN length(regexp_replace(coalesce(contact_phone,''), '[^0-9]', '', 'g')) = 11 AND regexp_replace(contact_phone, '[^0-9]', '', 'g') LIKE '1%'
      THEN '(' || substr(regexp_replace(contact_phone, '[^0-9]', '', 'g'), 2, 3) || ') ' || substr(regexp_replace(contact_phone, '[^0-9]', '', 'g'), 5, 3) || '-' || substr(regexp_replace(contact_phone, '[^0-9]', '', 'g'), 8, 4)
    ELSE contact_phone
  END
WHERE contact_phone IS NOT NULL AND contact_phone <> '';
UPDATE retail_orders SET customer_phone =
  CASE
    WHEN length(regexp_replace(coalesce(customer_phone,''), '[^0-9]', '', 'g')) = 10
      THEN '(' || substr(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 1, 3) || ') ' || substr(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 4, 3) || '-' || substr(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 7, 4)
    WHEN length(regexp_replace(coalesce(customer_phone,''), '[^0-9]', '', 'g')) = 11 AND regexp_replace(customer_phone, '[^0-9]', '', 'g') LIKE '1%'
      THEN '(' || substr(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 2, 3) || ') ' || substr(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 5, 3) || '-' || substr(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 8, 4)
    ELSE customer_phone
  END
WHERE customer_phone IS NOT NULL AND customer_phone <> '';
UPDATE retail_subscriptions SET customer_phone =
  CASE
    WHEN length(regexp_replace(coalesce(customer_phone,''), '[^0-9]', '', 'g')) = 10
      THEN '(' || substr(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 1, 3) || ') ' || substr(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 4, 3) || '-' || substr(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 7, 4)
    WHEN length(regexp_replace(coalesce(customer_phone,''), '[^0-9]', '', 'g')) = 11 AND regexp_replace(customer_phone, '[^0-9]', '', 'g') LIKE '1%'
      THEN '(' || substr(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 2, 3) || ') ' || substr(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 5, 3) || '-' || substr(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 8, 4)
    ELSE customer_phone
  END
WHERE customer_phone IS NOT NULL AND customer_phone <> '';
UPDATE leads SET phone =
  CASE
    WHEN length(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g')) = 10
      THEN '(' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 1, 3) || ') ' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 4, 3) || '-' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 7, 4)
    WHEN length(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g')) = 11 AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE '1%'
      THEN '(' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 2, 3) || ') ' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 5, 3) || '-' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 8, 4)
    ELSE phone
  END
WHERE phone IS NOT NULL AND phone <> '';
