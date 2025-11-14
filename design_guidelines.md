# Puget Sound Kombucha Co. - Design Guidelines

## Brand Identity

**Tone**: Bright, minimalist, clean, natural

**Philosophy**: Clean, modern aesthetic that lets the product and flavors shine. Minimal ornamentation, plenty of white space, flavor-specific accents for visual interest.

## Color Palette

**Base Colors**:

- **White Background**: Pure white (`--background`: HSL 0, 0%, 100%) - Primary background for clean, minimalist feel
- **Soft Charcoal**: (`--foreground`, `--primary`: HSL 0, 0%, 30%) - For text, wordmark, and primary elements
- **Light Gray**: (`--secondary`, `--accent`: HSL 0, 0%, 92-94%) - For cards, subtle backgrounds, and secondary elements

**Flavor Accent Colors** (use for product cards, badges, highlights):
- **Peach**: HSL(20, 85%, 75%) - Warm, inviting
- **Rust**: HSL(15, 65%, 50%) - Earthy, bold  
- **Yellow**: HSL(45, 95%, 65%) - Bright, energetic
- **Green**: HSL(120, 40%, 55%) - Fresh, natural
- **Olive**: HSL(60, 30%, 45%) - Organic, muted
- **Lavender**: HSL(270, 50%, 75%) - Soft, calming
- **Pale Blue**: HSL(200, 70%, 80%) - Clean, refreshing
- **Deep Blue**: HSL(210, 70%, 45%) - Rich, sophisticated

**Usage Guidelines**:
- Start with white background - let it breathe
- Use soft charcoal for text and the wordmark (no gold, no bright colors for logo)
- Apply flavor accent colors as subtle washes, borders, or badges on product cards
- Each flavor should have its own signature accent color
- Maintain high contrast for readability (dark text on white/light backgrounds)
- Use color sparingly - accent, don't overwhelm

## Typography

**Font Families**:

1. **Inter** (`font-sans`) - Clean sans-serif for body text
   - Default font for all body text, descriptions, forms, labels
   - Highly readable, modern, professional
   - Usage: Body copy, navigation, buttons, form inputs
   
2. **Great Vibes** (`font-script`) - Elegant script for flavor names
   - Beautiful cursive font for product flavor names
   - Usage: Product names, flavor titles only (use sparingly for impact)
   - Available via Tailwind class: `font-script`
   
3. **Outfit** (`font-heading`) - Modern sans-serif for headings
   - Clean, approachable for section headers
   - Usage: Page titles, section headers, card titles

**Typography Hierarchy**:
- **Wordmark**: "Puget Sound Kombucha Company" - `text-2xl md:text-3xl font-sans text-foreground` (centered, soft charcoal)
- **Hero Headlines**: `text-5xl md:text-7xl font-heading font-bold tracking-tight text-foreground`
- **Product Flavor Names**: `font-script text-5xl md:text-6xl` (with flavor accent color)
- **Section Headers**: `text-3xl md:text-4xl font-heading font-semibold text-foreground`
- **Product Titles**: `text-xl md:text-2xl font-sans font-semibold`
- **Body Text**: `text-base md:text-lg font-sans text-foreground`
- **Small Labels**: `text-xs md:text-sm uppercase tracking-wide font-medium text-muted-foreground`

**Typography Guidelines**:
- Keep it clean and minimal
- Generous line spacing for readability
- Use Great Vibes script sparingly - only for flavor names to create visual interest
- Avoid all-caps except for small labels/metadata
- Maintain strong hierarchy through size and weight, not color

**Implementation Examples**:
```jsx
// Wordmark (centered, soft charcoal)
<h1 className="text-3xl font-sans text-foreground text-center">
  Puget Sound Kombucha Company
</h1>

// Product flavor name with accent color
<h2 className="font-script text-6xl text-[hsl(20,85%,75%)]">
  Sunbreak
</h2>

// Section header
<h2 className="text-4xl font-heading font-semibold text-foreground">
  Our Flavors
</h2>

// Clean body text
<p className="text-lg font-sans text-foreground leading-relaxed">
  Handcrafted kombucha from the Pacific Northwest...
</p>
```

## Core Design Principles

1. **Bright & Minimalist**: Clean white backgrounds, generous spacing, minimal ornamentation
2. **Flavor as Accent**: Let each kombucha flavor shine through its signature color - use sparingly for impact
3. **Product Hero**: Kombucha bottles and flavor names take center stage against clean backgrounds
4. **Natural & Approachable**: Warm, inviting but not cluttered - simple, honest, refreshing
5. **Clear Hierarchy**: Strong typography hierarchy using size and weight, not heavy color use
6. **Dual Audience Clarity**: Distinct visual separation between wholesale portal and consumer shop

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

**Hero Section**: Clean, bright hero with plenty of white space. Simple headline and CTA. If using imagery, keep it light and airy - avoid dark overlays. Height 60vh on desktop, 40vh mobile.

**Product Photography**: Square product shots (1:1 aspect ratio) showing bottles against pure white or very light backgrounds. Clean, bright, minimal shadows. Minimum 800x800px. Each product card can have a subtle flavor accent color border or background wash.

**Product Cards**: White card backgrounds with subtle shadows. Flavor name in Great Vibes script with the flavor's signature accent color. Clean product photo. Minimal text.

**Lifestyle Imagery**: Bright, natural light photos. People enjoying kombucha outdoors, at cafes, in bright, airy spaces. Authentic Pacific Northwest scenes but keep them light and optimistic, not moody.

**Whitespace**: Generous padding and margins throughout. Let elements breathe. Don't be afraid of empty space - it's a feature, not a bug.

**Simplicity**: Avoid decorative elements, patterns, or textures unless absolutely necessary. Keep interfaces clean and focused on content.

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