import "dotenv/config";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
};
const optional = (name: string): string | undefined => process.env[name] || undefined;

export type Category = "work" | "training" | "social" | "home" | "birthday" | "event";

// Profiles live in SQLite (see db.ts) so they can be added/removed from the UI.
// Ids are lowercase slugs; "berge" is the original primary profile.
export type ProfileId = string;

export type CalCategory = Exclude<Category, "birthday">;
export type CalMap = Partial<Record<CalCategory, string>>;
export const CAL_CATS: CalCategory[] = ["training", "work", "social", "home", "event"];
const CAL_ENV: Record<CalCategory, string> = {
  training: "TRAINING", work: "WORK", social: "SOCIAL", home: "HOME", event: "EVENTS",
};

// Berge's calendars predate profiles and stay required, so the server won't
// boot half-configured.
for (const cat of CAL_CATS) required(`ICS_${CAL_ENV[cat]}`);

// Env-var calendar fallback for a profile: Berge uses the unprefixed ICS_*,
// every other profile ICS_<ID>_* (e.g. ICS_AMANDA_WORK). Unset vars are omitted.
// URLs saved on the profile in the DB take precedence (see profileCalendars).
export const envCalendars = (p: ProfileId): CalMap => {
  const prefix = p === "berge" ? "ICS_" : `ICS_${p.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_`;
  return Object.fromEntries(
    CAL_CATS.map((cat) => [cat, optional(prefix + CAL_ENV[cat])] as const).filter(([, v]) => v),
  ) as CalMap;
};

export const config = {
  port: Number(process.env.PORT ?? 3001),
  lat: Number(process.env.LAT ?? 60.3913),
  lon: Number(process.env.LON ?? 5.3221),
  yrUserAgent: required("YR_USER_AGENT"),
  // Entur (public-transport routing) just needs an identifying client name, no
  // key. Format is "companyname-appname". Overridable via env, sensible default.
  enturClientName: process.env.ENTUR_CLIENT_NAME ?? "commanddeck-berge",
  birthdaysFile: process.env.BIRTHDAYS_FILE ?? "./birthdays.ics",
  // Optional: intervals.icu read layer (training load, FTP, wellness).
  // Left null when the secrets aren't set so the server still boots.
  intervals:
    process.env.INTERVALS_API_KEY && process.env.INTERVALS_ATHLETE_ID
      ? { apiKey: process.env.INTERVALS_API_KEY, athleteId: process.env.INTERVALS_ATHLETE_ID }
      : null,
};

// The birthdays file is Berge's Google Contacts export, so only his deck shows it.
export const birthdaysFor = (p: ProfileId): string => (p === "berge" ? config.birthdaysFile : "");

// intervals.icu is Berge's Garmin account; other profiles have no fitness layer.
export const intervalsFor = (p: ProfileId) => (p === "berge" ? config.intervals : null);
