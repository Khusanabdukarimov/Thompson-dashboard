-- Fix all lead dates from Bitrix export
-- Uses temp table + COPY for speed (runs in ~2 seconds instead of minutes)

BEGIN;

CREATE TEMP TABLE tmp_dates (
    id INT,
    date_created TIMESTAMP,
    date_modified TIMESTAMP
);

-- Load the TSV data
\copy tmp_dates FROM 'lead_dates.tsv'

-- Update existing leads
UPDATE leads l
SET date_create  = t.date_created,
    date_modify  = t.date_modified
FROM tmp_dates t
WHERE l.id = t.id;

-- Report: how many were updated
SELECT COUNT(*) AS updated FROM leads l
JOIN tmp_dates t ON l.id = t.id;

-- Report: IDs in Bitrix but missing from DB
SELECT t.id AS missing_id, t.date_created 
FROM tmp_dates t
LEFT JOIN leads l ON l.id = t.id
WHERE l.id IS NULL
ORDER BY t.id DESC;

DROP TABLE tmp_dates;

COMMIT;
