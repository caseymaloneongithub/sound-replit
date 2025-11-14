# Puget Sound Kombucha Co. - Design Guidelines

## Brand Identity

**Inspired by Label Design**: Pacific Northwest aesthetic with botanical illustrations, earthy color palette, and natural typography reflecting the craft kombucha brewing tradition.

## Color Palette

**Primary Brand Colors** (extracted from product labels):

- **Brand Gold** `--primary`: HSL(43, 52%, 48%) - The signature gold used for "PUGET SOUND KOMBUCHA COMPANY" branding. Use for primary CTAs, brand elements, and key highlights.

- **Warm Coral/Pink** `--accent`: HSL(8, 45%, 78%) - The soft coral/pink from label ribbons. Use for accent elements, badges, and secondary highlights.

- **Warm Neutrals** `--secondary`: HSL(30, 35%, 88%) - Earthy warm grey tones. Use for secondary buttons, background variations.

**Flavor-Inspired Accent Colors** (for product cards, charts, illustrations):
- Evergreen: Olive green tones (earthy sage)
- Bonfire: Burnt orange/terracotta
- Northzest: Bright lemon yellow
- Humming Brew: Deep teal/navy
- Mist: Soft blue-grey
- Island Hop: Mossy olive
- Wildberry: Ocean blue
- Sunbreak: Peachy orange

**Usage Guidelines**:
- Use brand gold (`primary`) for all CTAs, nav highlights, and brand moments
- Use coral (`accent`) sparingly for special callouts, badges, notifications
- Maintain warm, natural feel - avoid pure black/white when possible
- Product cards can use flavor-specific colors as subtle background washes or borders

## Typography

**Font Families** (matching label aesthetic):
- **Headlines**: 'Outfit' (700, 600) - Modern, approachable, slightly rounded (similar to label's clean sans-serif)
- **Body**: 'Inter' (400, 500) - Clean, highly readable for product descriptions and forms
- **Accent/Product Names**: Consider adding a script/cursive Google Font for product names to match label style (e.g., 'Pacifico', 'Dancing Script', or 'Allura')
- **Brand Name**: 'Outfit' (700) in uppercase and letterspaced for the condensed, impactful look

**Hierarchy**:
- Hero Headlines: text-5xl to text-7xl, font-bold, tracking-tight
- Brand Name (PUGET SOUND KOMBUCHA COMPANY): uppercase, tracking-wider, text-gold
- Product Flavor Names: Consider script font for artisanal feel
- Section Headers: text-3xl to text-4xl, font-semibold
- Product Titles: text-xl to text-2xl, font-semibold
- Body Text: text-base to text-lg
- Labels/Metadata: text-sm, font-medium, uppercase tracking-wide for "MADE IN SEATTLE" style

## Core Design Principles

1. **Pacific Northwest Artisanal**: Earthy tones, botanical illustrations, natural textures reflecting local craft brewing
2. **Brand Gold Moments**: Strategic use of gold for brand recognition and premium feel
3. **Product Hero**: Kombucha bottles and flavor stories take center stage
4. **Organic Shapes**: Droplet/teardrop shapes from labels, rounded corners, flowing botanical elements
5. **Dual Audience Clarity**: Distinct visual separation between wholesale portal and consumer shop

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

## Visual Elements

**Hero Section**: Full-width immersive brewery photo showing fermentation vessels and bottling, height 70vh on desktop, 50vh mobile. Overlay with semi-transparent dark wash for text readability. Brand gold CTAs with backdrop-blur.

**Product Photography**: Square product shots (1:1 aspect ratio) showing bottles with label-inspired styling. Use flavor-specific background colors from labels as subtle washes. Minimum 800x800px.

**Botanical Illustrations**: Incorporate leaf and floral illustrations from labels (loose, organic style) as decorative elements, borders, or section dividers. Use subtle, muted colors.

**Droplet/Teardrop Shapes**: The central droplet shape from labels can be used as:
- Icon containers
- Quote backgrounds  
- Section decorations
- Loading indicators

**About/Process**: Rectangular photos (16:9) showing brewing process - raw ingredients, fermentation, bottling line, quality testing.

**Lifestyle Imagery**: People enjoying kombucha at farmers markets, yoga studios, local cafes - authentic Pacific Northwest scenes.

**Pattern/Texture**: Subtle organic textures (wood grain, paper texture, botanical patterns) as section backgrounds to reinforce artisanal quality.

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