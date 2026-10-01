/** Server-side age gate. `dob` is YYYY-MM-DD; age is computed on UTC calendar dates. */
export function checkAge(
  dob: string,
  now: Date,
  minAge: number,
): { ok: true } | { ok: false; reason: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return { ok: false, reason: "Enter your date of birth as YYYY-MM-DD." };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const parsed = new Date(Date.UTC(y, mo - 1, d));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== mo - 1 ||
    parsed.getUTCDate() !== d
  ) {
    return { ok: false, reason: "That date of birth isn't a real date." };
  }
  if (parsed.getTime() > now.getTime())
    return { ok: false, reason: "Date of birth is in the future." };

  // Birthday reached when (month, day) of now >= (month, day) of dob; Feb 29 → Mar 1 in non-leap years.
  let age = now.getUTCFullYear() - y;
  const nowMonth = now.getUTCMonth() + 1;
  const nowDay = now.getUTCDate();
  if (nowMonth < mo || (nowMonth === mo && nowDay < d)) age -= 1;
  if (age < minAge) return { ok: false, reason: `You must be at least ${minAge} to use Spica.` };
  return { ok: true };
}
