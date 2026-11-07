import type { Timestamp } from "firebase/firestore";
import type { AccountStatus, IdType, RedemptionStatus, Role, TxStatus, TxType } from "@shared/domain";

export type WithId<T> = T & { id: string };

export interface UserProfile { role: Role; displayName: string; email: string | null; status: AccountStatus; distributorId?: string; affiliateId?: string }

export interface Distributor {
  name: string; ruc: string | null; contactName: string | null; phone: string | null; email: string; city: string | null;
  province: string | null; address: string | null; registrationCode: string; status: AccountStatus; ownerUid: string;
  affiliateCount: number; purchaseCount: number; pointsGenerated: number; salesCents: number; reversalCount: number;
  lastPurchaseAt: Timestamp | null; createdAt: Timestamp; statusReason?: string;
}

export interface Affiliate {
  uid: string; fullName: string; idType: IdType; idNumber: string; phone: string; email: string | null; code: string;
  qrToken: string; distributorId: string | null; distributorName: string | null; status: AccountStatus; createdAt: Timestamp;
}

export interface Wallet {
  affiliateId: string; balance: number; reserved: number; totalEarned: number; totalRedeemed: number; totalAdjusted: number;
  updatedAt: Timestamp;
}

export interface Transaction {
  type: TxType; status: TxStatus; affiliateId: string; affiliateName: string; affiliateCode: string;
  distributorId: string | null; distributorName: string | null; amountCents: number; points: number; balanceAfter: number;
  reference?: string | null; reason?: string; flags: string[]; createdBy: string; createdByRole: Role; createdAt: Timestamp | null;
  rewardName?: string; redemptionCode?: string; reversalReason?: string; originalTransactionId?: string;
}

export interface Reward {
  name: string; description: string; pointsCost: number; imageUrl: string | null; imagePath: string | null; stock: number | null;
  category: string | null; active: boolean; sortOrder: number; redeemedCount: number;
}

export interface Redemption {
  affiliateId: string; affiliateName: string; affiliateCode: string; rewardId: string; rewardName: string;
  rewardImageUrl: string | null; pointsCost: number; status: RedemptionStatus; code: string | null; note?: string | null;
  requestedAt: Timestamp | null; approvedAt?: Timestamp; approvedBy?: string; deliveredAt?: Timestamp;
}

export interface GlobalStats {
  distributorsTotal?: number; distributorsActive?: number; affiliates?: number; purchases?: number; salesCents?: number;
  pointsGenerated?: number; pointsRedeemed?: number; pointsAdjusted?: number; pointsInCirculation?: number;
  redemptions?: number; redemptionsPending?: number; reversals?: number; flagged?: number;
}

export interface MonthlyStats { month: string; purchases?: number; salesCents?: number; pointsGenerated?: number; pointsRedeemed?: number; newAffiliates?: number }

export interface AuditLog { action: string; actorUid: string; actorRole: string; targetType: string; targetId: string; data: Record<string, unknown>; createdAt: Timestamp | null }
