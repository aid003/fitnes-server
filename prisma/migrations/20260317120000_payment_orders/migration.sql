-- CreateEnum
CREATE TYPE "PaymentOrderStatus" AS ENUM ('CREATED', 'FORM_REGISTERED', 'REDIRECTED', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passPlanId" TEXT NOT NULL,
    "membershipId" TEXT,
    "merchantOrderNumber" TEXT NOT NULL,
    "gatewayOrderId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'CREATED',
    "gatewayOrderStatus" INTEGER,
    "gatewayPaymentState" TEXT,
    "actionCode" INTEGER,
    "actionCodeDescription" TEXT,
    "formUrl" TEXT,
    "returnUrl" TEXT NOT NULL,
    "failUrl" TEXT NOT NULL,
    "planTitle" TEXT NOT NULL,
    "planSubtitle" TEXT,
    "planDescription" TEXT,
    "payerEmail" TEXT,
    "payerPhone" TEXT,
    "fiscalPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "redirectedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "membershipIssuedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_membershipId_key" ON "PaymentOrder"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_merchantOrderNumber_key" ON "PaymentOrder"("merchantOrderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_gatewayOrderId_key" ON "PaymentOrder"("gatewayOrderId");

-- CreateIndex
CREATE INDEX "PaymentOrder_userId_createdAt_idx" ON "PaymentOrder"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentOrder_passPlanId_createdAt_idx" ON "PaymentOrder"("passPlanId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentOrder_status_createdAt_idx" ON "PaymentOrder"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_passPlanId_fkey" FOREIGN KEY ("passPlanId") REFERENCES "PassPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "UserMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
