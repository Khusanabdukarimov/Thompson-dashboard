const { Router } = require('express');
const pool = require('../db/pool');
const { syncDealStagesFromBitrix } = require('../services/stageResolver');

const router = Router();

// POST /api/reja/sync-stages  — one-time manual fix for is_won flags
router.post('/sync-stages', async (_req, res) => {
  try {
    await syncDealStagesFromBitrix();
    res.json({ ok: true, message: 'stages synced from Bitrix' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reja/debug-stages  — show current stages table state
router.get('/debug-stages', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.bitrix_id, s.name, s.is_won, s.is_final,
             COUNT(d.id)::int AS deal_count
      FROM stages s
      LEFT JOIN deals d ON d.stage_id = s.id
      WHERE s.entity = 'deal'
      GROUP BY s.id, s.bitrix_id, s.name, s.is_won, s.is_final
      ORDER BY deal_count DESC
    `);
    const won = rows.filter(r => r.is_won);
    const notWon = rows.filter(r => !r.is_won);
    res.json({
      total_stages: rows.length,
      won_stages: won,
      not_won_stages: notWon,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Schema (runs once at module load via index.js startup hook) ────
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reja_plans (
      id           SERIAL PRIMARY KEY,
      name         TEXT,
      period_type  TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly')),
      period_start DATE NOT NULL,
      period_end   DATE NOT NULL,
      total_target NUMERIC(15,2) NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reja_targets (
      id             SERIAL PRIMARY KEY,
      plan_id        INTEGER NOT NULL REFERENCES reja_plans(id) ON DELETE CASCADE,
      responsible_id INTEGER NOT NULL REFERENCES responsibles(id),
      target         NUMERIC(15,2) NOT NULL DEFAULT 0,
      UNIQUE(plan_id, responsible_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS reja_targets_plan_idx ON reja_targets(plan_id)`);
}

// ── Helper: fetch a plan enriched with aggregate columns ──────────
// Used after INSERT/UPDATE so the returned object matches RejaPlan fully.
async function fetchEnrichedPlan(id) {
  const { rows } = await pool.query(`
    SELECT
      p.*,
      COUNT(DISTINCT t.responsible_id)::int  AS employee_count,
      COALESCE(SUM(t.target), 0)::numeric    AS distributed_total
    FROM reja_plans p
    LEFT JOIN reja_targets t ON t.plan_id = p.id
    WHERE p.id = $1
    GROUP BY p.id
  `, [id]);
  return rows[0] || null;
}

// ── Sub-period generation ─────────────────────────────────────────
const MONTH_NAMES_UZ = [
  'Yanvar','Fevral','Mart','Aprel','May','Iyun',
  'Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr',
];

function pad(n) { return String(n).padStart(2, '0'); }

function localISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getSubperiods(plan) {
  const start = new Date(plan.period_start);

  if (plan.period_type === 'monthly') {
    const y       = start.getFullYear();
    const m       = start.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    return [
      { index: 1, start: `${y}-${pad(m+1)}-01`, end: `${y}-${pad(m+1)}-07`,          label: '1-hafta' },
      { index: 2, start: `${y}-${pad(m+1)}-08`, end: `${y}-${pad(m+1)}-14`,          label: '2-hafta' },
      { index: 3, start: `${y}-${pad(m+1)}-15`, end: `${y}-${pad(m+1)}-21`,          label: '3-hafta' },
      { index: 4, start: `${y}-${pad(m+1)}-22`, end: `${y}-${pad(m+1)}-${pad(lastDay)}`, label: '4-hafta' },
    ];
  }

  // quarterly → 3 calendar months
  const result = [];
  for (let i = 0; i < 3; i++) {
    const mStart = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const mEnd   = new Date(start.getFullYear(), start.getMonth() + i + 1, 0);
    result.push({
      index: i + 1,
      start: localISO(mStart),
      end:   localISO(mEnd),
      label: MONTH_NAMES_UZ[mStart.getMonth()],
    });
  }
  return result;
}

// ── Dynamic recalculation (core business logic) ───────────────────
//
// Rule: after each completed sub-period the remaining target is
//   remainingTarget = totalTarget - sum(past actuals)
// and that remaining amount is split equally across remaining sub-periods.
//
// Example (monthly, 4 weeks, target 50 000):
//   base/week = 12 500
//   week 1 actual = 10 000  →  remaining = 40 000 / 3 = 13 333.33
//   week 2 actual = 20 000  →  remaining = 20 000 / 2 = 10 000
//
function computeSubperiodProgress(totalTarget, subperiods, actualsMap, today) {
  const todayStr   = localISO(today);
  const n          = subperiods.length;
  const baseTarget = n > 0 ? totalTarget / n : 0;

  // Split into fully-completed past vs current+future remaining
  const past      = subperiods.filter(sp => sp.end < todayStr);
  const remaining = subperiods.filter(sp => sp.end >= todayStr);

  const sumPastActuals  = past.reduce((s, sp) => s + (actualsMap[sp.index] || 0), 0);
  const remainingTarget = totalTarget - sumPastActuals;
  const recalcTarget    = remaining.length > 0 ? remainingTarget / remaining.length : 0;

  return subperiods.map(sp => {
    const isPast    = sp.end < todayStr;
    const isCurrent = sp.start <= todayStr && todayStr <= sp.end;
    const actual    = actualsMap[sp.index] || 0;
    const target    = isPast ? baseTarget : recalcTarget;
    const pct       = target > 0 ? Math.min(Math.round(actual / target * 100), 999) : 0;
    return {
      ...sp,
      target:    Math.round(target * 100) / 100,
      actual:    Math.round(actual  * 100) / 100,
      isPast,
      isCurrent,
      pct,
    };
  });
}

// ══════════════════════════════════════════════════════════════════
// Routes
// ══════════════════════════════════════════════════════════════════

// GET /api/reja/plans
// Returns all plans, enriched with employee_count + distributed_total.
router.get('/plans', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.*,
        COUNT(DISTINCT t.responsible_id)::int  AS employee_count,
        COALESCE(SUM(t.target), 0)::numeric    AS distributed_total
      FROM reja_plans p
      LEFT JOIN reja_targets t ON t.plan_id = p.id
      GROUP BY p.id
      ORDER BY p.period_start DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('[reja/plans GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reja/plans
// Body: { name?, period_type, period_start, period_end, total_target }
// Returns the enriched plan (matches RejaPlan type fully).
router.post('/plans', async (req, res) => {
  const { name, period_type, period_start, period_end, total_target } = req.body;
  if (!period_type || !period_start || !period_end)
    return res.status(400).json({ error: 'period_type, period_start, period_end required' });

  try {
    const insertRes = await pool.query(
      `INSERT INTO reja_plans (name, period_type, period_start, period_end, total_target)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [name || null, period_type, period_start, period_end, total_target || 0]
    );
    const plan = await fetchEnrichedPlan(insertRes.rows[0].id);
    res.status(201).json(plan);
  } catch (err) {
    console.error('[reja/plans POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/reja/plans/:id
// Body: { name?, total_target?, period_start?, period_end? }
// Returns the enriched plan.
router.put('/plans/:id', async (req, res) => {
  const id   = parseInt(req.params.id);
  const body = req.body;
  const sets = [];
  const vals = [];
  let   i    = 1;

  if (body.name         !== undefined) { sets.push(`name = $${i++}`);         vals.push(body.name); }
  if (body.total_target !== undefined) { sets.push(`total_target = $${i++}`); vals.push(body.total_target); }
  if (body.period_start !== undefined) { sets.push(`period_start = $${i++}`); vals.push(body.period_start); }
  if (body.period_end   !== undefined) { sets.push(`period_end = $${i++}`);   vals.push(body.period_end); }

  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  sets.push('updated_at = NOW()');
  vals.push(id);

  try {
    const { rowCount } = await pool.query(
      `UPDATE reja_plans SET ${sets.join(', ')} WHERE id = $${i}`,
      vals
    );
    if (!rowCount) return res.status(404).json({ error: 'Plan not found' });
    const plan = await fetchEnrichedPlan(id);
    res.json(plan);
  } catch (err) {
    console.error('[reja/plans PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/reja/plans/:id
router.delete('/plans/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM reja_plans WHERE id = $1', [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[reja/plans DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reja/plans/:id/distribution
// Returns all responsibles with their target AND actual won-deal sales for the plan period.
// active = false → ON LEAVE badge.
router.get('/plans/:id/distribution', async (req, res) => {
  const planId = parseInt(req.params.id);
  try {
    const planRes = await pool.query(`
      SELECT
        p.*,
        COUNT(DISTINCT t.responsible_id)::int  AS employee_count,
        COALESCE(SUM(t.target), 0)::numeric    AS distributed_total
      FROM reja_plans p
      LEFT JOIN reja_targets t ON t.plan_id = p.id
      WHERE p.id = $1
      GROUP BY p.id
    `, [planId]);

    if (!planRes.rows.length) return res.status(404).json({ error: 'Plan not found' });
    const plan = planRes.rows[0];

    // All responsibles with their targets.
    // Sort: assigned (target > 0) first, then by name.
    const empRes = await pool.query(`
      SELECT
        r.id                                                          AS responsible_id,
        TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS full_name,
        r.work_position,
        r.active,
        r.photo_url,
        COALESCE(t.target, 0)::numeric                               AS target
      FROM responsibles r
      LEFT JOIN reja_targets t
        ON  t.plan_id        = $1
        AND t.responsible_id = r.id
      WHERE r.active = TRUE
        AND (
          r.work_position ILIKE '%hunter%'
          OR r.work_position ILIKE '%closer%'
          OR t.target > 0
        )
      ORDER BY COALESCE(t.target, 0) DESC, r.name, r.last_name
    `, [planId]);

    // Actual won-deal sales per responsible for the plan period.
    const allIds = empRes.rows.map(r => r.responsible_id);
    const actualsRes = allIds.length ? await pool.query(`
      SELECT
        d.responsible_id,
        COALESCE(SUM(d.opportunity), 0)::numeric AS actual_sales,
        COUNT(*)::int                             AS deal_count
      FROM deals d
      JOIN stages s ON s.id = d.stage_id AND s.is_won = TRUE
      WHERE d.responsible_id = ANY($1)
        AND COALESCE(d.date_modify, d.date_create)::date BETWEEN $2 AND $3
      GROUP BY d.responsible_id
    `, [allIds, plan.period_start, plan.period_end]) : { rows: [] };

    const actualsMap = {};
    for (const row of actualsRes.rows) {
      actualsMap[row.responsible_id] = {
        actual_sales: Math.round(parseFloat(row.actual_sales) * 100) / 100,
        deal_count:   row.deal_count,
      };
    }

    const employees = empRes.rows.map(r => ({
      ...r,
      actual_sales: actualsMap[r.responsible_id]?.actual_sales ?? 0,
      deal_count:   actualsMap[r.responsible_id]?.deal_count   ?? 0,
    }));

    res.json({ plan, employees });
  } catch (err) {
    console.error('[reja/distribution GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reja/plans/:id/distribution
// Body: { targets: [{ responsible_id, target }] }
// Full replace: deletes old targets and inserts new ones in one transaction.
router.post('/plans/:id/distribution', async (req, res) => {
  const planId = parseInt(req.params.id);
  const { targets } = req.body;
  if (!Array.isArray(targets)) return res.status(400).json({ error: 'targets[] required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Remove all existing targets for this plan
    await client.query('DELETE FROM reja_targets WHERE plan_id = $1', [planId]);

    // Insert only rows with a positive target
    for (const t of targets) {
      const amt = parseFloat(t.target) || 0;
      if (amt > 0) {
        await client.query(
          `INSERT INTO reja_targets (plan_id, responsible_id, target)
           VALUES ($1, $2, $3)
           ON CONFLICT (plan_id, responsible_id) DO UPDATE SET target = EXCLUDED.target`,
          [planId, t.responsible_id, amt]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[reja/distribution POST]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/reja/plans/:id/progress
// Returns per-sub-period targets (with dynamic recalculation) and actuals
// sourced from CRM won deals closed within the plan period.
router.get('/plans/:id/progress', async (req, res) => {
  const planId = parseInt(req.params.id);
  try {
    const planRes = await pool.query(`
      SELECT
        p.*,
        COUNT(DISTINCT t.responsible_id)::int  AS employee_count,
        COALESCE(SUM(t.target), 0)::numeric    AS distributed_total
      FROM reja_plans p
      LEFT JOIN reja_targets t ON t.plan_id = p.id
      WHERE p.id = $1
      GROUP BY p.id
    `, [planId]);

    if (!planRes.rows.length) return res.status(404).json({ error: 'Plan not found' });
    const plan = planRes.rows[0];

    const subperiods = getSubperiods(plan);
    const today      = new Date();

    // Employees who have a target in this plan, ordered by target desc
    const targetsRes = await pool.query(`
      SELECT
        t.responsible_id,
        t.target::numeric                                              AS target,
        TRIM(COALESCE(r.name,'') || ' ' || COALESCE(r.last_name,'')) AS full_name,
        r.work_position,
        r.photo_url,
        r.active
      FROM reja_targets t
      JOIN responsibles r ON r.id = t.responsible_id
      WHERE t.plan_id = $1
      ORDER BY t.target DESC, r.name
    `, [planId]);

    if (!targetsRes.rows.length) {
      return res.json({
        plan,
        subperiods: subperiods.map(({ index, label, start, end }) => ({ index, label, start, end })),
        employees: [],
        summary: { total_target: 0, total_actual: 0, pct: 0 },
      });
    }

    const respIds = targetsRes.rows.map(r => r.responsible_id);

    // Actuals: sum of won-deal opportunities, grouped by responsible + win date.
    // Uses date_modify (updated when deal moves to won stage) as the win date.
    // ::text cast ensures node-postgres returns a plain string (not a Date object)
    // so JS string comparison against sp.start/sp.end works correctly.
    const actualsRes = await pool.query(`
      SELECT
        d.responsible_id,
        COALESCE(d.date_modify, d.date_create)::date::text AS close_date,
        SUM(d.opportunity)::numeric                        AS amount
      FROM deals d
      JOIN stages s ON s.id = d.stage_id AND s.is_won = TRUE
      WHERE d.responsible_id = ANY($1)
        AND COALESCE(d.date_modify, d.date_create)::date BETWEEN $2 AND $3
      GROUP BY d.responsible_id, COALESCE(d.date_modify, d.date_create)::date
    `, [respIds, plan.period_start, plan.period_end]);

    // Build actuals map: { responsible_id: { subperiod_index: total_amount } }
    const actualsByResp = {};
    for (const row of actualsRes.rows) {
      if (!actualsByResp[row.responsible_id]) actualsByResp[row.responsible_id] = {};
      for (const sp of subperiods) {
        if (row.close_date >= sp.start && row.close_date <= sp.end) {
          actualsByResp[row.responsible_id][sp.index] =
            (actualsByResp[row.responsible_id][sp.index] || 0) + parseFloat(row.amount);
          break;
        }
      }
    }

    const employees = targetsRes.rows.map(emp => {
      const empActuals  = actualsByResp[emp.responsible_id] || {};
      const totalActual = Object.values(empActuals).reduce((s, v) => s + v, 0);
      const target      = parseFloat(emp.target);
      return {
        responsible_id: emp.responsible_id,
        full_name:      emp.full_name,
        work_position:  emp.work_position,
        photo_url:      emp.photo_url,
        active:         emp.active,
        target,
        total_actual:   Math.round(totalActual * 100) / 100,
        pct:            target > 0 ? Math.min(Math.round(totalActual / target * 100), 999) : 0,
        subperiods:     computeSubperiodProgress(target, subperiods, empActuals, today),
      };
    });

    const totalTarget = employees.reduce((s, e) => s + e.target,       0);
    const totalActual = employees.reduce((s, e) => s + e.total_actual,  0);

    res.json({
      plan,
      subperiods: subperiods.map(({ index, label, start, end }) => ({ index, label, start, end })),
      employees,
      summary: {
        total_target: Math.round(totalTarget * 100) / 100,
        total_actual: Math.round(totalActual * 100) / 100,
        pct: totalTarget > 0 ? Math.min(Math.round(totalActual / totalTarget * 100), 999) : 0,
      },
    });
  } catch (err) {
    console.error('[reja/progress GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, ensureSchema };
