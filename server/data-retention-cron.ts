import cron from 'node-cron';
import { db } from './db';
import { emailVerificationCodes, verificationCodes } from '../shared/schema';
import { lt, and, sql } from 'drizzle-orm';
import { sendDataRetentionNotification } from './email';

/**
 * Data Retention Enforcement
 * Implements automatic cleanup of data according to our retention policy
 */

/**
 * Clean up expired email verification codes (older than 24 hours)
 * Per our data retention policy, verification codes are retained for 24 hours max
 */
export async function cleanupExpiredEmailVerificationCodes(): Promise<number> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const result = await db
      .delete(emailVerificationCodes)
      .where(lt(emailVerificationCodes.createdAt, twentyFourHoursAgo))
      .returning({ id: emailVerificationCodes.id });
    
    const deletedCount = result.length;
    if (deletedCount > 0) {
      console.log(`[DATA RETENTION] Cleaned up ${deletedCount} expired email verification codes`);
    }
    return deletedCount;
  } catch (error) {
    console.error('[DATA RETENTION] Error cleaning up email verification codes:', error);
    return 0;
  }
}

/**
 * Clean up expired SMS verification codes (older than 24 hours)
 * Per our data retention policy, verification codes are retained for 24 hours max
 */
export async function cleanupExpiredSMSVerificationCodes(): Promise<number> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const result = await db
      .delete(verificationCodes)
      .where(lt(verificationCodes.createdAt, twentyFourHoursAgo))
      .returning({ id: verificationCodes.id });
    
    const deletedCount = result.length;
    if (deletedCount > 0) {
      console.log(`[DATA RETENTION] Cleaned up ${deletedCount} expired SMS verification codes`);
    }
    return deletedCount;
  } catch (error) {
    console.error('[DATA RETENTION] Error cleaning up SMS verification codes:', error);
    return 0;
  }
}

/**
 * Clean up consumed/used email verification codes (older than 1 hour after consumption)
 * These are codes that have been successfully used
 */
export async function cleanupConsumedEmailVerificationCodes(): Promise<number> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const result = await db
      .delete(emailVerificationCodes)
      .where(
        and(
          lt(emailVerificationCodes.consumedAt, oneHourAgo),
          sql`${emailVerificationCodes.consumedAt} IS NOT NULL`
        )
      )
      .returning({ id: emailVerificationCodes.id });
    
    const deletedCount = result.length;
    if (deletedCount > 0) {
      console.log(`[DATA RETENTION] Cleaned up ${deletedCount} consumed email verification codes`);
    }
    return deletedCount;
  } catch (error) {
    console.error('[DATA RETENTION] Error cleaning up consumed email verification codes:', error);
    return 0;
  }
}

/**
 * Clean up consumed/used SMS verification codes (older than 1 hour after consumption)
 * These are codes that have been successfully used
 */
export async function cleanupConsumedSMSVerificationCodes(): Promise<number> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const result = await db
      .delete(verificationCodes)
      .where(
        and(
          lt(verificationCodes.consumedAt, oneHourAgo),
          sql`${verificationCodes.consumedAt} IS NOT NULL`
        )
      )
      .returning({ id: verificationCodes.id });
    
    const deletedCount = result.length;
    if (deletedCount > 0) {
      console.log(`[DATA RETENTION] Cleaned up ${deletedCount} consumed SMS verification codes`);
    }
    return deletedCount;
  } catch (error) {
    console.error('[DATA RETENTION] Error cleaning up consumed SMS verification codes:', error);
    return 0;
  }
}

/**
 * Run all cleanup tasks
 */
export async function runAllCleanupTasks(): Promise<void> {
  console.log('[DATA RETENTION] Running scheduled cleanup tasks...');
  
  // Clean up and track deletion counts
  const emailCodesDeleted = await cleanupExpiredEmailVerificationCodes();
  const consumedEmailCodesDeleted = await cleanupConsumedEmailVerificationCodes();
  const smsCodesDeleted = await cleanupExpiredSMSVerificationCodes();
  const consumedSmsCodesDeleted = await cleanupConsumedSMSVerificationCodes();
  
  const totalDeleted = emailCodesDeleted + consumedEmailCodesDeleted + smsCodesDeleted + consumedSmsCodesDeleted;
  
  // Send admin notification if anything was deleted
  if (totalDeleted > 0) {
    try {
      await sendDataRetentionNotification({
        emailCodesDeleted,
        smsCodesDeleted,
        consumedEmailCodesDeleted,
        consumedSmsCodesDeleted,
      });
    } catch (error) {
      console.error('[DATA RETENTION] Failed to send admin notification:', error);
    }
  }
  
  console.log('[DATA RETENTION] Cleanup tasks completed');
}

/**
 * Schedule data retention cleanup jobs
 * Runs every hour to clean up expired data
 */
export function scheduleDataRetentionJobs(): void {
  // Run cleanup every hour at minute 30
  cron.schedule('30 * * * *', async () => {
    console.log('[DATA RETENTION] Hourly cleanup job started');
    await runAllCleanupTasks();
  });
  
  console.log('[DATA RETENTION] Scheduled hourly cleanup job (runs at :30 of every hour)');
  
  // Run initial cleanup on startup (after a short delay to let the app initialize)
  setTimeout(async () => {
    console.log('[DATA RETENTION] Running initial cleanup on startup...');
    await runAllCleanupTasks();
  }, 10000); // 10 second delay
}
