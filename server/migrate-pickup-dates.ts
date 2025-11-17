import { db } from './db';
import { subscriptions } from '@shared/schema';
import { normalizeToAllowedPickupDay } from '@shared/pickup-policy';
import { sql } from 'drizzle-orm';

async function migratePickupDates() {
  console.log('[PICKUP MIGRATION] Starting migration to normalize all subscription pickup dates to Monday-Thursday...');
  
  try {
    // Fetch all active subscriptions
    const allSubscriptions = await db.select().from(subscriptions);
    
    console.log(`[PICKUP MIGRATION] Found ${allSubscriptions.length} total subscriptions`);
    
    let migratedCount = 0;
    let skippedCount = 0;
    
    for (const sub of allSubscriptions) {
      if (!sub.nextDeliveryDate) {
        console.log(`[PICKUP MIGRATION] Skipping subscription ${sub.id} - no next delivery date`);
        skippedCount++;
        continue;
      }
      
      const originalDate = new Date(sub.nextDeliveryDate);
      const normalizedDate = normalizeToAllowedPickupDay(originalDate);
      
      // Check if date changed
      if (originalDate.getTime() !== normalizedDate.getTime()) {
        console.log(`[PICKUP MIGRATION] Normalizing subscription ${sub.id}:`);
        console.log(`  Original: ${originalDate.toISOString()} (${getDayName(originalDate)})`);
        console.log(`  Normalized: ${normalizedDate.toISOString()} (${getDayName(normalizedDate)})`);
        
        await db.update(subscriptions)
          .set({ 
            nextDeliveryDate: normalizedDate,
            nextChargeAt: normalizedDate 
          })
          .where(sql`id = ${sub.id}`);
        
        migratedCount++;
      } else {
        console.log(`[PICKUP MIGRATION] Subscription ${sub.id} already on allowed day (${getDayName(originalDate)})`);
        skippedCount++;
      }
    }
    
    console.log(`[PICKUP MIGRATION] Migration complete:`);
    console.log(`  ${migratedCount} subscriptions normalized`);
    console.log(`  ${skippedCount} subscriptions already compliant or skipped`);
    
  } catch (error) {
    console.error('[PICKUP MIGRATION] Error during migration:', error);
    throw error;
  }
}

function getDayName(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

// Run migration
migratePickupDates()
  .then(() => {
    console.log('[PICKUP MIGRATION] Success!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[PICKUP MIGRATION] Failed:', error);
    process.exit(1);
  });
