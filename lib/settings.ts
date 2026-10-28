import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row ? row.value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

// Inserts the value only if the key is unset, then returns whatever is stored.
export async function getOrCreateSetting(key: string, create: () => string): Promise<string> {
  await db.insert(settings).values({ key, value: create() }).onConflictDoNothing();
  return (await getSetting(key)) as string;
}

const DEFAULT_FACULTY_PASSWORD = "1359";

export async function getFacultyPassword(): Promise<string> {
  return getOrCreateSetting("faculty_password", () => DEFAULT_FACULTY_PASSWORD);
}

export async function setFacultyPassword(newPassword: string): Promise<void> {
  await setSetting("faculty_password", newPassword);
}
