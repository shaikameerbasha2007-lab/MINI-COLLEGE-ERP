import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

// Student complaints submitted from the student portal.
export const complaints = pgTable("complaints", {
  id: serial().primaryKey(),
  pin: text(),
  name: text(),
  complaint: text(),
  timestamp: text(),
  viewed: integer().notNull().default(0),
});

// Key/value settings: faculty password, session secret, "deleted by" markers.
export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
