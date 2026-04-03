DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentGatewayProvider') THEN
    CREATE TYPE "PaymentGatewayProvider" AS ENUM ('ALFA', 'TBANK');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentOrderEventType') THEN
    CREATE TYPE "PaymentOrderEventType" AS ENUM (
      'INIT_REQUEST',
      'INIT_RESPONSE',
      'GET_STATE_REQUEST',
      'GET_STATE_RESPONSE',
      'WEBHOOK_RECEIVED',
      'WEBHOOK_REJECTED',
      'REFUND_REQUEST',
      'REFUND_RESPONSE',
      'STATUS_SYNC'
    );
  END IF;
END $$;

ALTER TYPE "PaymentOrderStatus" ADD VALUE IF NOT EXISTS 'REDIRECT_READY';
ALTER TYPE "PaymentOrderStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "PaymentOrderStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

ALTER TABLE "PaymentOrder"
  ADD COLUMN IF NOT EXISTS "gatewayProvider" "PaymentGatewayProvider" NOT NULL DEFAULT 'ALFA',
  ADD COLUMN IF NOT EXISTS "gatewayPaymentId" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayErrorCode" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptPayload" JSONB,
  ADD COLUMN IF NOT EXISTS "refundedAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "notificationTokenValid" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "lastNotificationAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentOrder_gatewayPaymentId_key" ON "PaymentOrder"("gatewayPaymentId");
CREATE INDEX IF NOT EXISTS "PaymentOrder_gatewayProvider_createdAt_idx" ON "PaymentOrder"("gatewayProvider", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentOrder_gatewayStatus_createdAt_idx" ON "PaymentOrder"("gatewayStatus", "createdAt");

CREATE TABLE IF NOT EXISTS "PaymentOrderEvent" (
  "id" TEXT NOT NULL,
  "paymentOrderId" TEXT NOT NULL,
  "type" "PaymentOrderEventType" NOT NULL,
  "gatewayStatus" TEXT,
  "success" BOOLEAN,
  "errorCode" TEXT,
  "message" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentOrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaymentOrderEvent_paymentOrderId_createdAt_idx" ON "PaymentOrderEvent"("paymentOrderId", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentOrderEvent_type_createdAt_idx" ON "PaymentOrderEvent"("type", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'PaymentOrderEvent_paymentOrderId_fkey'
  ) THEN
    ALTER TABLE "PaymentOrderEvent"
      ADD CONSTRAINT "PaymentOrderEvent_paymentOrderId_fkey"
      FOREIGN KEY ("paymentOrderId") REFERENCES "PaymentOrder"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
