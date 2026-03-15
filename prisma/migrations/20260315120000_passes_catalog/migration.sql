-- CreateEnum
CREATE TYPE "DurationUnit" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('FIXED_TERM', 'UNLIMITED', 'SINGLE_VISIT', 'VISIT_PACK');

-- CreateTable
CREATE TABLE "PassCategory" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "coverImageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PassCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassVariant" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PassVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassPlanGroup" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PassPlanGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassPlan" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "subtitle" TEXT,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "durationValue" INTEGER,
    "durationUnit" "DurationUnit",
    "visitCount" INTEGER,
    "billingType" "BillingType",
    "highlightStyle" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PassPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassBadge" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "style" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PassBadge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PassCategory_slug_key" ON "PassCategory"("slug");

-- CreateIndex
CREATE INDEX "PassCategory_isActive_sortOrder_idx" ON "PassCategory"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PassVariant_categoryId_slug_key" ON "PassVariant"("categoryId", "slug");

-- CreateIndex
CREATE INDEX "PassVariant_categoryId_isActive_sortOrder_idx" ON "PassVariant"("categoryId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PassPlanGroup_variantId_slug_key" ON "PassPlanGroup"("variantId", "slug");

-- CreateIndex
CREATE INDEX "PassPlanGroup_variantId_isActive_sortOrder_idx" ON "PassPlanGroup"("variantId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PassPlan_groupId_slug_key" ON "PassPlan"("groupId", "slug");

-- CreateIndex
CREATE INDEX "PassPlan_groupId_isActive_sortOrder_idx" ON "PassPlan"("groupId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "PassBadge_planId_sortOrder_idx" ON "PassBadge"("planId", "sortOrder");

-- AddForeignKey
ALTER TABLE "PassVariant" ADD CONSTRAINT "PassVariant_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PassCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassPlanGroup" ADD CONSTRAINT "PassPlanGroup_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PassVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassPlan" ADD CONSTRAINT "PassPlan_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PassPlanGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassBadge" ADD CONSTRAINT "PassBadge_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PassPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
