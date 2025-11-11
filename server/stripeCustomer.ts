import Stripe from "stripe";
import { storage } from "./storage";

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-10-29.clover" })
  : null;

export interface CreateStripeCustomerParams {
  userId: string;
  email?: string | null;
  phoneNumber?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string;
}

export async function createStripeCustomer(params: CreateStripeCustomerParams): Promise<string | null> {
  if (!stripe) {
    console.error("[Stripe Customer] Stripe not configured - skipping customer creation");
    return null;
  }

  try {
    const { userId, email, phoneNumber, firstName, lastName, username } = params;

    // Idempotency guard: Skip if user already has a Stripe customer ID
    const existingUser = await storage.getUser(userId);
    if (existingUser?.stripeCustomerId) {
      console.log(`[Stripe Customer] User ${userId} already has Stripe customer ID ${existingUser.stripeCustomerId} - skipping creation`);
      return existingUser.stripeCustomerId;
    }

    const name = firstName && lastName 
      ? `${firstName} ${lastName}`.trim()
      : firstName || lastName || username || "Customer";

    const customerData: Stripe.CustomerCreateParams = {
      name,
      metadata: {
        userId,
      },
    };

    if (email) {
      customerData.email = email;
    }

    if (phoneNumber) {
      customerData.phone = phoneNumber;
    }

    console.log(`[Stripe Customer] Creating Stripe customer for user ${userId}...`);
    const customer = await stripe.customers.create(customerData);
    
    await storage.updateUserStripeId(userId, customer.id);
    
    console.log(`[Stripe Customer] Created Stripe customer ${customer.id} for user ${userId}`);
    return customer.id;
  } catch (error: any) {
    console.error("[Stripe Customer] Failed to create Stripe customer:", {
      userId: params.userId,
      error: error.message,
      code: error.code,
    });
    return null;
  }
}
