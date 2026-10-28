CREATE TABLE "complaints" (
	"id" serial PRIMARY KEY,
	"pin" text,
	"name" text,
	"complaint" text,
	"timestamp" text,
	"viewed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
