# Schema Migration Plan: Old → New Product Structure

## Goal
Transition from the current product schema to a new flavor-centric schema that completely separates retail and wholesale product management.

## Current Status: ✅ Phase 1 Complete, 🚧 Phase 2 In Progress

### What's Working
- ✅ **Phase 1 Complete**: Old schema is intact and fully functional
- ✅ **Phase 1 Complete**: New schema tables created alongside old tables  
- ✅ **Phase 1 Complete**: App is running with no errors
- ✅ **Phase 1 Complete**: All existing features continue to work
- ✅ **Phase 2 API**: All backend routes for flavors, retail products, wholesale unit types
- 🚧 **Phase 2 Frontend**: Admin UI tabs added to Staff Portal (in review)

### Schema Architecture

#### OLD SCHEMA (Currently Active)
```
productTypes (pricing tiers)
  ├── products (flavors linked to a pricing tier)
  ├── cartItems (references products)
  ├── subscriptionItems (references products)
  ├── retailOrderItems (references products)
  └── wholesaleOrderItems (references products)

wholesalePricing (custom pricing per customer+productType)
inventoryAdjustments (linked to products)
```

#### NEW SCHEMA (Parallel, Not Yet Active)
```
flavors (master flavor list)
  ├── retailProducts (flavor+unit combinations, individual pricing)
  ├── wholesaleUnitTypes (unit types with default pricing)
  │   └── wholesaleUnitTypeFlavors (junction: which flavors per unit)
  └── (future: inventoryManagement linked to flavors)
```

## Migration Strategy

### Phase 2: Build New Admin Interface (NEXT)
**Goal:** Create new admin pages for managing the new schema without touching existing functionality

Tasks:
1. **Flavor Management Admin Page**
   - [ ] Create `/staff/flavors` page
   - [ ] List all flavors with search/filter
   - [ ] Add/edit/delete flavors (name, description, flavorProfile, ingredients, images)
   - [ ] Active/inactive toggle
   - [ ] Display order management

2. **Retail Product Management Admin Page**
   - [ ] Create `/staff/retail-products` page
   - [ ] List retail products grouped by unit type
   - [ ] Create new retail product (select flavor + unit + price)
   - [ ] Edit pricing for existing retail products
   - [ ] Active/inactive toggle

3. **Wholesale Unit Type Management Admin Page**
   - [ ] Create `/staff/wholesale-unit-types` page
   - [ ] List unit types with default pricing
   - [ ] Create/edit unit types
   - [ ] Manage flavor availability per unit type
   - [ ] Active/inactive toggle

4. **Wholesale Customer Pricing Admin Page (Enhanced)**
   - [ ] Update to use new wholesaleUnitTypes instead of productTypes
   - [ ] Support per-customer pricing overrides

### Phase 3: Build New Frontend Shopping Experience
**Goal:** Create new retail shopping pages using the new schema

Tasks:
1. **New Retail Product Listing**
   - [ ] Create `/products-new` page (parallel to existing `/products`)
   - [ ] Display products grouped by unit type
   - [ ] Show all flavor options within each unit
   - [ ] Use flavor images/descriptions
   - [ ] Add to cart with new schema

2. **New Cart Experience**
   - [ ] Support both old and new cart items temporarily
   - [ ] Migrate cart items from old → new on checkout
   - [ ] Display flavor details from new schema

3. **New Checkout Flow**
   - [ ] Support checkout with new retailProducts
   - [ ] Create orders using new schema structure

### Phase 4: Build New Wholesale Ordering
**Goal:** Implement wholesale ordering with the new schema

Tasks:
1. **Wholesale Product Selection**
   - [ ] Select unit type first
   - [ ] Show available flavors for that unit type
   - [ ] Display customer-specific pricing overrides
   - [ ] Create wholesale orders with new schema

### Phase 5: Data Migration
**Goal:** Migrate existing data from old schema to new schema

Tasks:
1. **Migration Script**
   - [ ] Extract unique flavors from products table
   - [ ] Create flavors in new table
   - [ ] Create retailProducts for each flavor+productType combination
   - [ ] Create wholesaleUnitTypes from productTypes
   - [ ] Migrate wholesalePricing to new structure
   - [ ] Update historical orders to reference new IDs (optional)

2. **Testing**
   - [ ] Verify all data migrated correctly
   - [ ] Test new admin pages with real data
   - [ ] Test new shopping experience
   - [ ] Test wholesale ordering

### Phase 6: Cutover
**Goal:** Switch over to new schema and remove old tables

Tasks:
1. **Feature Toggle**
   - [ ] Add environment variable to toggle old/new schema
   - [ ] Test with new schema as default
   - [ ] Monitor for issues

2. **Route Updates**
   - [ ] Point `/products` to new implementation
   - [ ] Point `/cart` to new implementation
   - [ ] Point all staff pages to new schema

3. **Remove Old Schema**
   - [ ] Drop old tables: products, productTypes, wholesalePricing, inventoryAdjustments
   - [ ] Remove old API routes
   - [ ] Remove old frontend components
   - [ ] Update replit.md documentation

## Benefits of This Approach
1. ✅ **Zero Downtime** - App keeps running throughout migration
2. ✅ **Incremental Development** - Build and test new features piece by piece
3. ✅ **Rollback Safety** - Can revert to old schema if issues arise
4. ✅ **Parallel Testing** - Test new schema alongside production data
5. ✅ **Clear Validation** - Each phase has clear success criteria

## Notes
- All new admin pages should be under `/staff/` route (protected)
- Use feature flags to gradually roll out new functionality
- Keep old and new schemas in sync during transition
- Migration can be done in small batches to reduce risk
- Once Phase 6 is complete, old tables will be dropped
