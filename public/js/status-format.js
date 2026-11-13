// DOM-free text for the update banner.
const DONE_VISIBLE_MS = 10_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const HIDDEN = { visible: false, tone: 'info', text: '', percent: null };
const megabytes = (bytes) => Math.round(bytes / 1e6);

// '2026-11-08' -> 'Nov 8, 2026' without going through a time zone.
function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : null;
}

export function statusView(status, now, dataAsOf = null) {
  switch (status?.state) {
    case 'running': {
      let text = `Updating license data: ${status.stepLabel}`;
      if (status.percent != null) text += `, ${status.percent}%`;
      if (status.unit === 'bytes' && status.done != null && status.total != null) {
        text += ` (${megabytes(status.done)} of ${megabytes(status.total)} MB)`;
      }
      return { visible: true, tone: 'info', text, percent: status.percent ?? null };
    }
    case 'done': {
      const age = +now - Date.parse(status.updatedAt);
      if (!(age <= DONE_VISIBLE_MS)) return HIDDEN;
      const date = formatDate(dataAsOf);
      return { visible: true, tone: 'success', text: date ? `Data updated to ${date}` : 'Data updated', percent: 100 };
    }
    case 'failed':
      return {
        visible: true,
        tone: 'error',
        text: `Data update failed: ${status.error}. Showing the previous data.`,
        percent: null,
      };
    case 'interrupted':
      return {
        visible: true,
        tone: 'error',
        text: 'The last data update stopped before finishing. It will retry on the next start or schedule.',
        percent: null,
      };
    default:
      return HIDDEN;
  }
}

// While the first load runs, the API's "Data not loaded yet" is expected; say so instead.
export function dataLoadingNotice(err, updateRunning) {
  if (updateRunning && err?.status === 503 && err.message === 'Data not loaded yet') {
    return 'License data is loading — see the progress above.';
  }
  return null;
}
