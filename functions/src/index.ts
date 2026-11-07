import { setGlobalOptions } from "firebase-functions/v2";

// Región: cambia FUNCTIONS_REGION en functions/.env (y VITE_FUNCTIONS_REGION en web) si lo necesitas.
setGlobalOptions({ region: process.env.FUNCTIONS_REGION || "us-east1", maxInstances: 20 });

export { registerAffiliate, lookupAffiliate, searchAffiliates, updateMyProfile, resolveRegistrationCode } from "./affiliates";
export { createDistributor, updateDistributor, setAccountStatus, resetUserPassword } from "./distributors";
export { registerPurchase, reversePurchase, adjustPoints, runIntegrityCheck } from "./purchases";
export { saveReward, requestRedemption, cancelRedemption, resolveRedemption } from "./rewards";
export { updatePointsConfig } from "./config";
