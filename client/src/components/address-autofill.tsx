import { Input } from "@/components/ui/input";
import { FormControl, FormItem, FormLabel } from "@/components/ui/form";
import { useCallback, useState, useEffect, useRef } from "react";
import { MapPin, Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";

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

interface AddressSuggestion {
  id: string;
  place_name: string;
  address?: string;
  text?: string;
  context?: Array<{
    id: string;
    text: string;
    short_code?: string;
  }>;
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
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch address suggestions from Mapbox Geocoding API
  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query || query.length < 3 || !MAPBOX_TOKEN) {
      setSuggestions([]);
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        access_token: MAPBOX_TOKEN,
        country: 'US',
        types: 'address',
        limit: '5',
        proximity: '-122.3321,47.6062', // Seattle area
      });

      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params}`
      );

      if (!response.ok) throw new Error('Failed to fetch suggestions');

      const data = await response.json();
      setSuggestions(data.features || []);
      if (data.features?.length > 0) {
        setIsOpen(true);
      }
    } catch (error) {
      console.error('Address autocomplete error:', error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced search
  const handleAddressInput = useCallback((value: string) => {
    onAddressChange(value);
    
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 300);
  }, [onAddressChange, fetchSuggestions]);

  // Handle suggestion selection
  const handleSelectSuggestion = useCallback((suggestion: AddressSuggestion) => {
    // Extract street address (the main text before the first comma)
    const streetAddress = suggestion.address 
      ? `${suggestion.address} ${suggestion.text}` 
      : suggestion.text || suggestion.place_name.split(',')[0];
    
    onAddressChange(streetAddress);

    // Parse context for city, state, zip
    if (suggestion.context) {
      for (const ctx of suggestion.context) {
        if (ctx.id.startsWith('place')) {
          onCityChange(ctx.text);
        } else if (ctx.id.startsWith('region')) {
          onStateChange(normalizeStateCode(ctx.short_code || ctx.text));
        } else if (ctx.id.startsWith('postcode')) {
          onZipCodeChange(ctx.text);
        }
      }
    }

    setSuggestions([]);
    setIsOpen(false);
  }, [onAddressChange, onCityChange, onStateChange, onZipCodeChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

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
        <Popover open={isOpen && suggestions.length > 0} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <FormControl>
              <div className="relative">
                <Input
                  ref={inputRef}
                  placeholder={addressPlaceholder}
                  value={addressValue}
                  onChange={(e) => handleAddressInput(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setIsOpen(true)}
                  onBlur={() => {
                    // Delay closing to allow click on suggestion
                    setTimeout(() => setIsOpen(false), 200);
                  }}
                  data-testid={addressTestId}
                />
                {isLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            </FormControl>
          </PopoverTrigger>
          <PopoverContent 
            className="w-[var(--radix-popover-trigger-width)] p-0" 
            align="start"
            sideOffset={4}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <Command>
              <CommandList>
                <CommandGroup>
                  {suggestions.map((suggestion) => (
                    <CommandItem
                      key={suggestion.id}
                      value={suggestion.place_name}
                      onSelect={() => handleSelectSuggestion(suggestion)}
                      className="cursor-pointer"
                      data-testid={`suggestion-${suggestion.id}`}
                    >
                      <MapPin className="mr-2 h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="truncate">{suggestion.place_name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
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
