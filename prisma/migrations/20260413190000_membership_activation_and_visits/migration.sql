ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'PENDING_ACTIVATION';

ALTER TABLE "UserMembership"
ADD COLUMN "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "activatedAt" TIMESTAMP(3),
ADD COLUMN "billingType" "BillingType",
ADD COLUMN "durationValue" INTEGER,
ADD COLUMN "durationUnit" "DurationUnit",
ADD COLUMN "totalVisits" INTEGER,
ADD COLUMN "usedVisits" INTEGER NOT NULL DEFAULT 0;

UPDATE "UserMembership" AS membership
SET
  "issuedAt" = COALESCE(membership."createdAt", CURRENT_TIMESTAMP),
  "activatedAt" = membership."startsAt",
  "billingType" = plan."billingType",
  "durationValue" = plan."durationValue",
  "durationUnit" = plan."durationUnit",
  "totalVisits" = plan."visitCount"
FROM "PassPlan" AS plan
WHERE plan."id" = membership."passPlanId";

CREATE INDEX "UserMembership_userId_issuedAt_idx"
ON "UserMembership"("userId", "issuedAt");
