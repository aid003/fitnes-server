CREATE TABLE "RememberSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RememberSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RememberSession_tokenHash_key" ON "RememberSession"("tokenHash");
CREATE INDEX "RememberSession_userId_expiresAt_idx" ON "RememberSession"("userId", "expiresAt");
CREATE INDEX "RememberSession_expiresAt_revokedAt_idx" ON "RememberSession"("expiresAt", "revokedAt");

ALTER TABLE "RememberSession"
ADD CONSTRAINT "RememberSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduleTemplateSlot"
DROP COLUMN "bookingEnabled";
