INSERT INTO relationship_param (user_id, name, value, baseline, variance, updated_at)
SELECT r.user_id, p.name, p.value, p.value, 0.01, now()
FROM relationship r
CROSS JOIN (VALUES ('affect_valence', 0.5::real), ('afterglow', 0::real)) AS p(name, value)
ON CONFLICT DO NOTHING;
