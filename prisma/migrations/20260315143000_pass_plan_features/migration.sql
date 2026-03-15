-- CreateEnum
CREATE TYPE "PassFeatureIcon" AS ENUM (
  'TICKET',
  'FLAME',
  'SNOWFLAKE',
  'CALENDAR',
  'GIFT',
  'DUMBBELL',
  'POOL',
  'COMBO'
);

-- CreateTable
CREATE TABLE "PassFeature" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "icon" "PassFeatureIcon" NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PassFeature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PassFeature_planId_sortOrder_idx" ON "PassFeature"("planId", "sortOrder");

-- AddForeignKey
ALTER TABLE "PassFeature"
ADD CONSTRAINT "PassFeature_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "PassPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
