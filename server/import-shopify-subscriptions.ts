import Stripe from 'stripe';
import { storage } from './storage';
import { db } from './db';
import { subscriptions } from '../shared/schema';
import { eq } from 'drizzle-orm';
import type { InsertUser, InsertSubscription, InsertSubscriptionItem } from '../shared/schema';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

interface ProductMapping {
  stripeProductId: string;
  localProductId: string;
  stripePriceId?: string;
}

interface ImportStats {
  totalSubscriptions: number;
  imported: number;
  skipped: number;
  errors: number;
  details: {
    customersCreated: number;
    subscriptionsCreated: number;
    itemsCreated: number;
  };
}

async function findOrCreateUser(
  email: string,
  name: string,
  phone: string,
  stripeCustomerId: string
): Promise<string> {
  const existingUser = await storage.getUserByEmailOrUsername(email);
  
  if (existingUser) {
    console.log(`  ✓ Found existing user: ${email}`);
    return existingUser.id;
  }

  const nameParts = name.split(' ');
  const firstName = nameParts[0] || 'Unknown';
  const lastName = nameParts.slice(1).join(' ') || '';

  const newUser: InsertUser = {
    email,
    username: email.split('@')[0],
    firstName,
    lastName,
    phoneNumber: phone || '',
  };

  const user = await storage.createUser(newUser);
  console.log(`  ✓ Created new user: ${email}`);
  return user.id;
}

async function getProductMappings(): Promise<ProductMapping[]> {
  const localProducts = await storage.getProducts();
  const mappings: ProductMapping[] = [];

  console.log('\n📦 Creating product mappings...');
  console.log('Available local products:');
  localProducts.forEach(p => {
    console.log(`  - ${p.name} (ID: ${p.id})`);
  });

  console.log('\n⚠️  You need to map your Stripe products to local products.');
  console.log('Edit the productMappings array in this script to match your products.');
  console.log('Example format:');
  console.log('  { stripeProductId: "prod_XXX", localProductId: "your-local-id", stripePriceId: "price_XXX" }');
  
  return mappings;
}

function parseDeliveryFrequency(interval: string | null, intervalCount: number | null): string {
  if (!interval || !intervalCount) return 'weekly';
  
  if (interval === 'week') {
    if (intervalCount === 1) return 'weekly';
    if (intervalCount === 2) return 'bi-weekly';
    if (intervalCount === 4) return 'every-4-weeks';
  }
  
  if (interval === 'month') {
    return 'every-4-weeks'; // Map monthly to every-4-weeks
  }
  
  return 'weekly'; // Default
}

function calculateNextDeliveryDate(
  currentPeriodEnd: number,
  frequency: string
): Date {
  const now = Date.now();
  const endDate = currentPeriodEnd * 1000;
  
  if (endDate > now) {
    return new Date(endDate);
  }
  
  const daysToAdd = frequency === 'weekly' ? 7 : 
                    frequency === 'bi-weekly' ? 14 : 28;
  
  return new Date(now + daysToAdd * 24 * 60 * 60 * 1000);
}

async function importSubscriptionFromStripe(
  stripeSubscription: Stripe.Subscription,
  productMappings: ProductMapping[],
  stats: ImportStats
): Promise<void> {
  try {
    console.log(`\n📋 Processing subscription: ${stripeSubscription.id}`);
    
    if (stripeSubscription.status === 'canceled' || 
        stripeSubscription.status === 'incomplete_expired') {
      console.log(`  ⊘ Skipping ${stripeSubscription.status} subscription`);
      stats.skipped++;
      return;
    }

    const customer = await stripe.customers.retrieve(
      stripeSubscription.customer as string
    );

    if (customer.deleted) {
      console.log('  ⊘ Skipping - customer deleted');
      stats.skipped++;
      return;
    }

    const customerName = customer.name || 
      ('email' in customer ? customer.email : null) || 
      'Unknown Customer';
    const customerEmail = ('email' in customer ? customer.email : null) || '';
    const customerPhone = customer.phone || '';

    if (!customerEmail) {
      console.log('  ✗ Skipping - no customer email');
      stats.errors++;
      return;
    }

    const existingSubscription = await db
      .select()
      .from(subscriptions)
      .where(eq(
        subscriptions.stripeSubscriptionId,
        stripeSubscription.id
      ))
      .limit(1);

    if (existingSubscription.length > 0) {
      console.log('  ⊘ Already imported');
      stats.skipped++;
      return;
    }

    const userId = await findOrCreateUser(
      customerEmail,
      customerName,
      customerPhone,
      customer.id
    );
    stats.details.customersCreated++;

    const firstItem = stripeSubscription.items.data[0];
    if (!firstItem) {
      console.log('  ✗ No subscription items found');
      stats.errors++;
      return;
    }

    const stripePriceId = firstItem.price.id;
    const stripeProductId = typeof firstItem.price.product === 'string' 
      ? firstItem.price.product 
      : firstItem.price.product?.id;

    const mapping = productMappings.find(
      m => m.stripeProductId === stripeProductId || m.stripePriceId === stripePriceId
    );

    if (!mapping) {
      console.log(`  ⚠️  No product mapping found for Stripe product: ${stripeProductId}`);
      console.log(`     Price ID: ${stripePriceId}`);
      stats.errors++;
      return;
    }

    const frequency = parseDeliveryFrequency(
      firstItem.price.recurring?.interval || null,
      firstItem.price.recurring?.interval_count || null
    );

    const nextDeliveryDate = calculateNextDeliveryDate(
      firstItem.current_period_end || (stripeSubscription as any).current_period_end || Math.floor(Date.now() / 1000),
      frequency
    );

    const subscriptionData: InsertSubscription = {
      userId,
      customerName,
      customerEmail,
      customerPhone,
      productId: mapping.localProductId,
      subscriptionFrequency: frequency,
      stripeSubscriptionId: stripeSubscription.id,
      stripeCustomerId: customer.id,
      status: stripeSubscription.status === 'active' ? 'active' : 'paused',
      nextDeliveryDate,
    };

    const newSubscription = await storage.createSubscription(subscriptionData);
    console.log(`  ✓ Created subscription: ${newSubscription.id}`);
    stats.details.subscriptionsCreated++;

    for (const item of stripeSubscription.items.data) {
      const itemPriceId = item.price.id;
      const itemProductId = typeof item.price.product === 'string'
        ? item.price.product
        : item.price.product?.id;

      const itemMapping = productMappings.find(
        m => m.stripeProductId === itemProductId || m.stripePriceId === itemPriceId
      );

      if (!itemMapping) {
        console.log(`    ⚠️  Skipping item - no mapping for product: ${itemProductId}`);
        continue;
      }

      const subscriptionItem: InsertSubscriptionItem = {
        subscriptionId: newSubscription.id,
        productId: itemMapping.localProductId,
        quantity: item.quantity || 1,
      };

      await storage.addSubscriptionItem(subscriptionItem);
      console.log(`    ✓ Added item: ${itemMapping.localProductId} (qty: ${item.quantity})`);
      stats.details.itemsCreated++;
    }

    stats.imported++;
  } catch (error) {
    console.error(`  ✗ Error importing subscription ${stripeSubscription.id}:`, error);
    stats.errors++;
  }
}

export async function importShopifySubscriptions(
  options: {
    dryRun?: boolean;
    limit?: number;
    status?: Stripe.Subscription.Status[];
  } = {}
): Promise<ImportStats> {
  const { dryRun = false, limit, status = ['active', 'trialing', 'past_due'] } = options;

  console.log('\n🚀 Starting Shopify/Stripe Subscription Import');
  console.log('='.repeat(50));
  
  if (dryRun) {
    console.log('⚠️  DRY RUN MODE - No data will be written\n');
  }

  const stats: ImportStats = {
    totalSubscriptions: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    details: {
      customersCreated: 0,
      subscriptionsCreated: 0,
      itemsCreated: 0,
    },
  };

  try {
    const productMappings = await getProductMappings();

    if (productMappings.length === 0) {
      console.log('\n❌ ERROR: No product mappings configured!');
      console.log('\nPlease edit this script and add your product mappings.');
      console.log('Example:');
      console.log('```typescript');
      console.log('const productMappings: ProductMapping[] = [');
      console.log('  {');
      console.log('    stripeProductId: "prod_XXX",  // From Stripe Dashboard');
      console.log('    localProductId: "0628de93-...", // From your local products');
      console.log('    stripePriceId: "price_XXX"  // Optional: specific price ID');
      console.log('  },');
      console.log('];');
      console.log('```\n');
      return stats;
    }

    console.log('\n📥 Fetching subscriptions from Stripe...');
    
    const subscriptions: Stripe.Subscription[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore && (!limit || subscriptions.length < limit)) {
      const response = await stripe.subscriptions.list({
        limit: 100,
        status: status.length === 1 ? status[0] : undefined,
        starting_after: startingAfter,
        expand: ['data.customer'],
      });

      subscriptions.push(...response.data);
      hasMore = response.has_more;
      
      if (response.data.length > 0) {
        startingAfter = response.data[response.data.length - 1].id;
      }

      if (limit && subscriptions.length >= limit) {
        subscriptions.splice(limit);
        break;
      }
    }

    stats.totalSubscriptions = subscriptions.length;
    console.log(`✓ Found ${stats.totalSubscriptions} subscriptions\n`);

    if (dryRun) {
      console.log('📊 DRY RUN - Would process the following subscriptions:');
      subscriptions.forEach(sub => {
        const customerInfo = typeof sub.customer === 'string' 
          ? sub.customer 
          : (sub.customer && 'email' in sub.customer ? sub.customer.email : 'N/A');
        console.log(`  - ${sub.id} (${sub.status}) - Customer: ${customerInfo}`);
      });
      return stats;
    }

    for (const subscription of subscriptions) {
      await importSubscriptionFromStripe(subscription, productMappings, stats);
    }

  } catch (error) {
    console.error('\n❌ Import failed:', error);
    throw error;
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 Import Summary');
  console.log('='.repeat(50));
  console.log(`Total subscriptions found: ${stats.totalSubscriptions}`);
  console.log(`✓ Successfully imported:   ${stats.imported}`);
  console.log(`⊘ Skipped:                ${stats.skipped}`);
  console.log(`✗ Errors:                 ${stats.errors}`);
  console.log('\nDetails:');
  console.log(`  Customers created:       ${stats.details.customersCreated}`);
  console.log(`  Subscriptions created:   ${stats.details.subscriptionsCreated}`);
  console.log(`  Items created:           ${stats.details.itemsCreated}`);
  console.log('='.repeat(50) + '\n');

  return stats;
}

if (require.main === module) {
  importShopifySubscriptions({ dryRun: true, limit: 10 })
    .then(() => {
      console.log('✅ Import process completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Import process failed:', error);
      process.exit(1);
    });
}
