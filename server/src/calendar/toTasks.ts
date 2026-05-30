import ical from "node-ical";
import type { Category } from "../config.js";

export type Task = {
  id: string;
  date: string;       // YYYY-MM-DD (local Europe/Oslo)
  start: string;      // HH:MM
  end: string;        // HH:MM ("" if none)
  title: string;
  cat: Category;
  note: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

// Format a Date as YYYY-MM-DD / HH:MM in Europe/Oslo regardless of server TZ.
const fmtOslo = (d: Date): { date: string; time: string } => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
};

const isAllDay = (ev: any): boolean => {
  // node-ical sets `datetype: "date"` for VALUE=DATE (all-day) events.
  return ev.datetype === "date";
};

export async function fetchCalendarAsTasks(
  url: string,
  cat: Category,
  windowStart: Date,
  windowEnd: Date,
): Promise<Task[]> {
  const data = await ical.async.fromURL(url);
  const out: Task[] = [];

  for (const key of Object.keys(data)) {
    const ev: any = (data as any)[key];
    if (!ev || ev.type !== "VEVENT") continue;

    const pushInstance = (start: Date, end: Date | undefined) => {
      if (start > windowEnd || (end ?? start) < windowStart) return;

      const allDay = isAllDay(ev);
      if (allDay) {
        const { date } = fmtOslo(start);
        out.push({
          id: `${cat}:${ev.uid}:${date}`,
          date,
          start: "",
          end: "",
          title: String(ev.summary ?? "(untitled)"),
          cat,
          note: String(ev.description ?? "").trim(),
        });
      } else {
        const s = fmtOslo(start);
        const e = end ? fmtOslo(end) : { date: s.date, time: "" };
        out.push({
          id: `${cat}:${ev.uid}:${start.toISOString()}`,
          date: s.date,
          start: s.time,
          end: e.date === s.date ? e.time : "",
          title: String(ev.summary ?? "(untitled)"),
          cat,
          note: String(ev.description ?? "").trim(),
        });
      }
    };

    if (ev.rrule) {
      // Recurring: expand within window. node-ical sets rrule (an rrule.js RRule).
      const instances: Date[] = ev.rrule.between(windowStart, windowEnd, true);
      const durMs = ev.end && ev.start ? +ev.end - +ev.start : 0;
      const exdates = ev.exdate ? Object.values(ev.exdate).map((d: any) => +new Date(d)) : [];
      for (const inst of instances) {
        if (exdates.includes(+inst)) continue;
        pushInstance(inst, durMs ? new Date(+inst + durMs) : undefined);
      }
    } else {
      pushInstance(new Date(ev.start), ev.end ? new Date(ev.end) : undefined);
    }
  }

  return out;
}
