import { AddressAutofill } from "@mapbox/search-js-react";
import { Input } from "@/components/ui/input";
import { FormControl, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useCallback } from "react";
import { MapPin } from "lucide-react";

interface AddressAutofillFieldsProps {
  onAddressChange: (address: string) => void;
  onCityChange: (city: string) => void;
  onStateChange: (state: string) => void;
  onZipCodeChange: (zipCode: string) => void;
  addressValue: string;
  cityValue: string;
  stateValue: string;
  zipCodeValue: string;
  addressPlaceholder?: string;
  cityPlaceholder?: string;
  statePlaceholder?: string;
  zipPlaceholder?: string;
  addressTestId?: string;
  cityTestId?: string;
  stateTestId?: string;
  zipTestId?: string;
  addressError?: string;
  cityError?: string;
  stateError?: string;
  zipError?: string;
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

// Map common state names to USPS abbreviations
const STATE_NAME_TO_CODE: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
  'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
  'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
  'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
  'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
  'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
  'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
  'district of columbia': 'DC', 'puerto rico': 'PR', 'guam': 'GU', 'american samoa': 'AS',
  'virgin islands': 'VI', 'northern mariana islands': 'MP'
};

function normalizeStateCode(stateValue: string): string {
  if (!stateValue) return '';
  
  // Strip country prefixes (US-, us-, CA-, etc.)
  let cleaned = stateValue.replace(/^[a-zA-Z]{2}-/i, '').trim();
  
  // If already a 2-letter code, return uppercase
  if (cleaned.length === 2) {
    return cleaned.toUpperCase();
  }
  
  // Try to match full state name
  const normalized = cleaned.toLowerCase();
  if (STATE_NAME_TO_CODE[normalized]) {
    return STATE_NAME_TO_CODE[normalized];
  }
  
  // Return first 2 chars as last resort (not ideal but better than nothing)
  return cleaned.substring(0, 2).toUpperCase();
}

export function AddressAutofillFields({
  onAddressChange,
  onCityChange,
  onStateChange,
  onZipCodeChange,
  addressValue,
  cityValue,
  stateValue,
  zipCodeValue,
  addressPlaceholder = "Start typing an address...",
  cityPlaceholder = "City",
  statePlaceholder = "WA",
  zipPlaceholder = "ZIP Code",
  addressTestId = "input-address",
  cityTestId = "input-city",
  stateTestId = "input-state",
  zipTestId = "input-zip",
  addressError,
  cityError,
  stateError,
  zipError,
}: AddressAutofillFieldsProps) {
  const handleRetrieve = useCallback((res: any) => {
    const feature = res.features?.[0];
    if (!feature) return;
    
    const props = feature.properties || {};
    const context = feature.context || [];
    
    // Extract address line 1
    if (props.address_line1) {
      onAddressChange(props.address_line1);
    } else if (props.full_address) {
      const parts = props.full_address.split(',');
      if (parts.length > 0) onAddressChange(parts[0].trim());
    }
    
    // Extract city - try multiple sources
    const city = props.place || 
                 props.locality || 
                 props.address_level2 ||
                 context.find((c: any) => c.id?.startsWith('place'))?.text ||
                 context.find((c: any) => c.id?.startsWith('locality'))?.text;
    if (city) onCityChange(city);
    
    // Extract state - prefer short_code, then map full name
    let stateCode = props.region_code || props.region_code_short || props.address_level1;
    
    if (!stateCode) {
      // Try to get from context
      const regionContext = context.find((c: any) => c.id?.startsWith('region'));
      if (regionContext) {
        // Prefer short_code (e.g., "US-WA" -> "WA")
        if (regionContext.short_code) {
          stateCode = regionContext.short_code.replace('US-', '');
        } else if (regionContext.text) {
          stateCode = regionContext.text;
        }
      }
    }
    
    if (stateCode) {
      onStateChange(normalizeStateCode(stateCode));
    }
    
    // Extract zip code
    const zip = props.postcode || 
                props.postal_code ||
                context.find((c: any) => c.id?.startsWith('postcode'))?.text;
    if (zip) onZipCodeChange(zip);
  }, [onAddressChange, onCityChange, onStateChange, onZipCodeChange]);

  // Fallback to manual entry when no Mapbox token
  if (!MAPBOX_TOKEN) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          <span>Enter address manually</span>
        </div>
        <FormItem>
          <FormLabel>Street Address</FormLabel>
          <FormControl>
            <Input
              placeholder={addressPlaceholder}
              value={addressValue}
              onChange={(e) => onAddressChange(e.target.value)}
              data-testid={addressTestId}
            />
          </FormControl>
          {addressError && <p className="text-sm font-medium text-destructive">{addressError}</p>}
        </FormItem>
        <div className="grid grid-cols-2 gap-4">
          <FormItem>
            <FormLabel>City</FormLabel>
            <FormControl>
              <Input
                placeholder={cityPlaceholder}
                value={cityValue}
                onChange={(e) => onCityChange(e.target.value)}
                data-testid={cityTestId}
              />
            </FormControl>
            {cityError && <p className="text-sm font-medium text-destructive">{cityError}</p>}
          </FormItem>
          <div className="grid grid-cols-2 gap-2">
            <FormItem>
              <FormLabel>State</FormLabel>
              <FormControl>
                <Input
                  placeholder={statePlaceholder}
                  value={stateValue}
                  onChange={(e) => onStateChange(e.target.value)}
                  data-testid={stateTestId}
                  maxLength={2}
                />
              </FormControl>
              {stateError && <p className="text-sm font-medium text-destructive">{stateError}</p>}
            </FormItem>
            <FormItem>
              <FormLabel>ZIP</FormLabel>
              <FormControl>
                <Input
                  placeholder={zipPlaceholder}
                  value={zipCodeValue}
                  onChange={(e) => onZipCodeChange(e.target.value)}
                  data-testid={zipTestId}
                />
              </FormControl>
              {zipError && <p className="text-sm font-medium text-destructive">{zipError}</p>}
            </FormItem>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <MapPin className="h-3 w-3" />
        <span>Start typing to search addresses</span>
      </div>
      <FormItem>
        <FormLabel>Street Address</FormLabel>
        <FormControl>
          <AddressAutofill 
            accessToken={MAPBOX_TOKEN} 
            onRetrieve={handleRetrieve}
            options={{
              country: "US",
              proximity: { lng: -122.3321, lat: 47.6062 }
            }}
          >
            <Input
              placeholder={addressPlaceholder}
              value={addressValue}
              onChange={(e) => onAddressChange(e.target.value)}
              autoComplete="address-line1"
              data-testid={addressTestId}
            />
          </AddressAutofill>
        </FormControl>
        {addressError && <p className="text-sm font-medium text-destructive">{addressError}</p>}
      </FormItem>
      <div className="grid grid-cols-2 gap-4">
        <FormItem>
          <FormLabel>City</FormLabel>
          <FormControl>
            <Input
              placeholder={cityPlaceholder}
              value={cityValue}
              onChange={(e) => onCityChange(e.target.value)}
              autoComplete="address-level2"
              data-testid={cityTestId}
            />
          </FormControl>
          {cityError && <p className="text-sm font-medium text-destructive">{cityError}</p>}
        </FormItem>
        <div className="grid grid-cols-2 gap-2">
          <FormItem>
            <FormLabel>State</FormLabel>
            <FormControl>
              <Input
                placeholder={statePlaceholder}
                value={stateValue}
                onChange={(e) => onStateChange(e.target.value)}
                autoComplete="address-level1"
                data-testid={stateTestId}
                maxLength={2}
              />
            </FormControl>
            {stateError && <p className="text-sm font-medium text-destructive">{stateError}</p>}
          </FormItem>
          <FormItem>
            <FormLabel>ZIP</FormLabel>
            <FormControl>
              <Input
                placeholder={zipPlaceholder}
                value={zipCodeValue}
                onChange={(e) => onZipCodeChange(e.target.value)}
                autoComplete="postal-code"
                data-testid={zipTestId}
              />
            </FormControl>
            {zipError && <p className="text-sm font-medium text-destructive">{zipError}</p>}
          </FormItem>
        </div>
      </div>
    </div>
  );
}
