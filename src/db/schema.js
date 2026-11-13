// Bump on any change to the licenses.db layout or the derived-column rules.
export const LICENSE_SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE licenses (
  usid INTEGER PRIMARY KEY, call TEXT NOT NULL, status TEXT, service TEXT,
  grant_date TEXT, expired_date TEXT, cancel_date TEXT, last_action_date TEXT,
  applicant_type TEXT, entity_name TEXT, first TEXT, mi TEXT, last TEXT, suffix TEXT,
  street TEXT, po_box TEXT, city TEXT, state TEXT, zip TEXT, zip5 TEXT, frn TEXT,
  op_class TEXT, prev_call TEXT, prev_class TEXT, trustee_call TEXT,
  first_license_date TEXT, upgrade_date TEXT, earliest_event_date TEXT);
CREATE TABLE history (usid INTEGER NOT NULL, date TEXT, code TEXT);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
`;

export const INDEX_SQL = `
CREATE INDEX lic_zip5 ON licenses(zip5);
CREATE INDEX lic_frn ON licenses(frn);
CREATE INDEX lic_first ON licenses(first_license_date);
CREATE INDEX lic_upg ON licenses(upgrade_date);
CREATE INDEX hist_usid ON history(usid);
`;
