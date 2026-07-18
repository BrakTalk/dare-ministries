// GET /api/impact-stats — powers the animated impact counter on the site.
import { getDatabase } from '@netlify/database';
import { json } from './lib/helpers.mjs';

export const config = { path: '/api/impact-stats' };

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const db = getDatabase();
  const rows = await db.sql`SELECT * FROM impact_stats WHERE id = 1`;
  if (!rows.length) return json({ error: 'Not found' }, 404);

  return json(rows[0], 200, {
    // Stats change rarely; let Netlify's CDN cache them for an hour.
    'Cache-Control': 'public, max-age=300, s-maxage=3600',
  });
};
