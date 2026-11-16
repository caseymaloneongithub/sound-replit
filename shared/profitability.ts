import { z } from "zod";

/**
 * Weekly profitability projection (owner, 2026-11-15): "a weekly profitability
 * projection page (just for owners and super-admin) with inputs for sales (kegs,
 * distributor cases, wholesale cases, retail cases) with calculations for
 * ingredient and packaging expenses derived from the recipes."
 *
 * The arithmetic lives here so the page and a script compute the same week.
 * Costs come from the recipes: each flavor's Brew recipe prices a gallon of
 * kombucha and its Can recipe prices a case's packaging (server/profitability.ts
 * reads them). A keg's cost is its kombucha alone: "Keg packaging is just labor
 * so already built in. The cost is the kombucha" (owner). Cases are cans only;
 * the last bottle cases are selling through and aren't projected.
 */

export const GALLONS_PER_KEG = 5.16;
export const OZ_PER_CAN = 12;
export const CANS_PER_CASE = 12;
export const OZ_PER_GALLON = 128;
export const GALLONS_PER_CASE = (CANS_PER_CASE * OZ_PER_CAN) / OZ_PER_GALLON; // 1.125
export const WEEKS_PER_YEAR = 52;
/**
 * CO2 dissolved per gallon for each "volume" of carbonation: one volume is one
 * litre of CO2 gas (1.964 g at 0 °C and 1 atm) per litre of liquid, and a
 * gallon is 3.785 litres, so 1.964 × 3.785 / 453.6 = 0.01639 lb per gallon
 * per volume. At 2.8 volumes that is 0.046 lb a gallon.
 */
export const CO2_LB_PER_GALLON_PER_VOLUME = 0.01639;

export const CHANNELS = ["distributor", "wholesale", "retail"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = {
  distributor: "Distributor",
  wholesale: "Wholesale",
  retail: "Retail",
};

export const LABOR_BUCKETS = ["brewing", "packaging", "deliveries", "maintenance"] as const;
export type LaborBucket = (typeof LABOR_BUCKETS)[number];
export const LABOR_LABELS: Record<LaborBucket, string> = {
  brewing: "Brewing & draining",
  packaging: "Packaging",
  deliveries: "Deliveries",
  maintenance: "Maintenance",
};

/**
 * What the employer pays on top of wages, item by item (owner, 2026-11-15: "be more
 * explicit about the extra payroll costs ... I can feed our individual WA ESD and LNI
 * rates. Employer payroll taxes, health insurance subsidy").
 */
export const PAYROLL_ITEMS = ["socialSecurityMedicare", "futa", "esd", "lni", "healthInsurance", "other"] as const;
export type PayrollItem = (typeof PAYROLL_ITEMS)[number];
export const PAYROLL_LABELS: Record<PayrollItem, string> = {
  socialSecurityMedicare: "Social Security & Medicare",
  futa: "Federal unemployment (FUTA)",
  esd: "WA unemployment (ESD)",
  lni: "WA L&I workers' comp",
  healthInsurance: "Health insurance",
  other: "Other",
};
/** The federal rates every employer pays; the itemized payroll starts from these. */
export const SOCIAL_SECURITY_MEDICARE_PERCENT = 7.65;
export const FUTA_PERCENT = 0.6;
/** Where the Washington items start (owner, 2026-11-16: "Start with 1% for ESD, $0.80 for L&I"); the rate notices give the real figures. */
export const ESD_PERCENT_START = 1;
export const LNI_PER_HOUR_START = 0.8;

const money = z.number().finite().min(0).max(10_000_000);
const percent = z.number().finite().min(0).max(100);
const count = z.number().finite().min(0).max(1_000_000);

export const channelInputsSchema = z.object({
  casesPerWeek: count,
  casePrice: money,
  kegsPerWeek: count,
  kegPrice: money,
  /** Payment processing on this channel's revenue: cards on retail, ACH on wholesale, nothing on distributor checks. */
  feePercent: percent,
});
export type ChannelInputs = z.infer<typeof channelInputsSchema>;

const laborLineSchema = z.object({ hoursPerWeek: count, ratePerHour: money });
export type LaborLine = z.infer<typeof laborLineSchema>;

export const payrollInputsSchema = z.object({
  /** The employer's half of Social Security and Medicare: 6.2% + 1.45% of wages. */
  socialSecurityMedicarePercent: percent,
  /** Federal unemployment: 0.6% of each employee's first $7,000 a year (after the credit for paying the state on time), so a little under 0.6% of all wages. */
  futaPercent: percent,
  /** Washington unemployment insurance: the employer's own rate from ESD's yearly notice, on wages up to the taxable wage base. */
  esdPercent: percent,
  /** Washington L&I workers' comp: the employer's share of the hourly rate on the rate notice (the rate less what employees have withheld), per hour worked. */
  lniPerHour: z.number().finite().min(0).max(100),
  /** What the employer pays toward employees' health insurance, all employees together, per month. */
  healthInsurancePerMonth: money,
  /** Anything else that follows wages, as a percentage: paid sick leave as it's used, a retirement match, bonuses, Paid Leave's employer share at 50 or more employees. */
  otherPercent: percent,
});
export type PayrollInputs = z.infer<typeof payrollInputsSchema>;

export const projectionInputsSchema = z.object({
  channels: z.object({
    distributor: channelInputsSchema,
    wholesale: channelInputsSchema,
    retail: channelInputsSchema,
  }),
  /** Kombucha lost between the brew and the package, on top of what the package holds. */
  liquidWastePercent: percent,
  /**
   * Cans, ends, boxes and stickers spoiled, on top of the recipe. This is the one
   * packaging-waste figure: the materials carry their own waste rates
   * (shared/material-waste.ts), and the basis reports what those come to rather
   * than pricing them in, so cans at 5% in Materials aren't counted twice
   * (owner, 2026-11-15: "We're not double counting waste from the materials page
   * and the profitability page are we?").
   */
  packagingWastePercent: percent,
  /** What a pound of CO2 costs (owner, 2026-11-15: "CO2 usage is scaled by liquid. I will give a price per lb"). */
  co2PricePerLb: money,
  /** Volumes of carbonation in the package; 2.8 for this kombucha. */
  co2Volumes: z.number().finite().min(0).max(10),
  /** CO2 used beyond what the kombucha holds: the tank left full of gas after the push, purges, the canning line, leaks. Can exceed 100%. */
  co2WastePercent: z.number().finite().min(0).max(1000),
  /** How flavors are weighted when their costs differ: by recent sales, or evenly. */
  flavorMix: z.enum(["sales", "even"]),
  labor: z.object({
    brewing: laborLineSchema,
    packaging: laborLineSchema,
    deliveries: laborLineSchema,
    maintenance: laborLineSchema,
  }),
  /** What the employer pays on top of wages, item by item. Scenarios saved with the old single burden % are upgraded in normalizeInputs. */
  payroll: payrollInputsSchema,
  rentPerMonth: money,
  /** Insurance as a share of sales (owner, 2026-11-15: "make insurance a % of sales. Start at 1.2%"). */
  insurancePercent: percent,
  /** Kegs lost or never returned, as what replacing them costs in a year. */
  kegReplacementPerYear: money,
  /** Utilities, sanitizer, software, licenses, maintenance parts, loan payments: one weekly figure. CO2 is priced with the product. */
  otherOverheadPerWeek: money,
  vehicleMilesPerWeek: count,
  ratePerMile: z.number().finite().min(0).max(10),
  ownerTravelPerWeek: money,
  /** Market and event fees, demos and tastings, signage, tap handles, ads, website, memberships: one monthly figure (owner, 2026-11-15: "Add a marketing and selling line to overhead"). */
  marketingPerMonth: money,
  /** Washington B&O, as a percentage of sales (0.484% wholesaling and manufacturing, 0.471% retailing). */
  exciseTaxPercent: percent,
  /** Samples given away and product dumped, as cases a week at cost. */
  freeCasesPerWeek: count,
  /**
   * The yearly figures run every week at this many times this week's cases and kegs
   * (owner, 2026-11-16: "Rather than a compound growth rate, go with a flat one time hit
   * so I can just look at multiples of current"). What varies with volume follows; labor
   * and overhead stay as entered. 1 makes the year this week 52 times.
   */
  salesMultiple: z.number().finite().min(0).max(10),
});
export type ProjectionInputs = z.infer<typeof projectionInputsSchema>;

/** One flavor's costs as the recipes price them today, and its share of recent sales. */
export type FlavorCost = {
  flavorId: string;
  name: string;
  /** From the Brew recipe; null when the flavor has none. */
  ingredientPerGallon: number | null;
  /** From the Can recipe, before any waste (the inputs' packagingWastePercent is applied; the materials' rates are not); null when the flavor has none. */
  packagingPerCase: number | null;
  /** Share of recent sales by volume of kombucha, among flavors with a Brew recipe. 0–1. */
  salesWeight: number;
};

/** A packaging material the Can recipes in use draw on, with the waste rate Materials gives it. */
export type PackagingMaterial = { id: string; title: string; wasteRate: number };

export type ProjectionBasis = {
  flavors: FlavorCost[];
  /** Weighted over the flavors, for each mix the inputs can choose. */
  ingredientPerGallon: { sales: number; even: number };
  /** A case's packaging before any waste. */
  packagingPerCase: { sales: number; even: number };
  /**
   * What the materials' own waste rates would add to a case's packaging, as a
   * percentage of it, for each mix: the figure packagingWastePercent stands in
   * for. A new projection starts there.
   */
  packagingWasteInMaterials: { sales: number; even: number };
  /** The packaging materials the Can recipes in use draw on, highest waste rate first. */
  packagingMaterials: PackagingMaterial[];
  /** Things the basis couldn't price, in words for the page. */
  notes: string[];
};

export type ChannelActuals = {
  casesPerWeek: number;
  casePrice: number | null;
  kegsPerWeek: number;
  kegPrice: number | null;
};

/** Recent weeks of real orders, averaged per week, to start a projection from. */
export type ProjectionActuals = {
  weeks: number;
  since: string;
  channels: Record<Channel, ChannelActuals>;
};

/** Catalog prices, where the catalog has one for the channel. */
export type CatalogPrices = {
  casePrice: Record<Channel, number | null>;
  kegPrice: Record<Channel, number | null>;
};

export type ChannelProjection = {
  channel: Channel;
  cases: number;
  kegs: number;
  revenue: number;
  cogs: number;
  fees: number;
  exciseTax: number;
  insurance: number;
  /** Revenue less cost of goods, fees, B&O and insurance: what each week's sales leave to cover everything else. */
  contribution: number;
  perCase: { price: number; cost: number; margin: number; marginPercent: number };
  perKeg: { price: number; cost: number; margin: number; marginPercent: number };
};

export type Projection = {
  unitCosts: {
    ingredientPerGallon: number;
    packagingPerCase: number;
    liquidGallonsPerCase: number;
    liquidGallonsPerKeg: number;
    caseIngredient: number;
    kegIngredient: number;
    /** Pounds of CO2 per packaged gallon, waste included. */
    co2LbPerGallon: number;
    caseCo2: number;
    kegCo2: number;
    caseCost: number;
    kegCost: number;
  };
  channels: ChannelProjection[];
  /**
   * Kombucha a week: the cases (free product included) and kegs filled, what
   * they hold, and what has to be brewed for them with the liquid waste.
   */
  volume: { cases: number; kegs: number; gallonsPackaged: number; gallonsBrewed: number };
  revenue: number;
  cogs: number;
  grossMargin: number;
  fees: number;
  exciseTax: number;
  insurance: number;
  contribution: number;
  labor: {
    /** Wages plus everything the employer pays on top of them. */
    total: number;
    wages: number;
    hours: number;
    /** Each payroll item as a week's dollars, and their sum. */
    payroll: Record<PayrollItem, number> & { total: number };
    /** Each bucket's wages. */
    buckets: Record<LaborBucket, number>;
  };
  overhead: {
    rent: number;
    kegReplacement: number;
    other: number;
    vehicle: number;
    ownerTravel: number;
    marketing: number;
    freeProduct: number;
    total: number;
  };
  /** Everything a week costs whether or not anything sells: labor and overhead. */
  weeklyFixedCosts: number;
  /** Everything between gross margin and profit: fees, B&O, insurance, labor and overhead. */
  operatingCosts: number;
  /**
   * What the week leaves after everything above. There is no owner-pay line
   * beneath it (owner, 2026-11-15: "We own 100% so we just call profits our pay").
   */
  operatingProfit: number;
  /** Profit over revenue (owner, 2026-11-15: "net margin. Profit / Sales"); 0 when nothing sells. */
  netMargin: number;
  breakEven: {
    /** Volumes × this ratio cover labor and overhead; null when sales don't contribute at all. */
    scale: number | null;
    channels: Record<Channel, { cases: number; kegs: number }> | null;
  };
  /**
   * The year (owner, 2026-11-15: "add annualized to all but gallons"; the tiles show
   * these), every week at salesMultiple times this week's volumes: revenue, cost of
   * goods, fees, B&O and insurance follow the volumes, labor and overhead stay as
   * entered. At 1× it is this week 52 times.
   */
  annual: {
    revenue: number;
    cogs: number;
    operatingCosts: number;
    operatingProfit: number;
    gallonsPackaged: number;
    netMargin: number;
    /** The multiple the year runs at, as entered. */
    multiple: number;
    /** One week of that year: this week's volumes times the multiple, with labor and overhead as entered. */
    week: { cases: number; kegs: number; gallonsPackaged: number; revenue: number; operatingProfit: number };
  };
};

const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);

/** One projected week from the inputs and the recipe-derived basis. */
export function projectWeek(inputs: ProjectionInputs, basis: ProjectionBasis): Projection {
  const ingredientPerGallon = basis.ingredientPerGallon[inputs.flavorMix];
  // The basis prices packaging before any waste; this is the only waste added to it.
  const packagingPerCase = basis.packagingPerCase[inputs.flavorMix] * (1 + inputs.packagingWastePercent / 100);
  const liquidFactor = 1 + inputs.liquidWastePercent / 100;
  const liquidGallonsPerCase = GALLONS_PER_CASE * liquidFactor;
  const liquidGallonsPerKeg = GALLONS_PER_KEG * liquidFactor;
  const caseIngredient = ingredientPerGallon * liquidGallonsPerCase;
  const kegIngredient = ingredientPerGallon * liquidGallonsPerKeg;
  // CO2 scales with the kombucha in the package, plus the share lost around it.
  const co2LbPerGallon = inputs.co2Volumes * CO2_LB_PER_GALLON_PER_VOLUME * (1 + inputs.co2WastePercent / 100);
  const caseCo2 = GALLONS_PER_CASE * co2LbPerGallon * inputs.co2PricePerLb;
  const kegCo2 = GALLONS_PER_KEG * co2LbPerGallon * inputs.co2PricePerLb;
  const caseCost = caseIngredient + packagingPerCase + caseCo2;
  const kegCost = kegIngredient + kegCo2;

  const channels: ChannelProjection[] = CHANNELS.map((channel) => {
    const c = inputs.channels[channel];
    const revenue = c.casesPerWeek * c.casePrice + c.kegsPerWeek * c.kegPrice;
    const cogs = c.casesPerWeek * caseCost + c.kegsPerWeek * kegCost;
    const fees = revenue * (c.feePercent / 100);
    const exciseTax = revenue * (inputs.exciseTaxPercent / 100);
    const insurance = revenue * (inputs.insurancePercent / 100);
    const variableRate = c.feePercent / 100 + inputs.exciseTaxPercent / 100 + inputs.insurancePercent / 100;
    const caseMargin = c.casePrice * (1 - variableRate) - caseCost;
    const kegMargin = c.kegPrice * (1 - variableRate) - kegCost;
    return {
      channel,
      cases: c.casesPerWeek,
      kegs: c.kegsPerWeek,
      revenue,
      cogs,
      fees,
      exciseTax,
      insurance,
      contribution: revenue - cogs - fees - exciseTax - insurance,
      perCase: { price: c.casePrice, cost: caseCost, margin: caseMargin, marginPercent: safeDiv(caseMargin, c.casePrice) },
      perKeg: { price: c.kegPrice, cost: kegCost, margin: kegMargin, marginPercent: safeDiv(kegMargin, c.kegPrice) },
    };
  });

  const sum = (pick: (c: ChannelProjection) => number) => channels.reduce((s, c) => s + pick(c), 0);
  const revenue = sum((c) => c.revenue);
  const cogs = sum((c) => c.cogs);
  const fees = sum((c) => c.fees);
  const exciseTax = sum((c) => c.exciseTax);
  const insurance = sum((c) => c.insurance);
  const contribution = sum((c) => c.contribution);

  const soldCases = sum((c) => c.cases);
  const cases = soldCases + inputs.freeCasesPerWeek;
  const kegs = sum((c) => c.kegs);
  const soldGallons = soldCases * GALLONS_PER_CASE + kegs * GALLONS_PER_KEG;
  const freeGallons = inputs.freeCasesPerWeek * GALLONS_PER_CASE;
  const gallonsPackaged = soldGallons + freeGallons;
  const volume = { cases, kegs, gallonsPackaged, gallonsBrewed: gallonsPackaged * liquidFactor };

  const buckets = Object.fromEntries(
    LABOR_BUCKETS.map((b) => [b, inputs.labor[b].hoursPerWeek * inputs.labor[b].ratePerHour]),
  ) as Record<LaborBucket, number>;
  const wages = LABOR_BUCKETS.reduce((s, b) => s + buckets[b], 0);
  const hours = LABOR_BUCKETS.reduce((s, b) => s + inputs.labor[b].hoursPerWeek, 0);
  // The percentages follow wages, L&I follows hours worked, health insurance is a monthly bill.
  const pr = inputs.payroll;
  const payroll = {
    socialSecurityMedicare: (wages * pr.socialSecurityMedicarePercent) / 100,
    futa: (wages * pr.futaPercent) / 100,
    esd: (wages * pr.esdPercent) / 100,
    lni: hours * pr.lniPerHour,
    healthInsurance: (pr.healthInsurancePerMonth * 12) / WEEKS_PER_YEAR,
    other: (wages * pr.otherPercent) / 100,
    total: 0,
  };
  payroll.total = PAYROLL_ITEMS.reduce((s, k) => s + payroll[k], 0);
  const laborTotal = wages + payroll.total;

  const overhead = {
    rent: (inputs.rentPerMonth * 12) / WEEKS_PER_YEAR,
    kegReplacement: inputs.kegReplacementPerYear / WEEKS_PER_YEAR,
    other: inputs.otherOverheadPerWeek,
    vehicle: inputs.vehicleMilesPerWeek * inputs.ratePerMile,
    ownerTravel: inputs.ownerTravelPerWeek,
    marketing: (inputs.marketingPerMonth * 12) / WEEKS_PER_YEAR,
    freeProduct: inputs.freeCasesPerWeek * caseCost,
    total: 0,
  };
  overhead.total = overhead.rent + overhead.kegReplacement + overhead.other
    + overhead.vehicle + overhead.ownerTravel + overhead.marketing + overhead.freeProduct;

  const weeklyFixedCosts = laborTotal + overhead.total;
  const operatingCosts = fees + exciseTax + insurance + weeklyFixedCosts;
  const operatingProfit = contribution - weeklyFixedCosts;

  // The year at the multiple: every week sells the multiple times this week's cases and
  // kegs, so contribution scales with it (prices, costs and mix are held); labor and
  // overhead, free cases among them, are the same every week.
  const multiple = inputs.salesMultiple;
  const weekRevenue = revenue * multiple;
  const weekProfit = contribution * multiple - weeklyFixedCosts;
  const annual = {
    revenue: weekRevenue * WEEKS_PER_YEAR,
    cogs: cogs * multiple * WEEKS_PER_YEAR,
    operatingCosts: ((fees + exciseTax + insurance) * multiple + weeklyFixedCosts) * WEEKS_PER_YEAR,
    operatingProfit: weekProfit * WEEKS_PER_YEAR,
    gallonsPackaged: (soldGallons * multiple + freeGallons) * WEEKS_PER_YEAR,
    netMargin: safeDiv(weekProfit, weekRevenue),
    multiple,
    week: {
      cases: soldCases * multiple + inputs.freeCasesPerWeek,
      kegs: kegs * multiple,
      gallonsPackaged: soldGallons * multiple + freeGallons,
      revenue: weekRevenue,
      operatingProfit: weekProfit,
    },
  };

  const scale = contribution > 0 ? weeklyFixedCosts / contribution : null;
  const breakEvenChannels = scale === null
    ? null
    : (Object.fromEntries(
        CHANNELS.map((ch) => [ch, { cases: inputs.channels[ch].casesPerWeek * scale, kegs: inputs.channels[ch].kegsPerWeek * scale }]),
      ) as Record<Channel, { cases: number; kegs: number }>);

  return {
    unitCosts: { ingredientPerGallon, packagingPerCase, liquidGallonsPerCase, liquidGallonsPerKeg, caseIngredient, kegIngredient, co2LbPerGallon, caseCo2, kegCo2, caseCost, kegCost },
    channels,
    volume,
    revenue,
    cogs,
    grossMargin: revenue - cogs,
    fees,
    exciseTax,
    insurance,
    contribution,
    labor: { total: laborTotal, wages, hours, payroll, buckets },
    overhead,
    weeklyFixedCosts,
    operatingCosts,
    operatingProfit,
    netMargin: safeDiv(operatingProfit, revenue),
    breakEven: { scale, channels: breakEvenChannels },
    annual,
  };
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** The sales lines a channel starts from: recent actuals where there are any, else the catalog, else zero. */
function channelFrom(channel: Channel, feePercent: number, actuals?: ProjectionActuals | null, catalog?: CatalogPrices | null): ChannelInputs {
  const a = actuals?.channels[channel];
  return {
    casesPerWeek: round(a?.casesPerWeek ?? 0, 1),
    casePrice: round(a?.casePrice ?? catalog?.casePrice[channel] ?? 0, 2),
    kegsPerWeek: round(a?.kegsPerWeek ?? 0, 1),
    kegPrice: round(a?.kegPrice ?? catalog?.kegPrice[channel] ?? 0, 2),
    feePercent,
  };
}

/** Typical processing fees: Stripe cards on retail (2.9% + 30¢ on a $36 case), ACH on wholesale, checks from the distributor. */
export const DEFAULT_FEE_PERCENT: Record<Channel, number> = { distributor: 0, wholesale: 0.8, retail: 3.2 };

/** Packaging waste where there is no basis to read it from: the owner's stated figure (2026-11-15). */
export const DEFAULT_PACKAGING_WASTE_PERCENT = 5;

/**
 * A fresh projection: sales from recent weeks, packaging waste as the materials'
 * own rates work out (so the two pages agree until the owner says otherwise),
 * the owner's stated liquid waste, and everything else left to fill in.
 */
export function defaultInputs(
  actuals?: ProjectionActuals | null,
  catalog?: CatalogPrices | null,
  basis?: Pick<ProjectionBasis, "packagingWasteInMaterials"> | null,
): ProjectionInputs {
  const line = (): LaborLine => ({ hoursPerWeek: 0, ratePerHour: 20 });
  return {
    channels: {
      distributor: channelFrom("distributor", DEFAULT_FEE_PERCENT.distributor, actuals, catalog),
      wholesale: channelFrom("wholesale", DEFAULT_FEE_PERCENT.wholesale, actuals, catalog),
      retail: channelFrom("retail", DEFAULT_FEE_PERCENT.retail, actuals, catalog),
    },
    liquidWastePercent: 10,
    packagingWastePercent: basis ? round(basis.packagingWasteInMaterials.sales, 1) : DEFAULT_PACKAGING_WASTE_PERCENT,
    // Owner, 2026-11-15: "CO2 is about $1 for now." Scenarios saved before that hold the $0 placeholder until it's typed in.
    co2PricePerLb: 1,
    co2Volumes: 2.8,
    // The tank is left full of gas at push pressure (half to three quarters of what
    // the kombucha held), the canning line purges every can, and kegs are purged:
    // two and a half times the dissolved amount is a fair start; cylinder
    // purchases over packaged gallons give the true figure.
    co2WastePercent: 150,
    flavorMix: "sales",
    labor: { brewing: line(), packaging: line(), deliveries: line(), maintenance: line() },
    payroll: defaultPayroll(),
    rentPerMonth: 0,
    insurancePercent: 1.2,
    kegReplacementPerYear: 0,
    otherOverheadPerWeek: 0,
    vehicleMilesPerWeek: 0,
    ratePerMile: 0.7,
    ownerTravelPerWeek: 0,
    marketingPerMonth: 0,
    exciseTaxPercent: 0.484,
    freeCasesPerWeek: 0,
    salesMultiple: 1,
  };
}

/** The federal rates and the Washington starting rates; the real ESD and L&I rates, health insurance and anything else wait to be typed in. */
export function defaultPayroll(): PayrollInputs {
  return {
    socialSecurityMedicarePercent: SOCIAL_SECURITY_MEDICARE_PERCENT,
    futaPercent: FUTA_PERCENT,
    esdPercent: ESD_PERCENT_START,
    lniPerHour: LNI_PER_HOUR_START,
    healthInsurancePerMonth: 0,
    otherPercent: 0,
  };
}

/** The same inputs with the sales lines replaced by recent actuals; fee rates stay as set. */
export function withActualSales(inputs: ProjectionInputs, actuals: ProjectionActuals, catalog?: CatalogPrices | null): ProjectionInputs {
  return {
    ...inputs,
    channels: {
      distributor: channelFrom("distributor", inputs.channels.distributor.feePercent, actuals, catalog),
      wholesale: channelFrom("wholesale", inputs.channels.wholesale.feePercent, actuals, catalog),
      retail: channelFrom("retail", inputs.channels.retail.feePercent, actuals, catalog),
    },
  };
}

const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * Inputs saved earlier, brought up to today's shape: fields that didn't exist
 * yet take their defaults, renamed ones carry over (rent used to be a yearly
 * figure), and anything unreadable falls back. Nothing a scenario holds is lost
 * to a later addition.
 */
export function normalizeInputs(raw: unknown, fallback: ProjectionInputs = defaultInputs()): ProjectionInputs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const channel = (c: Channel): ChannelInputs => {
    const x = r.channels?.[c] ?? {};
    const d = fallback.channels[c];
    return {
      casesPerWeek: finite(x.casesPerWeek, d.casesPerWeek),
      casePrice: finite(x.casePrice, d.casePrice),
      kegsPerWeek: finite(x.kegsPerWeek, d.kegsPerWeek),
      kegPrice: finite(x.kegPrice, d.kegPrice),
      feePercent: finite(x.feePercent, d.feePercent),
    };
  };
  const labor = (b: LaborBucket): LaborLine => {
    const x = r.labor?.[b] ?? {};
    const d = fallback.labor[b];
    return { hoursPerWeek: finite(x.hoursPerWeek, d.hoursPerWeek), ratePerHour: finite(x.ratePerHour, d.ratePerHour) };
  };
  const laborLines = { brewing: labor("brewing"), packaging: labor("packaging"), deliveries: labor("deliveries"), maintenance: labor("maintenance") };
  const payroll = (): PayrollInputs => {
    const d = fallback.payroll;
    const x = r.payroll;
    if (x && typeof x === "object") {
      return {
        socialSecurityMedicarePercent: finite(x.socialSecurityMedicarePercent, d.socialSecurityMedicarePercent),
        futaPercent: finite(x.futaPercent, d.futaPercent),
        esdPercent: finite(x.esdPercent, d.esdPercent),
        lniPerHour: finite(x.lniPerHour, d.lniPerHour),
        healthInsurancePerMonth: finite(x.healthInsurancePerMonth, d.healthInsurancePerMonth),
        otherPercent: finite(x.otherPercent, d.otherPercent),
      };
    }
    // Scenarios saved before 2026-11-15 held one "payroll burden" percentage. Its total is
    // kept: Social Security & Medicare, FUTA and ESD at their starting rates, L&I at its
    // starting $/hour (taken out as the share of this scenario's wages it comes to), and
    // what is left under "other" until the real rates and health insurance are typed in.
    // An old figure too small to cover the items leaves "other" at 0 and the items standing.
    if (typeof r.payrollBurdenPercent === "number" && Number.isFinite(r.payrollBurdenPercent)) {
      let left = Math.max(0, r.payrollBurdenPercent);
      const take = (rate: number) => { const t = Math.min(rate, left); left -= t; return t; };
      const socialSecurityMedicarePercent = take(SOCIAL_SECURITY_MEDICARE_PERCENT);
      const futaPercent = take(FUTA_PERCENT);
      const esdPercent = take(ESD_PERCENT_START);
      const wages = LABOR_BUCKETS.reduce((s, b) => s + laborLines[b].hoursPerWeek * laborLines[b].ratePerHour, 0);
      const hours = LABOR_BUCKETS.reduce((s, b) => s + laborLines[b].hoursPerWeek, 0);
      take(wages > 0 ? (hours * LNI_PER_HOUR_START * 100) / wages : 0);
      return {
        socialSecurityMedicarePercent,
        futaPercent,
        esdPercent,
        lniPerHour: LNI_PER_HOUR_START,
        healthInsurancePerMonth: 0,
        otherPercent: round(left, 2),
      };
    }
    return { ...d };
  };
  return {
    channels: { distributor: channel("distributor"), wholesale: channel("wholesale"), retail: channel("retail") },
    liquidWastePercent: finite(r.liquidWastePercent, fallback.liquidWastePercent),
    packagingWastePercent: finite(r.packagingWastePercent, fallback.packagingWastePercent),
    co2PricePerLb: finite(r.co2PricePerLb, fallback.co2PricePerLb),
    co2Volumes: finite(r.co2Volumes, fallback.co2Volumes),
    co2WastePercent: finite(r.co2WastePercent, fallback.co2WastePercent),
    flavorMix: r.flavorMix === "even" ? "even" : "sales",
    labor: laborLines,
    payroll: payroll(),
    rentPerMonth: finite(r.rentPerMonth, typeof r.rentPerYear === "number" ? r.rentPerYear / 12 : fallback.rentPerMonth),
    insurancePercent: finite(r.insurancePercent, fallback.insurancePercent),
    kegReplacementPerYear: finite(r.kegReplacementPerYear, fallback.kegReplacementPerYear),
    otherOverheadPerWeek: finite(r.otherOverheadPerWeek, fallback.otherOverheadPerWeek),
    vehicleMilesPerWeek: finite(r.vehicleMilesPerWeek, fallback.vehicleMilesPerWeek),
    ratePerMile: finite(r.ratePerMile, fallback.ratePerMile),
    ownerTravelPerWeek: finite(r.ownerTravelPerWeek, fallback.ownerTravelPerWeek),
    marketingPerMonth: finite(r.marketingPerMonth, fallback.marketingPerMonth),
    exciseTaxPercent: finite(r.exciseTaxPercent, fallback.exciseTaxPercent),
    freeCasesPerWeek: finite(r.freeCasesPerWeek, fallback.freeCasesPerWeek),
    salesMultiple: finite(r.salesMultiple, fallback.salesMultiple),
  };
}
