// Address key for the results map: one geocoded point per distinct street address.
import { mailingAddress, standardStreet, squash } from '../search/mailer.js';

// `key` identifies the address (same spelling variants share a key); `street` is the cleaned
// street line to send to the geocoder. Returns null when there is no street (PO Box only).
export function mapAddress(row) {
  const { street } = mailingAddress(row);
  const standard = standardStreet(street);
  if (!standard) return null;
  return { key: `${row.zip5 ?? ''}|${squash(row.city)}|${row.state ?? ''}|${standard}`, street };
}
