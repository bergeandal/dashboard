import "dotenv/config";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
};

export type Category = "work" | "training" | "social" | "home" | "birthday" | "event";

export const config = {
  port: Number(process.env.PORT ?? 3001),
  lat: Number(process.env.LAT ?? 60.3913),
  lon: Number(process.env.LON ?? 5.3221),
  yrUserAgent: required("YR_USER_AGENT"),
  calendars: {
    training: required("ICS_TRAINING"),
    work: required("ICS_WORK"),
    social: required("ICS_SOCIAL"),
    home: required("ICS_HOME"),
    event: required("ICS_EVENTS"),
  } as Record<Exclude<Category, "birthday">, string>,
  birthdaysFile: process.env.BIRTHDAYS_FILE ?? "./birthdays.ics",
  // Optional: intervals.icu read layer (training load, FTP, wellness).
  // Left null when the secrets aren't set so the server still boots.
  intervals:
    process.env.INTERVALS_API_KEY && process.env.INTERVALS_ATHLETE_ID
      ? { apiKey: process.env.INTERVALS_API_KEY, athleteId: process.env.INTERVALS_ATHLETE_ID }
      : null,
};
