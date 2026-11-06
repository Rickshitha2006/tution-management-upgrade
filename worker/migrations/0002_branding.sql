-- Adds tuition branding (logo) and signature fields to the per-user
-- settings row. Purely additive — existing rows get NULL for these new
-- columns, which the app treats the same as "no logo/signature uploaded
-- yet" (see settingsToApi in src/index.js and js/settings.js).
--
-- Images are stored as base64 data: URLs (already resized/compressed to
-- a few hundred KB max by js/image-processing.js on the client before
-- upload), scoped per user_id like every other row in this table — never
-- shared between accounts.

ALTER TABLE settings ADD COLUMN logo_data TEXT;
ALTER TABLE settings ADD COLUMN head_name TEXT;
ALTER TABLE settings ADD COLUMN head_signature_data TEXT;
ALTER TABLE settings ADD COLUMN staff_signature_data TEXT;
