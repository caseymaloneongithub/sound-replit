import { useQuery } from "@tanstack/react-query";
import { SubscriptionPlan } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/layout/navbar";
import { Check } from "lucide-react";

export default function Subscriptions() {
  const { data: plans, isLoading } = useQuery<SubscriptionPlan[]>({
    queryKey: ["/api/subscription-plans"],
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <Badge variant="secondary" className="mb-4">Save with Subscriptions</Badge>
          <h1 className="text-4xl md:text-6xl font-bold mb-6" style={{ fontFamily: 'var(--font-heading)' }}>
            Choose Your Plan
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Get your favorite kombucha delivered on a regular schedule. Save money and never run out.
          </p>
        </div>

        {isLoading ? (
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="relative">
                <CardHeader className="p-8">
                  <div className="h-8 bg-muted rounded mb-2 animate-pulse" />
                  <div className="h-12 bg-muted rounded animate-pulse" />
                </CardHeader>
                <CardContent className="p-8 pt-0 space-y-3">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="h-4 bg-muted rounded animate-pulse" />
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {plans?.map((plan, index) => (
              <Card 
                key={plan.id} 
                className={`relative hover-elevate ${index === 1 ? 'border-primary border-2' : ''}`}
                data-testid={`card-plan-${plan.id}`}
              >
                {index === 1 && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground px-4 py-1">
                      Most Popular
                    </Badge>
                  </div>
                )}
                <CardHeader className="p-8">
                  <CardTitle className="text-2xl mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
                    {plan.name}
                  </CardTitle>
                  <CardDescription className="text-base capitalize mb-6">
                    {plan.frequency} delivery • {plan.bottleCount} bottles
                  </CardDescription>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold">${plan.price}</span>
                    <span className="text-muted-foreground">/{plan.frequency === 'weekly' ? 'week' : 'month'}</span>
                  </div>
                  {plan.savings && (
                    <Badge variant="secondary" className="mt-3 w-fit">
                      {plan.savings}
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="p-8 pt-0">
                  <ul className="space-y-3">
                    {plan.benefits.map((benefit, i) => (
                      <li key={i} className="flex gap-3 items-start">
                        <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                        <span className="text-sm">{benefit}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter className="p-8 pt-0">
                  <Button 
                    className="w-full rounded-full"
                    variant={index === 1 ? "default" : "outline"}
                    data-testid={`button-subscribe-${plan.id}`}
                    onClick={() => window.location.href = `/subscribe/${plan.id}`}
                  >
                    Subscribe Now
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}

        <div className="mt-20 bg-muted rounded-lg p-8 md:p-12 max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold mb-4 text-center" style={{ fontFamily: 'var(--font-heading)' }}>
            How Subscriptions Work
          </h2>
          <div className="space-y-4 text-center md:text-left">
            <p className="text-muted-foreground">
              <strong className="text-foreground">Flexible:</strong> Pause, skip, or cancel anytime
            </p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Local Pickup:</strong> Collect your order at our brewery location
            </p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Fresh:</strong> Each batch is brewed fresh for maximum flavor
            </p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Customize:</strong> Mix and match flavors with each delivery
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
