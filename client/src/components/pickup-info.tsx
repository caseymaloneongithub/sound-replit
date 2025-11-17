import { Card, CardContent } from "@/components/ui/card";
import { Clock, MapPin, Phone } from "lucide-react";
import { PICKUP_POLICY } from "@shared/pickup-policy";

interface PickupInfoProps {
  variant?: 'default' | 'compact';
  className?: string;
}

export function PickupInfo({ variant = 'default', className = '' }: PickupInfoProps) {
  if (variant === 'compact') {
    return (
      <div className={`space-y-2 text-sm ${className}`} data-testid="pickup-info-compact">
        <div className="flex items-start gap-2">
          <Clock className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
          <div>
            <div className="font-medium" data-testid="text-pickup-hours-label">Pickup Hours</div>
            <div className="text-muted-foreground" data-testid="text-pickup-time">{PICKUP_POLICY.timeWindow}</div>
            <div className="text-muted-foreground text-xs" data-testid="text-pickup-days">Monday - Thursday only</div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <MapPin className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
          <div>
            <div className="font-medium" data-testid="text-pickup-location-label">Location</div>
            <div className="text-muted-foreground" data-testid="text-pickup-address">{PICKUP_POLICY.address}</div>
            <div className="text-muted-foreground text-xs" data-testid="text-pickup-instructions">{PICKUP_POLICY.instructions}</div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Phone className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
          <div>
            <div className="font-medium" data-testid="text-pickup-contact-label">Contact</div>
            <div className="text-muted-foreground">
              <a 
                href={`tel:${PICKUP_POLICY.phone}`} 
                className="hover:underline"
                data-testid="link-pickup-phone"
              >
                {PICKUP_POLICY.phoneFormatted}
              </a>
            </div>
            <div className="text-muted-foreground text-xs" data-testid="text-pickup-call-instructions">{PICKUP_POLICY.callInstructions}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className={className} data-testid="card-pickup-info">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-start gap-3">
          <Clock className="w-5 h-5 mt-1 text-muted-foreground flex-shrink-0" />
          <div>
            <div className="font-semibold mb-1" data-testid="text-pickup-hours-label">Pickup Hours</div>
            <div className="text-muted-foreground" data-testid="text-pickup-time">{PICKUP_POLICY.timeWindow}</div>
            <div className="text-muted-foreground text-sm mt-1" data-testid="text-pickup-days">Monday - Thursday only</div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <MapPin className="w-5 h-5 mt-1 text-muted-foreground flex-shrink-0" />
          <div>
            <div className="font-semibold mb-1" data-testid="text-pickup-location-label">Pickup Location</div>
            <div className="text-muted-foreground" data-testid="text-pickup-address">{PICKUP_POLICY.address}</div>
            <div className="text-muted-foreground text-sm" data-testid="text-pickup-instructions">{PICKUP_POLICY.instructions}</div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Phone className="w-5 h-5 mt-1 text-muted-foreground flex-shrink-0" />
          <div>
            <div className="font-semibold mb-1" data-testid="text-pickup-arrival-label">When You Arrive</div>
            <div className="text-muted-foreground">
              Call{" "}
              <a 
                href={`tel:${PICKUP_POLICY.phone}`} 
                className="hover:underline font-medium"
                data-testid="link-pickup-phone"
              >
                {PICKUP_POLICY.phoneFormatted}
              </a>
            </div>
            <div className="text-muted-foreground text-sm" data-testid="text-pickup-call-instructions">{PICKUP_POLICY.callInstructions}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
