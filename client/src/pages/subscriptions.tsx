import { useLocation } from "wouter";
import { Navbar } from "@/components/layout/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Repeat, DollarSign } from "lucide-react";

export default function Subscriptions() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-4xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <Badge variant="secondary" className="mb-4 gap-1">
            <Repeat className="w-3 h-3" />
            Subscribe & Save
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold mb-6" style={{ fontFamily: 'var(--font-heading)' }}>
            New Subscription Model
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            We've simplified subscriptions! Now you can subscribe and save directly from our shop.
          </p>
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <DollarSign className="w-6 h-6 text-primary" />
              How It Works
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">One-Time Purchase</h3>
                <p className="text-muted-foreground">$40 per case (12 bottles)</p>
                <p className="text-sm text-muted-foreground">Perfect for trying new flavors</p>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  Subscribe & Save
                  <Badge variant="default" className="text-xs">10% off</Badge>
                </h3>
                <p className="text-muted-foreground">$36 per case (12 bottles)</p>
                <p className="text-sm text-muted-foreground">Weekly or bi-weekly delivery options</p>
              </div>
            </div>

            <div className="bg-muted rounded-lg p-4 mt-6">
              <h4 className="font-semibold mb-3">Subscription Benefits:</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>✓ Automatic 10% discount on all orders</li>
                <li>✓ Choose weekly or bi-weekly delivery</li>
                <li>✓ Never run out of your favorite kombucha</li>
                <li>✓ Manage subscriptions through Stripe (pause, skip, or cancel anytime)</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <div className="text-center">
          <Button 
            size="lg" 
            className="text-lg px-8 rounded-full gap-2"
            onClick={() => navigate("/shop")}
            data-testid="button-goto-shop"
          >
            Go to Shop
            <ArrowRight className="w-5 h-5" />
          </Button>
          <p className="text-sm text-muted-foreground mt-4">
            Browse products and select your subscription preference at checkout
          </p>
        </div>
      </div>
    </div>
  );
}
