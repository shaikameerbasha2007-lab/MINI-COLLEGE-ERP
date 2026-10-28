import { getStore } from "@netlify/blobs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getSetting, setSetting } from "./settings.js";

// Uploaded files live in Netlify Blobs under the same relative paths the Flask
// app used inside its static/ folder, e.g. "uploads/timetable_1st_year.pdf",
// "uploads/attendance/year_1/sheet.pdf" and "notices/circular.pdf".

export function fileStore() {
  return getStore({ name: "erp-files", consistency: "strong" });
}

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  txt: "text/plain; charset=utf-8",
};

export function mimeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return MIME_TYPES[ext] || "application/octet-stream";
}

// Port of werkzeug.utils.secure_filename.
export function secureFilename(filename: string): string {
  let name = filename.normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
  name = name.replace(/[/\\]/g, " ");
  name = name
    .split(/\s+/)
    .filter(Boolean)
    .join("_")
    .replace(/[^A-Za-z0-9_.-]/g, "")
    .replace(/^[._]+|[._]+$/g, "");
  return name;
}

// Year/segment values end up in blob keys, so keep them to a safe character set.
export function isSafeSegment(value: string | null | undefined): value is string {
  return !!value && /^[A-Za-z0-9_-]+$/.test(value);
}

export async function saveFile(key: string, file: File): Promise<void> {
  await fileStore().set(key, await file.arrayBuffer(), {
    metadata: { contentType: file.type || mimeFor(key) },
  });
}

export async function fileExists(key: string): Promise<boolean> {
  return (await fileStore().getMetadata(key)) !== null;
}

export async function deleteFile(key: string): Promise<boolean> {
  if (!(await fileExists(key))) return false;
  await fileStore().delete(key);
  return true;
}

// Lists file names directly inside a "folder" prefix (no trailing slash).
export async function listFiles(folder: string): Promise<string[]> {
  const { blobs } = await fileStore().list({ prefix: `${folder}/`, directories: true });
  return blobs.map((b) => b.key.slice(folder.length + 1)).sort();
}

export async function serveFile(key: string): Promise<Response> {
  const result = await fileStore().getWithMetadata(key, { type: "arrayBuffer" });
  if (!result) return new Response("Not Found", { status: 404 });
  const contentType = (result.metadata?.contentType as string) || mimeFor(key);
  return new Response(result.data, {
    headers: { "content-type": contentType, "cache-control": "no-cache" },
  });
}

function findBundledDir(name: string): string | null {
  const candidates = [path.resolve(process.cwd(), name), path.resolve(process.cwd(), "..", name)];
  return candidates.find((dir) => existsSync(dir)) || null;
}

// Copies the notices that shipped in the repository into Blobs the first time
// notices are listed, so existing circulars keep showing up.
export async function seedNotices(): Promise<void> {
  if (await getSetting("notices_seeded")) return;
  const dir = findBundledDir("seed/notices");
  if (dir) {
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".pdf") && !(await fileExists(`notices/${name}`))) {
        await fileStore().set(`notices/${name}`, new Blob([readFileSync(path.join(dir, name))]), {
          metadata: { contentType: "application/pdf" },
        });
      }
      if (name === "deleted_by.txt" && !(await getSetting("deleted_by:notices"))) {
        await setSetting("deleted_by:notices", readFileSync(path.join(dir, name), "utf8").trim());
      }
    }
  }
  await setSetting("notices_seeded", "1");
}

export { findBundledDir };
