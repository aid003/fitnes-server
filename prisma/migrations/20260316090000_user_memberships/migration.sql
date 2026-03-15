-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'FROZEN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MembershipFreezeStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MembershipRenewalStatus" AS ENUM ('PENDING', 'PROCESSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "UserMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passPlanId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "freezeDaysLimit" INTEGER NOT NULL DEFAULT 0,
    "freezeDaysUsed" INTEGER NOT NULL DEFAULT 0,
    "canRenew" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMembershipFreeze" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "daysUsed" INTEGER NOT NULL,
    "status" "MembershipFreezeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMembershipFreeze_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMembershipRenewalRequest" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "comment" TEXT,
    "status" "MembershipRenewalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMembershipRenewalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserMembership_userId_status_startsAt_idx" ON "UserMembership"("userId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "UserMembership_passPlanId_idx" ON "UserMembership"("passPlanId");

-- CreateIndex
CREATE INDEX "UserMembershipFreeze_membershipId_status_startsAt_idx" ON "UserMembershipFreeze"("membershipId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "UserMembershipRenewalRequest_membershipId_status_createdAt_idx" ON "UserMembershipRenewalRequest"("membershipId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "UserMembershipRenewalRequest_userId_status_createdAt_idx" ON "UserMembershipRenewalRequest"("userId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "UserMembership" ADD CONSTRAINT "UserMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMembership" ADD CONSTRAINT "UserMembership_passPlanId_fkey" FOREIGN KEY ("passPlanId") REFERENCES "PassPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMembershipFreeze" ADD CONSTRAINT "UserMembershipFreeze_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "UserMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMembershipRenewalRequest" ADD CONSTRAINT "UserMembershipRenewalRequest_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "UserMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMembershipRenewalRequest" ADD CONSTRAINT "UserMembershipRenewalRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
