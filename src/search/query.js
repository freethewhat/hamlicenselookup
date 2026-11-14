// Searches licenses.db (with geo.db attached as `geo`) by ZIP list and filters.
// mode: 'count', 'rows' (full rows for preview and export), or 'addresses' (just what addressKey reads).
function build(zips, f, mode) {
  const where = ['l.zip5 IN (SELECT value FROM json_each(@zips))'];
  if (!f.includeExpired) where.push("l.status = 'A'");
  if (!f.includeClubs) where.push("l.applicant_type = 'I' AND COALESCE(l.trustee_call, '') = ''");
  const params = { zips: JSON.stringify(zips) };
  if (f.firstLicenseSince) {
    where.push('(l.first_license_date >= @since OR (@upgrades AND l.upgrade_date >= @since))');
    params.since = f.firstLicenseSince;
    params.upgrades = f.includeUpgrades ? 1 : 0;
  }
  const label = f.firstLicenseSince
    ? "CASE WHEN l.first_license_date >= @since THEN 'First license' ELSE 'Upgrade' END"
    : "''";
  const selects = {
    count: 'COUNT(*) AS n',
    rows: `l.*, c.name AS county_name, ${label} AS new_label`,
    addresses: 'l.zip5, l.street, l.po_box, l.city, l.state',
  };
  const select = selects[mode];
  const sql = `SELECT ${select} FROM licenses l
    LEFT JOIN geo.zips z ON z.zip = l.zip5
    LEFT JOIN geo.counties c ON c.geoid = z.county_geoid
    WHERE ${where.join(' AND ')}`;
  return { sql, params };
}

export function countLicenses(db, zips, filters) {
  const { sql, params } = build(zips, filters, 'count');
  return db.prepare(sql).get(params).n;
}

export function iterateLicenses(db, zips, filters, limit) {
  const { sql, params } = build(zips, filters, 'rows');
  if (limit != null) params.limit = limit;
  const limited = limit == null ? '' : ' LIMIT @limit';
  return db.prepare(`${sql} ORDER BY l.zip5, l.last, l.first, l.call${limited}`).iterate(params);
}

// Address fields of every match, ordered by ZIP as groupByAddress needs, for counting mailing addresses.
export function iterateAddresses(db, zips, filters) {
  const { sql, params } = build(zips, filters, 'addresses');
  return db.prepare(`${sql} ORDER BY l.zip5`).iterate(params);
}
