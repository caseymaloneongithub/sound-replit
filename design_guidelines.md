# Kombucha Brewery Design Guidelines

## Design Approach

**Reference-Based Approach** drawing from modern artisanal food/beverage e-commerce:
- Primary inspiration: Shopify premium themes (clean product focus), Verve Coffee, Blueland (sustainability aesthetic)
- Secondary: Ritual Vitamins (subscription UX), Patagonia Provisions (authentic, craft-focused)
- Rationale: Visual-rich product showcase with strong brand storytelling for local artisanal products

## Core Design Principles

1. **Artisanal Authenticity**: Organic shapes, natural textures, honest photography showing real brewery operations
2. **Dual Audience Clarity**: Distinct visual separation between wholesale portal and consumer shop
3. **Product Hero**: Kombucha bottles and flavors take center stage with high-quality photography
4. **Trust & Transparency**: Showcase brewing process, ingredients, local pickup locations

## Typography

**Font Families** (Google Fonts):
- Headlines: 'Outfit' (700, 600) - Modern, approachable, slightly rounded
- Body: 'Inter' (400, 500) - Clean, highly readable for product descriptions and forms
- Accent: 'Outfit' (500) - For labels, pricing, CTAs

**Hierarchy**:
- Hero Headlines: text-5xl to text-7xl, font-bold
- Section Headers: text-3xl to text-4xl, font-semibold
- Product Titles: text-xl to text-2xl, font-semibold
- Body Text: text-base to text-lg
- Labels/Metadata: text-sm, font-medium

## Layout System

**Spacing Primitives**: Use Tailwind units of 3, 4, 6, 8, 12, 16, 20, 24
- Tight groupings: gap-3, gap-4
- Component internal padding: p-6, p-8
- Section spacing: py-16, py-20, py-24
- Container margins: mx-4, mx-6, mx-8

**Grid System**:
- Product grids: grid-cols-1 md:grid-cols-2 lg:grid-cols-3
- Subscription tiers: grid-cols-1 md:grid-cols-2 lg:grid-cols-3
- Wholesale dashboard: grid-cols-1 lg:grid-cols-3 (sidebar + main content)
- Max container width: max-w-7xl

## Component Library

### Navigation
- **Main Header**: Sticky navigation with brewery logo left, wholesale/shop toggle center, cart/account right
- **Wholesale Nav**: Sidebar navigation with icons (Dashboard, Orders, Products, Customers)
- **Shop Nav**: Top bar with category filters, search, subscription link

### Product Display
- **Product Cards**: Large square image (aspect-square), flavor name, ABV/ingredients preview, price, "Add to Cart" button
- **Product Detail**: Full-width image gallery + detailed info sidebar (ingredients, tasting notes, pickup schedule)
- **Subscription Cards**: Elevated cards with visual frequency indicator (weekly/monthly), price comparison, benefits list

### Forms & Inputs
- **Text Inputs**: Rounded corners (rounded-lg), solid borders, clear labels above, helper text below
- **Select Dropdowns**: Match text input styling, custom arrow icon
- **Checkboxes/Radio**: Large touch targets (min 44px), clear visual states
- **Subscription Selector**: Visual toggle between frequencies with pricing breakdown

### Dashboard Elements
- **Stat Cards**: Grid of key metrics (Total Orders, Revenue, Active Subscriptions) with large numbers, icons
- **Order Tables**: Alternating row treatment, status badges, expandable details
- **Customer List**: Avatar + name + contact + order count in clean table layout

### CTAs & Buttons
- **Primary**: Large, rounded (rounded-full), solid fill, prominent on product cards and checkout
- **Secondary**: Outlined style, same shape/size
- **Icon Buttons**: Square or circle, consistent sizing (h-10 w-10 or h-12 w-12)
- **Button Backgrounds on Images**: Backdrop blur (backdrop-blur-md) with semi-transparent background

### Checkout Flow
- **Cart Sidebar**: Slide-in panel from right, sticky footer with total/checkout button
- **Checkout Steps**: Multi-step with visual progress indicator, one step per screen on mobile
- **Payment Form**: Stripe Elements embedded, clear field labels, security badges

### Trust Elements
- **Pickup Location Card**: Map integration, address, hours, parking info
- **Brewing Process Timeline**: Horizontal timeline with photos showing fermentation stages
- **Reviews/Testimonials**: Photo testimonials from wholesale clients and subscription customers

## Images

**Hero Section**: Full-width immersive brewery photo showing fermentation vessels and bottling, height 70vh on desktop, 50vh mobile. Place headline and "Shop Now" / "Wholesale Portal" CTAs with backdrop-blur overlay.

**Product Photography**: Square product shots (1:1 aspect ratio) showing bottles against clean backgrounds or in lifestyle contexts (outdoor picnic, home kitchen). Minimum 800x800px.

**About/Process**: Rectangular photos (16:9) showing brewing process - raw ingredients, fermentation, bottling line, quality testing.

**Lifestyle Imagery**: People enjoying kombucha at farmers markets, yoga studios, local cafes - authentic local scenes.

**Pattern/Texture**: Consider subtle organic textures (wood grain, paper texture) as section backgrounds to reinforce artisanal quality.

## Page Structures

### Consumer Shop Homepage
- Hero with brewery image and dual CTAs
- Featured Flavors: 3-column grid of current seasonal offerings
- How Subscriptions Work: 3-step visual explainer
- Brewing Philosophy: Text + image split section
- Pickup Locations: Map + location cards
- Customer Reviews: Testimonial carousel
- Footer: Newsletter signup, social, pickup schedule, contact

### Wholesale Portal
- Login/Dashboard landing
- Sidebar navigation persistent
- Main content area with stat cards, recent orders table, quick actions
- Product catalog with bulk pricing tiers
- Order history with search/filter
- Account settings

### Subscription Management
- Active subscription card with next pickup date, pause/cancel options
- Order history timeline
- Modify subscription: frequency, flavor preferences
- Referral program section

## Accessibility
- All form inputs with visible labels and focus states (ring-2 ring-offset-2)
- Keyboard navigation throughout, logical tab order
- ARIA labels for icon-only buttons
- Sufficient contrast ratios (WCAG AA minimum)
- Touch targets minimum 44x44px
- Screen reader announcements for cart updates and form errors