-- CreateTable
CREATE TABLE "AdBanner" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "targetUrl" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "repeatIntervalDays" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdBanner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAdBannerDismissal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bannerId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAdBannerDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdBanner_isActive_startsAt_endsAt_sortOrder_idx" ON "AdBanner"("isActive", "startsAt", "endsAt", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "UserAdBannerDismissal_userId_bannerId_key" ON "UserAdBannerDismissal"("userId", "bannerId");

-- CreateIndex
CREATE INDEX "UserAdBannerDismissal_bannerId_dismissedAt_idx" ON "UserAdBannerDismissal"("bannerId", "dismissedAt");

-- AddForeignKey
ALTER TABLE "UserAdBannerDismissal" ADD CONSTRAINT "UserAdBannerDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAdBannerDismissal" ADD CONSTRAINT "UserAdBannerDismissal_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "AdBanner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
