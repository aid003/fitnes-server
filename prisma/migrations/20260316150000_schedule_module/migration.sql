-- CreateEnum
CREATE TYPE "ScheduleWeekday" AS ENUM (
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY'
);

-- CreateTable
CREATE TABLE "ScheduleTemplateSlot" (
  "id" TEXT NOT NULL,
  "weekday" "ScheduleWeekday" NOT NULL,
  "title" TEXT NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "ageBadge" TEXT,
  "secondaryBadge" TEXT,
  "bookingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ScheduleTemplateSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleDateOverride" (
  "id" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "isClosed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ScheduleDateOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleDateOverrideSlot" (
  "id" TEXT NOT NULL,
  "overrideId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "ageBadge" TEXT,
  "secondaryBadge" TEXT,
  "bookingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ScheduleDateOverrideSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleTemplateSlot_weekday_isActive_sortOrder_startTime_idx" ON "ScheduleTemplateSlot"("weekday", "isActive", "sortOrder", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleDateOverride_date_key" ON "ScheduleDateOverride"("date");

-- CreateIndex
CREATE INDEX "ScheduleDateOverrideSlot_overrideId_isActive_sortOrder_startTim_idx" ON "ScheduleDateOverrideSlot"("overrideId", "isActive", "sortOrder", "startTime");

-- AddForeignKey
ALTER TABLE "ScheduleDateOverrideSlot" ADD CONSTRAINT "ScheduleDateOverrideSlot_overrideId_fkey" FOREIGN KEY ("overrideId") REFERENCES "ScheduleDateOverride"("id") ON DELETE CASCADE ON UPDATE CASCADE;
