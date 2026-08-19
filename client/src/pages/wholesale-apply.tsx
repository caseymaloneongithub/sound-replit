import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Public "become a stockist" application.
 *
 * Submitting creates a CRM lead, not an account — wholesale accounts stay staff-created,
 * so opening this door adds no account-spam surface. A honeypot field and a per-IP limit
 * on the endpoint keep the form itself from becoming an inbox flood.
 */
export default function WholesaleApply() {
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    businessName: "",
    contactName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "WA",
    zipCode: "",
    // Named for what it is, not "message" — it maps onto the delivery instructions we
    // store per location once the account exists.
    deliveryInstructions: "",
    website: "", // honeypot — hidden from real users
  });

  const set = (key: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setForm({ ...form, [key]: e.target.value });

  const apply = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/wholesale/apply", form),
    onSuccess: () => setSubmitted(true),
    onError: (error: any) => {
      toast({
        title: "We couldn't send that",
        description: error.message || "Please try again, or email us directly.",
        variant: "destructive",
      });
    },
  });

  const canSubmit =
    form.businessName.trim().length >= 2 &&
    form.contactName.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(form.email) &&
    form.phone.trim().length >= 7 &&
    form.address.trim() !== "" &&
    form.city.trim() !== "" &&
    form.state.trim() !== "" &&
    form.zipCode.trim() !== "";

  if (submitted) {
    return (
      <div className="container mx-auto max-w-2xl py-16 px-4">
        <Card>
          <CardContent className="pt-6 text-center space-y-4">
            <h1 className="text-2xl font-bold" data-testid="text-apply-success">
              Thanks — we've got it
            </h1>
            <p className="text-muted-foreground">
              We read every application ourselves. Someone from our team will get back to
              you within two business days to talk pricing, delivery days, and getting
              your first order out.
            </p>
            <p className="text-sm text-muted-foreground">
              Questions in the meantime? Reach us from the{" "}
              <Link href="/contact" className="underline">contact page</Link>.
            </p>
            <Button asChild variant="outline">
              <Link href="/shop">Back to the shop</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl py-12 px-4 space-y-8">
      <div className="text-center space-y-3">
        <h1 className="text-3xl font-bold" data-testid="text-apply-title">
          Carry Puget Sound Kombucha
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          We deliver to cafes, restaurants, and grocers around the Puget Sound. Tell us
          about your business and we'll set you up with wholesale pricing and a delivery
          schedule.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {[
          { title: "We deliver", body: "Regular routes across the Puget Sound region." },
          { title: "Order online", body: "Reorder your usual in a couple of clicks." },
        ].map(({ title, body }) => (
          <div key={title} className="p-4 border rounded-md">
            <p className="font-medium">{title}</p>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Wholesale application</CardTitle>
          <CardDescription>
            Takes about two minutes. Fields marked * are required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) apply.mutate();
            }}
          >
            {/* Honeypot: off-screen and hidden from assistive tech. A human never fills this. */}
            <div className="absolute left-[-9999px]" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input
                id="website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={form.website}
                onChange={set("website")}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="businessName">Business name *</Label>
                <Input id="businessName" value={form.businessName} onChange={set("businessName")} required data-testid="input-business-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactName">Your name *</Label>
                <Input id="contactName" value={form.contactName} onChange={set("contactName")} required data-testid="input-contact-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input id="email" type="email" value={form.email} onChange={set("email")} required data-testid="input-email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone *</Label>
                <Input id="phone" type="tel" value={form.phone} onChange={set("phone")} required data-testid="input-phone" />
              </div>
            </div>

            {/* Required: the address is what we geocode to plan a delivery route, and an
                application without one can't be quoted or scheduled. */}
            <div className="space-y-2">
              <Label htmlFor="address">Delivery address *</Label>
              <Input id="address" value={form.address} onChange={set("address")} placeholder="Street address" required data-testid="input-address" />
              <div className="grid gap-2 grid-cols-3">
                <Input value={form.city} onChange={set("city")} placeholder="City" aria-label="City" required data-testid="input-city" />
                <Input value={form.state} onChange={set("state")} placeholder="State" aria-label="State" required data-testid="input-state" />
                <Input value={form.zipCode} onChange={set("zipCode")} placeholder="ZIP" aria-label="ZIP code" required data-testid="input-zip" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deliveryInstructions">Additional delivery instructions</Label>
              <Textarea
                id="deliveryInstructions"
                value={form.deliveryInstructions}
                onChange={set("deliveryInstructions")}
                rows={3}
                data-testid="input-delivery-instructions"
              />
            </div>

            <Button type="submit" className="w-full" disabled={!canSubmit || apply.isPending} data-testid="button-submit-application">
              {apply.isPending ? "Sending…" : "Send application"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Already a wholesale customer?{" "}
              <Link href="/wholesale/login" className="underline">Sign in here</Link>.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
