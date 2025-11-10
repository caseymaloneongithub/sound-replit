# Shopify Subscription Import Guide

This guide explains how to import your existing Shopify subscriptions (billed through Stripe) into your Puget Sound Kombucha Co. platform.

## Overview

The import process:
1. Fetches subscriptions from your Stripe account
2. Creates or matches existing customer accounts
3. Maps Stripe products to your local products
4. Creates subscriptions with multi-product support
5. Preserves all subscription billing details

## Prerequisites

- Access to your Stripe account
- Stripe Secret Key already configured (STRIPE_SECRET_KEY env variable)
- Knowledge of your Stripe product IDs
- List of your local product IDs

## Step 1: Get Your Product IDs

### Local Product IDs

Run the application and navigate to the products page, or query your database:

```bash
# Using the database
psql $DATABASE_URL -c "SELECT id, name FROM products;"
```

### Stripe Product IDs

Log into your [Stripe Dashboard](https://dashboard.stripe.com):
1. Navigate to **Products** → **Catalog**
2. Click on each product to see its ID (starts with `prod_`)
3. Note the Price ID as well (starts with `price_`)

## Step 2: Configure Product Mappings

Edit `server/import-shopify-subscriptions.ts` and find the `getProductMappings` function (around line 58).

Replace the empty `mappings` array with your product mappings:

```typescript
async function getProductMappings(): Promise<ProductMapping[]> {
  const mappings: ProductMapping[] = [
    {
      stripeProductId: "prod_ABC123",           // Your Stripe product ID
      localProductId: "0628de93-580f-...",      // Your local product ID
      stripePriceId: "price_XYZ789"             // Optional: specific price ID
    },
    {
      stripeProductId: "prod_DEF456",
      localProductId: "a1b2c3d4-5678-...",
      stripePriceId: "price_UVW012"
    },
    // Add more mappings for all your products
  ];
  
  return mappings;
}
```

**Important**: Map ALL products that appear in your Stripe subscriptions, or those subscriptions will be skipped.

## Step 3: Run a Dry Run

Before importing real data, test the import process:

```bash
# From the project root
npx tsx server/import-shopify-subscriptions.ts
```

This runs in **dry-run mode** by default, showing:
- How many subscriptions will be imported
- Which subscriptions will be skipped
- Any missing product mappings

Review the output carefully!

## Step 4: Import Your Subscriptions

Once you're confident with the dry run results, you can import your subscriptions programmatically:

### Option A: Using Node.js Script

Create a file `scripts/import.ts`:

```typescript
import { importShopifySubscriptions } from '../server/import-shopify-subscriptions';

async function main() {
  console.log('Starting import...');
  
  const stats = await importShopifySubscriptions({
    dryRun: false,           // Actually import data
    limit: undefined,        // Import all subscriptions
    status: ['active']       // Only import active subscriptions
  });
  
  console.log('Import complete!', stats);
}

main().catch(console.error);
```

Then run:
```bash
npx tsx scripts/import.ts
```

### Option B: Using the REPL

```typescript
import { importShopifySubscriptions } from './server/import-shopify-subscriptions';

// Import only active subscriptions
await importShopifySubscriptions({ 
  dryRun: false,
  status: ['active']
});

// Import active and past_due subscriptions
await importShopifySubscriptions({ 
  dryRun: false,
  status: ['active', 'past_due']
});

// Import first 10 subscriptions (for testing)
await importShopifySubscriptions({ 
  dryRun: false,
  limit: 10
});
```

## Import Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dryRun` | boolean | `false` | If true, shows what would be imported without making changes |
| `limit` | number | undefined | Maximum number of subscriptions to import (for testing) |
| `status` | array | `['active', 'trialing', 'past_due']` | Which subscription statuses to import |

### Subscription Statuses

- `active` - Currently active subscriptions
- `trialing` - In trial period
- `past_due` - Payment failed but subscription still active
- `canceled` - Cancelled subscriptions (usually skipped)
- `incomplete` - Incomplete subscriptions (usually skipped)
- `incomplete_expired` - Expired incomplete subscriptions (usually skipped)

## What Gets Imported

For each subscription, the script:

1. **Creates or finds customer**:
   - Matches by email address
   - Creates new user account if doesn't exist
   - Links Stripe customer ID

2. **Creates subscription**:
   - Preserves Stripe subscription ID
   - Sets status (active/paused)
   - Calculates next delivery date
   - Maps delivery frequency:
     - Weekly → `weekly`
     - Bi-weekly → `bi-weekly`  
     - Monthly → `every-4-weeks`

3. **Creates subscription items**:
   - Maps each Stripe line item to local products
   - Preserves quantities
   - Supports multi-product subscriptions

## Troubleshooting

### "No product mapping found"

**Problem**: Stripe product ID not in your mapping configuration

**Solution**: Add the missing product mapping to `getProductMappings()`:

```typescript
{
  stripeProductId: "prod_MISSING",  // The ID from the error message
  localProductId: "your-local-id"
}
```

### "Skipping - no customer email"

**Problem**: Stripe customer has no email address

**Solution**: Add email to customer in Stripe Dashboard, or manually create user in your app first

### "Already imported"

**Problem**: Subscription already exists in your database

**Solution**: This is normal - the script skips duplicates. If you need to re-import, delete the subscription first:

```sql
DELETE FROM subscription_items WHERE subscription_id = 'sub-id';
DELETE FROM subscriptions WHERE stripe_subscription_id = 'sub_xxx';
```

### TypeError with Stripe API

**Problem**: Stripe API version mismatch

**Solution**: The script uses the latest Stripe API. If you see type errors, they're usually safe to ignore as the script has fallback handling.

## Post-Import Checklist

After importing:

- [ ] Verify subscription count matches Stripe
- [ ] Check a few subscriptions in the UI (`/my-subscriptions`)
- [ ] Confirm next delivery dates are correct
- [ ] Test adding/removing products from imported subscriptions
- [ ] Verify Stripe webhooks still work for future charges

## Important Notes

### Billing Continues in Stripe

**This import does NOT move billing to your new system.** Your subscriptions will continue to be billed through Stripe using the existing Shopify subscriptions.

The import simply mirrors the data so customers can:
- View their subscriptions
- Manage products
- Update delivery dates
- Cancel subscriptions

You'll need to handle Stripe webhooks to keep the data in sync.

### Stripe Webhooks

After importing, ensure your webhook handlers update local subscriptions when:
- Payment succeeds
- Subscription updated
- Subscription cancelled
- Card updated

### Data Sync

The import is **one-time**. For ongoing sync:
1. Set up Stripe webhooks (already configured in `server/routes.ts`)
2. The webhook handlers will keep data synchronized
3. Future subscriptions created via Stripe will be automatically imported

## Example: Complete Import Flow

```bash
# 1. Get local product IDs
psql $DATABASE_URL -c "SELECT id, name FROM products;"

# 2. Get Stripe product IDs from dashboard
# (Visit https://dashboard.stripe.com/products)

# 3. Edit import script with mappings
nano server/import-shopify-subscriptions.ts

# 4. Test with dry run
npx tsx server/import-shopify-subscriptions.ts

# 5. Review output, fix any issues

# 6. Create import script
cat > scripts/import-real.ts << 'EOF'
import { importShopifySubscriptions } from '../server/import-shopify-subscriptions';
await importShopifySubscriptions({ 
  dryRun: false,
  status: ['active', 'trialing']
});
EOF

# 7. Run actual import
npx tsx scripts/import-real.ts

# 8. Verify in the application
# Visit /my-subscriptions while logged in
```

## Support

If you encounter issues:
1. Check the error messages in console output
2. Verify your product mappings are correct
3. Ensure Stripe API key has proper permissions
4. Review this guide's troubleshooting section

For data issues, you can safely delete test imports:
```sql
-- Remove imported subscriptions
DELETE FROM subscription_items WHERE subscription_id IN (
  SELECT id FROM subscriptions WHERE stripe_subscription_id IS NOT NULL
);
DELETE FROM subscriptions WHERE stripe_subscription_id IS NOT NULL;
```

Then re-run the import after fixing the issues.
