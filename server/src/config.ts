import "dotenv/config";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
};
const optional = (name: string): string | undefined => process.env[name] || undefined;

export type Category = "work" | "training" | "social" | "home" | "birthday" | "event";

// Two household profiles sharing one dashboard. Berge is the primary (his
// Google calendars + intervals.icu are required); Amanda's calendars are
// optional and only appear once configured.
export type ProfileId = "berge" | "amanda";
export const PROFILES: ProfileId[] = ["berge", "amanda"];
export const isProfile = (s: unknown): s is ProfileId =>
  typeof s === "string" && (PROFILES as string[]).includes(s);

type CalMap = Partial<Record<Exclude<Category, "birthday">, string>>;

const bergeCalendars: CalMap = {
  training: required("ICS_TRAINING"),
  work: required("ICS_WORK"),
  social: required("ICS_SOCIAL"),
  home: required("ICS_HOME"),
  event: required("ICS_EVENTS"),
};

// Optional second profile. Each unset ICS_AMANDA_* simply omits that calendar,
// so Amanda starts with no Google layer until URLs are added.
const amandaCalendars: CalMap = Object.fromEntries(
  ([
    ["training", "ICS_AMANDA_TRAINING"],
    ["work", "ICS_AMANDA_WORK"],
    ["social", "ICS_AMANDA_SOCIAL"],
    ["home", "ICS_AMANDA_HOME"],
    ["event", "ICS_AMANDA_EVENTS"],
  ] as const)
    .map(([cat, env]) => [cat, optional(env)] as const)
    .filter(([, v]) => v),
) as CalMap;

export const config = {
  port: Number(process.env.PORT ?? 3001),
  lat: Number(process.env.LAT ?? 60.3913),
  lon: Number(process.env.LON ?? 5.3221),
  yrUserAgent: required("YR_USER_AGENT"),
  birthdaysFile: process.env.BIRTHDAYS_FILE ?? "./birthdays.ics",
  // Optional: intervals.icu read layer (training load, FTP, wellness).
  // Left null when the secrets aren't set so the server still boots.
  intervals:
    process.env.INTERVALS_API_KEY && process.env.INTERVALS_ATHLETE_ID
      ? { apiKey: process.env.INTERVALS_API_KEY, athleteId: process.env.INTERVALS_ATHLETE_ID }
      : null,
};

// Per-profile Google calendar set. Weather and birthdays stay shared (household-level).
export const profileCalendars = (p: ProfileId): CalMap =>
  p === "amanda" ? amandaCalendars : bergeCalendars;

// intervals.icu is Berge's Garmin account; other profiles have no fitness layer.
export const intervalsFor = (p: ProfileId) => (p === "berge" ? config.intervals : null);
