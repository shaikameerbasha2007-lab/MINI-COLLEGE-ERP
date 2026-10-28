import nunjucks from "nunjucks";
import { findBundledDir } from "./files.js";

// Renders the original Jinja templates with Nunjucks (a Jinja-compatible engine).

const ROUTES: Record<string, string> = {
  index: "/",
  student_portal: "/student",
  login: "/login",
  faculty_dashboard: "/faculty-dashboard",
  upload_timetable: "/upload-timetable",
  view_student_timetable: "/student-timetable",
  admin: "/admin",
  logout: "/logout",
  timetable: "/timetable",
  remove_timetable: "/remove-timetable",
  upload_notice: "/upload-notice",
  student_view_notices: "/student-view-notices",
  get_notice: "/notices/<filename>",
  generate_letter: "/generate-letter",
  generate_multiple_letter: "/generate-multiple-letter",
  generate_select: "/generate-select",
  delete_notice: "/delete-notice/<filename>",
  submit_complaint: "/submit_complaint",
  view_complaints: "/view_complaints",
  delete_complaint: "/delete_complaint/<complaint_id>",
  get_unread_complaint_count: "/get_unread_complaint_count",
  upload_complaint: "/upload_complaint",
  launch_assignment: "/launch-assignment",
  upload_attendance_unique: "/upload-attendance-unique",
  upload_assignment_unique: "/upload-assignment-unique",
  delete_upload_unique: "/delete-upload/<file_type>/<year>/<filename>",
  view_attendance_unique: "/view-attendance-unique",
  view_assignment_unique: "/view-assignment-unique",
  home_page_unique: "/home-page",
  set_password: "/set_password",
  admin_dashboard: "/admin_dashboard",
  whatsapp: "/whatsapp",
  faculty_dashboard_return: "/faculty-dashboard-return",
  back_to_dashboard: "/back-to-dashboard",
};

// Equivalent of Flask's url_for: fills path parameters, extra arguments become the query string.
export function urlFor(endpoint: string, params: Record<string, unknown> = {}): string {
  const args = { ...params };
  delete args.__keywords;
  if (endpoint === "static") {
    const filename = String(args.filename ?? "");
    return "/static/" + filename.split("/").map(encodeURIComponent).join("/");
  }
  let route = ROUTES[endpoint];
  if (!route) throw new Error(`Unknown endpoint: ${endpoint}`);
  route = route.replace(/<(\w+)>/g, (_, name) => {
    const value = encodeURIComponent(String(args[name] ?? ""));
    delete args[name];
    return value;
  });
  const query = new URLSearchParams(
    Object.entries(args)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return query ? `${route}?${query}` : route;
}

let env: nunjucks.Environment | null = null;

function getEnv(): nunjucks.Environment {
  if (!env) {
    const dir = findBundledDir("templates");
    if (!dir) throw new Error("Templates directory not found");
    env = new nunjucks.Environment(new nunjucks.FileSystemLoader(dir), { autoescape: true });
  }
  return env;
}

export function renderTemplate(name: string, context: Record<string, unknown>): string {
  return getEnv().render(name, context);
}
