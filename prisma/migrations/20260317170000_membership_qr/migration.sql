-- AlterTable
ALTER TABLE "UserMembership"
ADD COLUMN     "qrPayload" JSONB,
ADD COLUMN     "qrSignature" TEXT,
ADD COLUMN     "qrCodeSvg" TEXT,
ADD COLUMN     "qrGeneratedAt" TIMESTAMP(3);
