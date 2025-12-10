import { AddressAutofill, useConfirmAddress } from "@mapbox/search-js-react";
import { Input } from "@/components/ui/input";
import { FormControl, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useRef, useCallback, forwardRef } from "react";

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
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

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
}: AddressAutofillFieldsProps) {
  const handleRetrieve = useCallback((res: any) => {
    const feature = res.features?.[0];
    if (feature?.properties) {
      const props = feature.properties;
      if (props.address_line1) onAddressChange(props.address_line1);
      if (props.place) onCityChange(props.place);
      if (props.region_code) onStateChange(props.region_code);
      if (props.postcode) onZipCodeChange(props.postcode);
    }
  }, [onAddressChange, onCityChange, onStateChange, onZipCodeChange]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="space-y-4">
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
            </FormItem>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FormItem>
        <FormLabel>Street Address</FormLabel>
        <FormControl>
          <AddressAutofill accessToken={MAPBOX_TOKEN} onRetrieve={handleRetrieve}>
            <Input
              placeholder={addressPlaceholder}
              value={addressValue}
              onChange={(e) => onAddressChange(e.target.value)}
              autoComplete="address-line1"
              data-testid={addressTestId}
            />
          </AddressAutofill>
        </FormControl>
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
          </FormItem>
        </div>
      </div>
    </div>
  );
}
