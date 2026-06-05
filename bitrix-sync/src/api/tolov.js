const { Router } = require('express');
const pool = require('../db/pool');

const router = Router();

// Ensure table exists on startup
pool.query(`
  CREATE TABLE IF NOT EXISTS payments (
    id         SERIAL PRIMARY KEY,
    sana       TIMESTAMPTZ NOT NULL,
    turi       TEXT NOT NULL,
    summa      NUMERIC(14,2) NOT NULL,
    valyuta    TEXT NOT NULL DEFAULT 'UZS',
    izoh       TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS payments_sana_idx ON payments(sana);
`).catch(err => console.error('[tolov] table init failed:', err.message));

/**
 * POST /tolov?sana=03.06.2026+16:42:00&turi=Hisob&summa=200|USD
 * Records a payment. Used by Telegram bot.
 * summa format: "200|USD" or "200" (defaults to UZS)
 */
router.post('/', async (req, res) => {
  try {
    let { sana, turi, summa, izoh } = { ...req.query, ...req.body };

    if (!sana || !turi || !summa) {
      return res.status(400).json({ error: 'sana, turi, summa majburiy' });
    }

    // Parse sana — "03.06.2026 16:42:00" or "03.06.2026+16:42:00" (+ is space in URL)
    const sanaNorm = String(sana).replace('+', ' ').trim();
    // Convert "DD.MM.YYYY HH:MM:SS" → ISO
    let sanaISO;
    const m = sanaNorm.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)$/);
    if (m) {
      sanaISO = `${m[3]}-${m[2]}-${m[1]}T${m[4]}`;
    } else {
      sanaISO = sanaNorm; // hope it's parseable
    }

    // Parse summa — "200|USD" or "200|UZS" or just "200"
    let amount, valyuta;
    const parts = String(summa).split('|');
    amount  = parseFloat(parts[0].replace(/\s/g, '').replace(',', '.'));
    valyuta = parts[1] ? parts[1].toUpperCase().trim() : 'UZS';

    if (isNaN(amount)) {
      return res.status(400).json({ error: `Noto'g'ri summa: ${summa}` });
    }

    const { rows } = await pool.query(
      `INSERT INTO payments (sana, turi, summa, valyuta, izoh)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, sana, turi, summa, valyuta`,
      [sanaISO, String(turi).trim(), amount, valyuta, izoh || null]
    );

    console.log(`[tolov] Saved: id=${rows[0].id} sana=${rows[0].sana} turi=${rows[0].turi} summa=${rows[0].summa} ${rows[0].valyuta}`);
    res.json({ ok: true, payment: rows[0] });
  } catch (err) {
    console.error('[tolov] POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tolov/list?from=&to=&turi=&valyuta=&page=&limit=
 */
router.get('/list', async (req, res) => {
  try {
    const { from, to, turi, valyuta, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = [];
    const params = [];
    let pi = 1;

    if (from) { conditions.push(`sana::date >= $${pi++}::date`); params.push(from); }
    if (to)   { conditions.push(`sana::date <= $${pi++}::date`); params.push(to); }
    if (turi) { conditions.push(`turi ILIKE $${pi++}`); params.push(`%${turi}%`); }
    if (valyuta) { conditions.push(`valyuta = $${pi++}`); params.push(valyuta.toUpperCase()); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT id, sana, turi, summa, valyuta, izoh, created_at
         FROM payments ${where}
         ORDER BY sana DESC
         LIMIT $${pi++} OFFSET $${pi++}`,
        [...params, parseInt(limit), offset]
      ),
      pool.query(`SELECT COUNT(*) AS total FROM payments ${where}`, params),
    ]);

    res.json({
      total: parseInt(countRes.rows[0].total),
      page: parseInt(page),
      limit: parseInt(limit),
      items: dataRes.rows,
    });
  } catch (err) {
    console.error('[tolov] GET /list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tolov/stats?from=&to=
 * Returns totals grouped by turi and valyuta.
 */
router.get('/stats', async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [];
    let pi = 1;
    const cond = [];
    if (from) { cond.push(`sana::date >= $${pi++}::date`); params.push(from); }
    if (to)   { cond.push(`sana::date <= $${pi++}::date`); params.push(to); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

    const [byTuri, byDay] = await Promise.all([
      pool.query(
        `SELECT turi, valyuta, COUNT(*) AS cnt, SUM(summa) AS jami
         FROM payments ${where}
         GROUP BY turi, valyuta ORDER BY jami DESC`,
        params
      ),
      pool.query(
        `SELECT sana::date AS kun, valyuta, SUM(summa) AS jami
         FROM payments ${where}
         GROUP BY kun, valyuta ORDER BY kun DESC`,
        params
      ),
    ]);

    res.json({ by_turi: byTuri.rows, by_day: byDay.rows });
  } catch (err) {
    console.error('[tolov] GET /stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/tolov/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM payments WHERE id = $1', [parseInt(id)]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
