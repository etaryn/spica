/**
 * The 18+ gate, checked on the server at sign-up. Age is counted on UTC calendar dates; someone
 * born on 29 February has their birthday on 1 March in non-leap years.
 */

export type AgeCheck = { ok: true } | { ok: false; reason: string };

const DATE_OF_BIRTH = /^(\d{4})-(\d{2})-(\d{2})$/;

export function checkAge(dob: string, now: Date, minAge: number): AgeCheck {
  const match = DATE_OF_BIRTH.exec(dob);
  if (!match) return { ok: false, reason: "Enter your date of birth as YYYY-MM-DD." };

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const birth = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    birth.getUTCFullYear() === year &&
    birth.getUTCMonth() === month - 1 &&
    birth.getUTCDate() === day;
  if (!isRealDate) return { ok: false, reason: "That date of birth isn't a real date." };

  if (birth.getTime() > now.getTime()) {
    return { ok: false, reason: "Date of birth is in the future." };
  }

  if (ageOn(now, year, month, day) < minAge) {
    return { ok: false, reason: `You must be at least ${minAge} to use Spica.` };
  }
  return { ok: true };
}

function ageOn(now: Date, year: number, month: number, day: number): number {
  const nowMonth = now.getUTCMonth() + 1;
  const nowDay = now.getUTCDate();
  const hadBirthdayThisYear = nowMonth > month || (nowMonth === month && nowDay >= day);

  const age = now.getUTCFullYear() - year;
  return hadBirthdayThisYear ? age : age - 1;
}
