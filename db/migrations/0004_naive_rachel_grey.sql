ALTER TABLE "users" ADD COLUMN "demo_username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "demo_password" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_demo_username_unique" UNIQUE("demo_username");