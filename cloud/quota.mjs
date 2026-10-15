// A single conditional INSERT makes checks + reservation one atomic SQLite write.
// There is no read-then-write gap or process-local counter. Failed provider calls
// remain reserved. Session/IP identity is derived by the server, not by the client.
export async function reserveQuota(db, { kind, subject, ip, now, daily, minute, ipDaily, ipMinute, sessionDaily, units = 1 }) {
  if (!Number.isInteger(units) || units < 1 || units > 12) throw new Error('INVALID_QUOTA_UNITS');
  const dayStart = Math.floor(now / 86400) * 86400;
  const result = await db.prepare(`
    INSERT INTO usage_events (id, kind, subject, ip_hash, created_at)
    SELECT ?1 || '-' || value, ?2, ?3, ?4, ?5 FROM json_each(?13)
    WHERE (SELECT COUNT(*) FROM usage_events WHERE kind = ?2 AND created_at >= ?6) + ?14 <= ?7
      AND (SELECT COUNT(*) FROM usage_events WHERE kind = ?2 AND created_at > ?8) + ?14 <= ?9
      AND (SELECT COUNT(*) FROM usage_events WHERE kind = ?2 AND ip_hash = ?4 AND created_at >= ?6) + ?14 <= ?10
      AND (SELECT COUNT(*) FROM usage_events WHERE kind = ?2 AND ip_hash = ?4 AND created_at > ?8) + ?14 <= ?11
      AND (SELECT COUNT(*) FROM usage_events WHERE kind = ?2 AND subject = ?3 AND created_at >= ?6) + ?14 <= ?12
  `).bind(crypto.randomUUID(), kind, subject, ip, now, dayStart, daily, now - 60, minute,
    ipDaily, ipMinute, sessionDaily, JSON.stringify(Array.from({ length: units }, (_, i) => i)), units).run();
  if (!result.success) throw new Error('QUOTA_STORE_UNAVAILABLE');
  return result.meta?.changes === units;
}
