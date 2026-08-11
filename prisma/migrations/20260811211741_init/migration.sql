-- CreateEnum
CREATE TYPE "Role" AS ENUM ('BUYER', 'ADMIN');

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('VALID', 'EXPIRING_SOON', 'EXPIRED', 'INVALID');

-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'CLOSING_EXTENDED', 'CLOSED_WON', 'CLOSED_UNSOLD', 'PAYMENT_PENDING', 'PAID', 'DELIVERY_SCHEDULED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RESOLVED_REFUND', 'RESOLVED_REDELIVERY', 'LAST_CHANCE', 'SOLD_BUYNOW', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProxyBidStatus" AS ENUM ('ACTIVE', 'CEILING_REACHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'STRIPE');

-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('AUCTION_WIN', 'SECOND_CHANCE', 'BUY_NOW');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_CHARGE', 'OFFERED', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "RefundReasonCode" AS ENUM ('WINNER_CANCEL_RESTOCKING', 'OUR_FAULT_DELIVERY', 'GOODWILL_50', 'ADMIN_FULL', 'ADMIN_PARTIAL', 'DISPUTE', 'OTHER');

-- CreateEnum
CREATE TYPE "DeliveryWindow" AS ENUM ('W10_12', 'W12_15', 'W15_17');

-- CreateEnum
CREATE TYPE "DeliveryFailureReason" AS ENUM ('RECIPIENT_UNREACHABLE', 'WRONG_ADDRESS', 'RECIPIENT_REFUSED', 'OUR_FAULT', 'OTHER');

-- CreateEnum
CREATE TYPE "DeliveryResolution" AS ENUM ('REDELIVERY', 'PICKUP', 'REFUND', 'RETURNED_DONATED');

-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('DROP_LIVE', 'OUTBID', 'MAX_BID_REACHED', 'CLOSING_SOON', 'WON', 'LOST', 'PAYMENT_FAILED', 'SECOND_CHANCE_OFFER', 'DELIVERY_DETAILS_REMINDER', 'DELIVERY_SCHEDULED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'LAST_CHANCE');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'PUSH', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SUPPRESSED_PREF', 'SUPPRESSED_QUIET_HOURS');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'BUYER',
    "stripeCustomerId" TEXT,
    "paymentFailureCount" INTEGER NOT NULL DEFAULT 0,
    "biddingSuspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "quietHoursStart" INTEGER NOT NULL DEFAULT 21,
    "quietHoursEnd" INTEGER NOT NULL DEFAULT 8,
    "timezone" TEXT NOT NULL DEFAULT 'America/Vancouver',
    "unsubscribeToken" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripePaymentMethodId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "expMonth" INTEGER NOT NULL,
    "expYear" INTEGER NOT NULL,
    "status" "CardStatus" NOT NULL DEFAULT 'VALID',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "AuctionStatus" NOT NULL DEFAULT 'DRAFT',
    "startPriceCents" INTEGER NOT NULL,
    "minIncrementCents" INTEGER NOT NULL DEFAULT 500,
    "scheduledStartAt" TIMESTAMP(3),
    "scheduledEndAt" TIMESTAMP(3),
    "currentEndAt" TIMESTAMP(3),
    "extensionCount" INTEGER NOT NULL DEFAULT 0,
    "lastChanceExpiresAt" TIMESTAMP(3),
    "currentBidId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionPhoto" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "blurDataUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionParticipant" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bidderNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "isProxy" BOOLEAN NOT NULL DEFAULT false,
    "proxyBidId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyBid" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ceilingCents" INTEGER NOT NULL,
    "status" "ProxyBidStatus" NOT NULL DEFAULT 'ACTIVE',
    "notifiedCeilingReachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProxyBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionEvent" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" "AuctionStatus",
    "toStatus" "AuctionStatus",
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "OrderKind" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_CHARGE',
    "subtotalCents" INTEGER NOT NULL,
    "gstCents" INTEGER NOT NULL DEFAULT 0,
    "pstCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "stripePaymentIntentId" TEXT,
    "chargeAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "fixCardDeadlineAt" TIMESTAMP(3),
    "offerToken" TEXT,
    "offerExpiresAt" TIMESTAMP(3),
    "offerRespondedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stripeRefundId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "reasonCode" "RefundReasonCode" NOT NULL,
    "note" TEXT,
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "issuedById" TEXT,
    "sourceOrderId" TEXT,
    "consumedByOrderId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Credit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Prince George',
    "province" TEXT NOT NULL DEFAULT 'BC',
    "postalCode" TEXT NOT NULL,
    "postalOverride" BOOLEAN NOT NULL DEFAULT false,
    "window" "DeliveryWindow" NOT NULL,
    "giftNote" VARCHAR(240),
    "anonymousSender" BOOLEAN NOT NULL DEFAULT false,
    "buyerPhone" TEXT NOT NULL,
    "scheduledDate" DATE,
    "routePosition" INTEGER,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMP(3),
    "deliveryPhotoUrl" TEXT,
    "gpsLat" DOUBLE PRECISION,
    "gpsLng" DOUBLE PRECISION,
    "failureReason" "DeliveryFailureReason",
    "failureNote" TEXT,
    "failurePhotoUrl" TEXT,
    "resolution" "DeliveryResolution",
    "redeliveryFeeCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPref" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "email" BOOLEAN NOT NULL,
    "push" BOOLEAN NOT NULL,
    "sms" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "event" "NotificationEvent" NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "verifyToken" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "unsubscribeToken" TEXT NOT NULL,
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_unsubscribeToken_key" ON "User"("unsubscribeToken");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_stripePaymentMethodId_key" ON "PaymentMethod"("stripePaymentMethodId");

-- CreateIndex
CREATE INDEX "PaymentMethod_userId_idx" ON "PaymentMethod"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Auction_slug_key" ON "Auction"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Auction_currentBidId_key" ON "Auction"("currentBidId");

-- CreateIndex
CREATE INDEX "Auction_status_currentEndAt_idx" ON "Auction"("status", "currentEndAt");

-- CreateIndex
CREATE INDEX "Auction_status_scheduledStartAt_idx" ON "Auction"("status", "scheduledStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionPhoto_auctionId_position_key" ON "AuctionPhoto"("auctionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionParticipant_auctionId_userId_key" ON "AuctionParticipant"("auctionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionParticipant_auctionId_bidderNumber_key" ON "AuctionParticipant"("auctionId", "bidderNumber");

-- CreateIndex
CREATE INDEX "Bid_auctionId_amountCents_createdAt_idx" ON "Bid"("auctionId", "amountCents" DESC, "createdAt");

-- CreateIndex
CREATE INDEX "Bid_userId_createdAt_idx" ON "Bid"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyBid_auctionId_userId_key" ON "ProxyBid"("auctionId", "userId");

-- CreateIndex
CREATE INDEX "AuctionEvent_auctionId_createdAt_idx" ON "AuctionEvent"("auctionId", "createdAt");

-- CreateIndex
CREATE INDEX "AuctionEvent_type_createdAt_idx" ON "AuctionEvent"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_stripePaymentIntentId_key" ON "Order"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_offerToken_key" ON "Order"("offerToken");

-- CreateIndex
CREATE INDEX "Order_auctionId_idx" ON "Order"("auctionId");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_nextRetryAt_idx" ON "Order"("status", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_stripeRefundId_key" ON "Refund"("stripeRefundId");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE INDEX "Credit_userId_idx" ON "Credit"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_orderId_key" ON "Delivery"("orderId");

-- CreateIndex
CREATE INDEX "Delivery_scheduledDate_routePosition_idx" ON "Delivery"("scheduledDate", "routePosition");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPref_userId_event_key" ON "NotificationPref"("userId", "event");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_dedupeKey_key" ON "NotificationLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationLog_status_createdAt_idx" ON "NotificationLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_createdAt_idx" ON "NotificationLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSubscriber_email_key" ON "EmailSubscriber"("email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSubscriber_verifyToken_key" ON "EmailSubscriber"("verifyToken");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSubscriber_unsubscribeToken_key" ON "EmailSubscriber"("unsubscribeToken");

-- CreateIndex
CREATE UNIQUE INDEX "StripeWebhookEvent_stripeEventId_key" ON "StripeWebhookEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_type_receivedAt_idx" ON "StripeWebhookEvent"("type", "receivedAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_currentBidId_fkey" FOREIGN KEY ("currentBidId") REFERENCES "Bid"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionPhoto" ADD CONSTRAINT "AuctionPhoto_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionParticipant" ADD CONSTRAINT "AuctionParticipant_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionParticipant" ADD CONSTRAINT "AuctionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_proxyBidId_fkey" FOREIGN KEY ("proxyBidId") REFERENCES "ProxyBid"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyBid" ADD CONSTRAINT "ProxyBid_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyBid" ADD CONSTRAINT "ProxyBid_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionEvent" ADD CONSTRAINT "AuctionEvent_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionEvent" ADD CONSTRAINT "AuctionEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credit" ADD CONSTRAINT "Credit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credit" ADD CONSTRAINT "Credit_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credit" ADD CONSTRAINT "Credit_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credit" ADD CONSTRAINT "Credit_consumedByOrderId_fkey" FOREIGN KEY ("consumedByOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPref" ADD CONSTRAINT "NotificationPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
