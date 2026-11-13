import { CLASS_RANK } from './fields.js';

/*
 * First-license and upgrade rule.
 *
 * Input dates are ISO strings (YYYY-MM-DD), so plain string comparison orders them.
 * history is an unsorted list of {date, code} license events (FCC ULS codes such as
 * LIISS, LIMOD, LIREN, VANGRT).
 *
 *   earliestEventDate = min(history.date)
 *   firstLicenseDate  = date of the earliest LIISS event, only if
 *                         prevCall === '' and prevClass === '' and
 *                         no history event is dated before that LIISS date;
 *                       else null.
 *   upgradeDate       = if prevClass !== '' and CLASS_RANK[opClass] > CLASS_RANK[prevClass]:
 *                         latest LIMOD date, or grantDate if there is no LIMOD;
 *                       else null.
 *
 * A later cross-license pass clears firstLicenseDate when another license with the same
 * FRN has an earlier earliestEventDate.
 */
export function classifyLicense({ opClass, prevCall, prevClass, grantDate, history }) {
  const dates = history.map((event) => event.date);
  const earliestEventDate = dates.length ? dates.reduce((a, b) => (b < a ? b : a)) : null;

  const liissDates = history.filter((event) => event.code === 'LIISS').map((event) => event.date);
  const earliestLiiss = liissDates.length ? liissDates.reduce((a, b) => (b < a ? b : a)) : null;
  const firstLicenseDate = (prevCall === '' && prevClass === '' && earliestLiiss !== null
    && earliestLiiss === earliestEventDate) ? earliestLiiss : null;

  let upgradeDate = null;
  if (prevClass !== '' && CLASS_RANK[opClass] > CLASS_RANK[prevClass]) {
    const limodDates = history.filter((event) => event.code === 'LIMOD').map((event) => event.date);
    upgradeDate = limodDates.length ? limodDates.reduce((a, b) => (b > a ? b : a)) : grantDate;
  }

  return { firstLicenseDate, upgradeDate, earliestEventDate };
}
