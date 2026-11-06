-- Visiting / part-time staff (e.g. a subject teacher who comes 1-2 days a week).
-- Purely additive: existing staff stay "monthly" and behave exactly as before.
ALTER TABLE staff ADD COLUMN pay_type TEXT NOT NULL DEFAULT 'monthly';     -- 'monthly' | 'visiting'
ALTER TABLE staff ADD COLUMN visit_days TEXT NOT NULL DEFAULT '';          -- weekday numbers, e.g. '2,4' (0 = Sunday ... 6 = Saturday)
ALTER TABLE staff ADD COLUMN pay_model TEXT NOT NULL DEFAULT 'per_visit';  -- visiting only: 'per_visit' | 'fixed'
ALTER TABLE staff ADD COLUMN visit_rate REAL NOT NULL DEFAULT 0;           -- amount paid per visit (per_visit model)

-- Which pay rule a saved salary row was calculated with, so paid months stay frozen.
ALTER TABLE staff_payroll ADD COLUMN pay_basis TEXT NOT NULL DEFAULT 'monthly'; -- 'monthly' | 'per_visit' | 'fixed_visits'
