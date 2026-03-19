CREATE TYPE "EmailChallengePurpose" AS ENUM ('REGISTER', 'PASSWORD_RECOVERY');

ALTER TABLE "EmailLoginChallenge"
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "purpose" "EmailChallengePurpose" NOT NULL DEFAULT 'PASSWORD_RECOVERY';

CREATE UNIQUE INDEX "EmailLoginChallenge_email_purpose_key" ON "EmailLoginChallenge"("email", "purpose");
