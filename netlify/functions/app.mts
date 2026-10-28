import type { Config } from "@netlify/functions";
import { count, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { complaints } from "../../db/schema.js";
import {
  deleteFile,
  fileExists,
  isSafeSegment,
  listFiles,
  saveFile,
  secureFilename,
  seedNotices,
  serveFile,
} from "../../lib/files.js";
import { buildLetterPdf, formatDate } from "../../lib/letters.js";
import { RequestState } from "../../lib/session.js";
import { getFacultyPassword, getSetting, setFacultyPassword, setSetting } from "../../lib/settings.js";
import { renderTemplate, urlFor } from "../../lib/templates.js";

// Serves the college ERP: a port of the original Flask app (app.py) to a
// Netlify Function. Complaints and settings live in Netlify Database,
// uploaded files live in Netlify Blobs.

type Ctx = { req: Request; url: URL; state: RequestState; params: string[] };
type Handler = (ctx: Ctx) => Promise<Response> | Response;

const YEARS = ["1st_year", "2nd_year", "3rd_year"];
const UPLOAD_ATTENDANCE = "uploads/attendance";
const UPLOAD_ASSIGNMENTS = "uploads/assignments";
const ADMIN_PASSCODE = () => process.env.ADMIN_PASSCODE || "123";

// ------------------ Helpers ------------------

function render(ctx: Ctx, name: string, context: Record<string, unknown> = {}, status = 200): Response {
  const session = ctx.state.session;
  const html = renderTemplate(name, {
    ...context,
    session: { ...session, get: (key: keyof typeof session) => session[key] },
    url_for: (endpoint: string, kwargs?: Record<string, unknown>) => urlFor(endpoint, kwargs),
    get_flashed_messages: (kwargs?: { with_categories?: boolean }) =>
      ctx.state.getFlashedMessages(!!kwargs?.with_categories),
  });
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

async function form(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch {
    return new FormData();
  }
}

function str(data: FormData, key: string): string | null {
  const v = data.get(key);
  return typeof v === "string" ? v : null;
}

function isFile(v: FormDataEntryValue | null): v is File {
  return typeof v === "object" && v !== null && "arrayBuffer" in v;
}

const humanYear = (year: string) => year.replace(/_/g, " ");

function localTimestamp(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

async function timetableFile(year: string): Promise<{ filename: string; file_type: "pdf" | "image" } | null> {
  if (await fileExists(`uploads/timetable_${year}.pdf`)) return { filename: `timetable_${year}.pdf`, file_type: "pdf" };
  if (await fileExists(`uploads/timetable_${year}.jpg`)) return { filename: `timetable_${year}.jpg`, file_type: "image" };
  return null;
}

const requireFaculty =
  (handler: Handler): Handler =>
  (ctx) =>
    ctx.state.session.user ? handler(ctx) : redirect(urlFor("login"));

const requireAdmin =
  (handler: Handler): Handler =>
  (ctx) => {
    if (ctx.state.session.admin) return handler(ctx);
    ctx.state.flash("Admin access required!");
    return redirect(urlFor("admin"));
  };

// ------------------ Routes ------------------

const index: Handler = (ctx) => render(ctx, "index.html");

const login: Handler = async (ctx) => {
  if (ctx.req.method === "POST") {
    const data = await form(ctx.req);
    if (str(data, "password") === (await getFacultyPassword())) {
      ctx.state.setSession({ ...ctx.state.session, user: str(data, "username") || "" });
      return redirect(urlFor("faculty_dashboard"));
    }
    ctx.state.flash("Invalid passcode");
  }
  return render(ctx, "login.html");
};

const facultyDashboard = requireFaculty((ctx) =>
  render(ctx, "faculty_dashboard.html", {
    username: ctx.state.session.user,
    external_apps: {
      assignment: process.env.ASSIGNMENT_APP_URL || "",
      studentRecords: process.env.STUDENT_RECORDS_APP_URL || "",
      attendance: process.env.ATTENDANCE_APP_URL || "",
    },
  }),
);

const uploadTimetable = requireFaculty(async (ctx) => {
  if (ctx.req.method === "POST") {
    const data = await form(ctx.req);
    const year = str(data, "year");
    if (!year) {
      ctx.state.flash("Please select an academic year");
      return redirect(ctx.url.pathname + ctx.url.search);
    }
    const file = data.get("timetable");
    if (!isFile(file) || file.name === "") {
      ctx.state.flash("No file selected");
      return redirect(ctx.url.pathname + ctx.url.search);
    }
    const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
    if (isSafeSegment(year) && ["pdf", "png", "jpg", "jpeg", "gif"].includes(ext)) {
      // A new upload replaces whichever format was there before.
      await deleteFile(`uploads/timetable_${year}.pdf`);
      await deleteFile(`uploads/timetable_${year}.jpg`);
      await saveFile(ext === "pdf" ? `uploads/timetable_${year}.pdf` : `uploads/timetable_${year}.jpg`, file);
      ctx.state.flash(`Timetable for ${humanYear(year)} uploaded successfully`);
      return redirect(urlFor("upload_timetable"));
    }
    ctx.state.flash("Invalid file type. Only PDF and image files are allowed.");
  }

  const timetable_files: Record<string, unknown> = {};
  for (const year of YEARS) {
    const found = await timetableFile(year);
    timetable_files[year] = found ? { ...found, exists: true } : { exists: false };
  }
  return render(ctx, "upload_timetable.html", { timetable_files });
});

const studentTimetable: Handler = async (ctx) => {
  const year = ctx.url.searchParams.get("year") || "1st_year";
  const found = isSafeSegment(year) ? await timetableFile(year) : null;
  if (found) {
    return render(ctx, "student_timetable.html", {
      time: Math.floor(Date.now() / 1000),
      show_image: true,
      filename: found.filename,
      file_type: found.file_type,
      current_year: year,
    });
  }
  return render(ctx, "student_timetable.html", {
    show_image: false,
    deleted_by: isSafeSegment(year) ? await getSetting(`deleted_by:timetable_${year}`) : null,
    current_year: year,
  });
};

const admin: Handler = async (ctx) => {
  if (ctx.req.method === "POST") {
    const data = await form(ctx.req);
    if (str(data, "code") === ADMIN_PASSCODE()) {
      ctx.state.setSession({ ...ctx.state.session, admin: true });
      return redirect(urlFor("admin_dashboard"));
    }
    ctx.state.flash("Wrong admin passcode");
  }
  return render(ctx, "admin.html");
};

const logout: Handler = (ctx) => {
  ctx.state.clearSession();
  return redirect(urlFor("index"));
};

const removeTimetable = requireFaculty(async (ctx) => {
  const year = str(await form(ctx.req), "year");
  if (!year) {
    ctx.state.flash("No year specified");
    return redirect(urlFor("upload_timetable"));
  }
  const removed =
    isSafeSegment(year) &&
    ((await deleteFile(`uploads/timetable_${year}.pdf`)) || (await deleteFile(`uploads/timetable_${year}.jpg`)));
  if (removed) {
    await setSetting(`deleted_by:timetable_${year}`, ctx.state.session.user || "");
    ctx.state.flash(`Timetable for ${humanYear(year)} removed successfully`);
  } else {
    ctx.state.flash(`No timetable found for ${humanYear(year)}`);
  }
  return redirect(urlFor("upload_timetable"));
});

async function listNotices(): Promise<string[]> {
  await seedNotices();
  return (await listFiles("notices")).filter((f) => f.endsWith(".pdf"));
}

const uploadNotice = requireFaculty(async (ctx) => {
  if (ctx.req.method === "POST") {
    const file = (await form(ctx.req)).get("notice_pdf");
    const filename = isFile(file) && file.name.endsWith(".pdf") ? secureFilename(file.name) : "";
    if (isFile(file) && filename) {
      await seedNotices();
      await saveFile(`notices/${filename}`, file);
      ctx.state.flash("Notice uploaded successfully.");
      return redirect(urlFor("upload_notice"));
    }
    ctx.state.flash("Only PDF files are allowed.");
  }
  return render(ctx, "upload_notice.html", { pdf_files: await listNotices() });
});

const studentViewNotices: Handler = async (ctx) => {
  const pdf_files = await listNotices();
  const deleted_by = pdf_files.length === 0 ? await getSetting("deleted_by:notices") : null;
  return render(ctx, "student_view_notices.html", { pdf_files, deleted_by });
};

const getNotice: Handler = async (ctx) => {
  await seedNotices();
  return serveFile(`notices/${ctx.params[0]}`);
};

const deleteNotice = requireFaculty(async (ctx) => {
  const filename = ctx.params[0];
  await seedNotices();
  if (await deleteFile(`notices/${filename}`)) {
    ctx.state.flash(`${filename} deleted successfully.`);
    if ((await listNotices()).length === 0) {
      await setSetting("deleted_by:notices", ctx.state.session.user || "");
    }
  } else {
    ctx.state.flash("File not found or already deleted.");
  }
  return redirect(urlFor("upload_notice"));
});

function letterHandler(template: string, downloadName: string, multiple: boolean): Handler {
  return async (ctx) => {
    if (ctx.req.method !== "POST") return render(ctx, template);
    const data = await form(ctx.req);
    const date = formatDate(str(data, "date") || "");
    const holidayStart = formatDate(str(data, "holiday_start") || "");
    const holidayEnd = formatDate(str(data, "holiday_end") || "");
    const reopenDate = multiple ? formatDate(str(data, "reopen_date") || "") : undefined;
    const purpose = str(data, "purpose");
    if (!date || !holidayStart || !holidayEnd || purpose === null || reopenDate === null) {
      return new Response("Bad Request: missing or invalid form fields", { status: 400 });
    }
    const pdf = await buildLetterPdf({ date, holidayStart, holidayEnd, purpose, reopenDate });
    return new Response(pdf as unknown as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename=${downloadName}`,
      },
    });
  };
}

const submitComplaint: Handler = async (ctx) => {
  const data = await form(ctx.req);
  const pin = str(data, "pin");
  const name = str(data, "name");
  const complaint = str(data, "complaint");
  if (pin === null || name === null || complaint === null) {
    return new Response("Bad Request: missing form fields", { status: 400 });
  }
  await db.insert(complaints).values({ pin, name, complaint, timestamp: localTimestamp(), viewed: 0 });
  ctx.state.flash("Complaint submitted successfully!");
  return redirect(urlFor("student_portal"));
};

const viewComplaints = requireFaculty(async (ctx) => {
  const rows = await db.select().from(complaints).orderBy(desc(complaints.timestamp));
  await db.update(complaints).set({ viewed: 1 }).where(eq(complaints.viewed, 0));
  // The template indexes rows like the original SQLite tuples.
  return render(ctx, "view_complaints.html", {
    complaints: rows.map((r) => [r.id, r.pin, r.name, r.complaint, r.timestamp, r.viewed]),
  });
});

const deleteComplaint: Handler = async (ctx) => {
  if (!ctx.state.session.user) return json({ error: "Unauthorized" }, 401);
  const id = Number(ctx.params[0]);
  try {
    const deleted = await db.delete(complaints).where(eq(complaints.id, id)).returning({ id: complaints.id });
    return deleted.length > 0
      ? json({ message: "Complaint deleted successfully" })
      : json({ error: "Complaint not found" }, 404);
  } catch (e) {
    return json({ error: `Database error: ${(e as Error).message}` }, 500);
  }
};

const unreadComplaintCount: Handler = async () => {
  const [row] = await db.select({ count: count() }).from(complaints).where(eq(complaints.viewed, 0));
  return json({ count: Number(row?.count ?? 0) });
};

const launchAssignment: Handler = () => {
  const target = process.env.ASSIGNMENT_APP_URL;
  return target ? redirect(target) : new Response("Assignment app URL is not configured yet.", { status: 503 });
};

function uploadGeneric(base: string, endpoint: string, title: string): Handler {
  return requireFaculty(async (ctx) => {
    let year = ctx.url.searchParams.get("year");
    if (ctx.req.method === "POST") {
      const data = await form(ctx.req);
      year = str(data, "year");
      if (isSafeSegment(year)) {
        for (const file of data.getAll("pdfs")) {
          const filename = isFile(file) && file.name.endsWith(".pdf") ? secureFilename(file.name) : "";
          if (isFile(file) && filename) await saveFile(`${base}/year_${year}/${filename}`, file);
        }
      }
      return redirect(urlFor(endpoint, { year }));
    }
    const pdf_files = isSafeSegment(year) ? await listFiles(`${base}/year_${year}`) : [];
    return render(ctx, "upload_generic.html", { year, pdf_files, action_url: urlFor(endpoint), title });
  });
}

const deleteUpload = requireFaculty(async (ctx) => {
  const [fileType, year, filename] = ctx.params;
  const base = fileType.startsWith("attendance") ? UPLOAD_ATTENDANCE : UPLOAD_ASSIGNMENTS;
  if (isSafeSegment(year) && (await deleteFile(`${base}/year_${year}/${filename}`))) {
    await setSetting(`deleted_by:${base}/year_${year}`, ctx.state.session.user || "");
  }
  return redirect(ctx.req.headers.get("referer") || urlFor("faculty_dashboard"));
});

function viewGeneric(base: string, title: string, fileType: string): Handler {
  return async (ctx) => {
    const year = ctx.url.searchParams.get("year") || "1";
    const pdf_files: Record<string, string[]> = {};
    for (const y of ["1", "2", "3"]) {
      pdf_files[y] = (await listFiles(`${base}/year_${y}`)).filter((f) => f.endsWith(".pdf"));
    }
    return render(ctx, "view_generic.html", { title, year, pdf_files, file_type: fileType });
  };
}

const setPassword = requireAdmin(async (ctx) => {
  if (ctx.req.method === "POST") {
    const data = await form(ctx.req);
    const newPassword = str(data, "new_password");
    const confirmPassword = str(data, "confirm_password");
    if (newPassword && newPassword.trim() && newPassword === confirmPassword) {
      try {
        await setFacultyPassword(newPassword);
        ctx.state.flash("Password updated successfully!");
        return redirect(urlFor("admin_dashboard"));
      } catch {
        ctx.state.flash("Failed to update password. Please try again.");
      }
    } else {
      ctx.state.flash("Passwords do not match or empty!");
    }
  }
  return render(ctx, "set_password.html");
});

const whatsapp: Handler = async (ctx) => {
  if (ctx.req.method === "POST") {
    const number = (str(await form(ctx.req), "phone_number") || "").trim().replace(/\D/g, "");
    if (number) return redirect(`https://wa.me/${number}`);
  }
  return render(ctx, "whatsapp.html");
};

const backToDashboard: Handler = (ctx) =>
  redirect(ctx.state.session.user ? urlFor("faculty_dashboard") : urlFor("login"));

const serveUpload: Handler = (ctx) => serveFile(`uploads/${ctx.params[0]}`);
const serveStaticNotice: Handler = (ctx) => seedNotices().then(() => serveFile(`notices/${ctx.params[0]}`));

// [methods, pattern, handler]; patterns capture path params in order.
const ROUTE_TABLE: Array<[string[], RegExp, Handler]> = [
  [["GET"], /^\/$/, index],
  [["GET"], /^\/student$/, (ctx) => render(ctx, "student_portal.html")],
  [["GET", "POST"], /^\/login$/, login],
  [["GET"], /^\/faculty-dashboard$/, facultyDashboard],
  [["GET", "POST"], /^\/upload-timetable$/, uploadTimetable],
  [["GET"], /^\/student-timetable$/, studentTimetable],
  [["GET", "POST"], /^\/admin$/, admin],
  [["GET"], /^\/logout$/, logout],
  [["GET"], /^\/timetable$/, (ctx) => render(ctx, "timetable.html")],
  [["POST"], /^\/remove-timetable$/, removeTimetable],
  [["GET", "POST"], /^\/upload-notice$/, uploadNotice],
  [["GET"], /^\/student-view-notices$/, studentViewNotices],
  [["GET"], /^\/notices\/([^/]+)$/, getNotice],
  [["GET", "POST"], /^\/generate-letter$/, letterHandler("form.html", "generated_letter.pdf", false)],
  [["GET", "POST"], /^\/generate-multiple-letter$/, letterHandler("multiple_form.html", "generated_multiple_letter.pdf", true)],
  [["GET"], /^\/generate-select$/, (ctx) => render(ctx, "generate_select.html")],
  [["POST"], /^\/delete-notice\/([^/]+)$/, deleteNotice],
  [["POST"], /^\/submit_complaint$/, submitComplaint],
  [["GET"], /^\/view_complaints$/, viewComplaints],
  [["DELETE"], /^\/delete_complaint\/(\d+)$/, deleteComplaint],
  [["GET"], /^\/get_unread_complaint_count$/, unreadComplaintCount],
  [["GET"], /^\/upload_complaint$/, (ctx) => render(ctx, "upload_complaint.html")],
  [["GET"], /^\/launch-assignment$/, launchAssignment],
  [["GET", "POST"], /^\/upload-attendance-unique$/, uploadGeneric(UPLOAD_ATTENDANCE, "upload_attendance_unique", "Upload Attendance")],
  [["GET", "POST"], /^\/upload-assignment-unique$/, uploadGeneric(UPLOAD_ASSIGNMENTS, "upload_assignment_unique", "Upload Assignment")],
  [["POST"], /^\/delete-upload\/([^/]+)\/([^/]+)\/([^/]+)$/, deleteUpload],
  [["GET"], /^\/view-attendance-unique$/, viewGeneric(UPLOAD_ATTENDANCE, "View Attendance", "attendance")],
  [["GET"], /^\/view-assignment-unique$/, viewGeneric(UPLOAD_ASSIGNMENTS, "View Assignment", "assignments")],
  [["GET"], /^\/home-page$/, index],
  [["GET", "POST"], /^\/set_password$/, setPassword],
  [["GET"], /^\/admin_dashboard$/, requireAdmin((ctx) => render(ctx, "admin_dashboard.html"))],
  [["GET", "POST"], /^\/whatsapp$/, whatsapp],
  [["GET"], /^\/faculty-dashboard-return$/, backToDashboard],
  [["GET"], /^\/back-to-dashboard$/, backToDashboard],
  [["GET"], /^\/static\/uploads\/(.+)$/, serveUpload],
  [["GET"], /^\/static\/notices\/([^/]+)$/, serveStaticNotice],
];

export default async (req: Request) => {
  const url = new URL(req.url);
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const method = req.method === "HEAD" ? "GET" : req.method;

  let matchedPath = false;
  for (const [methods, pattern, handler] of ROUTE_TABLE) {
    const match = pattern.exec(pathname);
    if (!match) continue;
    matchedPath = true;
    if (!methods.includes(method)) continue;

    let params: string[];
    try {
      params = match.slice(1).map((p) => decodeURIComponent(p));
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    const state = await RequestState.load(req);
    const response = await handler({ req, url, state, params });
    await state.applyCookies(response.headers);
    return response;
  }

  return matchedPath
    ? new Response("Method Not Allowed", { status: 405 })
    : new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });
};

export const config: Config = {
  path: "/*",
  preferStatic: true,
};
