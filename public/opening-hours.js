export const BUSINESS_TIME_ZONE = 'Europe/Prague';
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayLabels = ['v neděli', 'v pondělí', 'v úterý', 've středu', 've čtvrtek', 'v pátek', 'v sobotu'];
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const partsAt = instant => Object.fromEntries(clock.formatToParts(new Date(instant)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
const minutes = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;

// Resolve the next local opening in Prague, including weekends across a DST change.
function localInstant(date, minute) {
  const wall = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), Math.floor(minute / 60), minute % 60);
  let instant = wall;
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = partsAt(instant);
    const observed = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    instant += wall - observed;
  }
  return instant;
}
export function countdownText(seconds) {
  const remaining = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(remaining / 3600);
  const mins = Math.floor(remaining % 3600 / 60).toString().padStart(2, '0');
  const secs = (remaining % 60).toString().padStart(2, '0');
  return hours ? `${hours}:${mins}:${secs}` : `${mins}:${secs}`;
}
export function getOpeningStatus(hours, now = new Date()) {
  const instant = new Date(now).getTime();
  const opens = minutes(hours?.opens), closes = minutes(hours?.closes);
  const unavailable = { isOpen: false, countdown: null, secondsRemaining: null, detail: 'Otevírací dobu ověříš na pobočce.', nextOpening: null };
  if (!Number.isFinite(instant) || !Number.isFinite(opens) || !Number.isFinite(closes) || opens >= closes || !Array.isArray(hours?.days)) return unavailable;
  const p = partsAt(instant);
  const today = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const secondOfDay = p.hour * 3600 + p.minute * 60 + p.second;
  const isOpen = hours.days.includes(weekdays[today.getUTCDay()]) && secondOfDay >= opens * 60 && secondOfDay < closes * 60;
  if (isOpen) {
    const secondsRemaining = Math.ceil((localInstant(today, closes) - instant) / 1000);
    return { isOpen, countdown: secondsRemaining <= 7200 ? 'closing' : null, secondsRemaining,
      detail: `Dnes do ${hours.closes}`, nextOpening: null };
  }
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(today.getTime() + offset * 86400000);
    if (!hours.days.includes(weekdays[date.getUTCDay()])) continue;
    const nextOpening = localInstant(date, opens);
    if (nextOpening <= instant) continue;
    const secondsRemaining = Math.ceil((nextOpening - instant) / 1000);
    const when = offset === 0 ? 'dnes' : offset === 1 ? 'zítra' : dayLabels[date.getUTCDay()];
    return { isOpen, countdown: secondsRemaining <= 3600 ? 'opening' : null, secondsRemaining,
      detail: `Otevíráme ${when} v ${hours.opens}`, nextOpening };
  }
  return unavailable;
}
export function storeOpeningStatus(data, now = new Date(), branchId = null) {
  const branch = branchId ? data.branches.find(branch => branch.id === branchId) : data.branches[0];
  return getOpeningStatus(branch?.opening_hours, now);
}
export const closedOrderingMessage = status => `Teď máme zavřeno. ${status.detail}. Objednávat můžeš během otevírací doby.`;
