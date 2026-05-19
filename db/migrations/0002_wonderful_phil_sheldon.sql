CREATE TABLE "patient_access" (
	"user_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	"notes" text,
	CONSTRAINT "patient_access_user_id_patient_id_pk" PRIMARY KEY("user_id","patient_id")
);
--> statement-breakpoint
DROP TABLE "doctor_patient_links" CASCADE;--> statement-breakpoint
ALTER TABLE "patient_access" ADD CONSTRAINT "patient_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_access" ADD CONSTRAINT "patient_access_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_access" ADD CONSTRAINT "patient_access_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_access_patient_idx" ON "patient_access" USING btree ("patient_id");--> statement-breakpoint
DROP TYPE "public"."doctor_patient_role";