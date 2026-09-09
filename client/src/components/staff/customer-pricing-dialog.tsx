import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { WholesaleUnitType, WholesaleCustomerPricing, WholesaleLocationPricing } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Wholesale price overrides, editable from the customer. Two scopes (owner,
 * 2026-09-09): the WHOLE ACCOUNT (wholesale_customer_pricing) and, for
 * multi-location customers, any single LOCATION (wholesale_location_pricing).
 * Order pricing resolves location -> account -> list, so a blank row falls back
 * to the next tier — the placeholder always shows what would actually be charged.
 *
 * Only rows that changed are written on save.
 */
export function CustomerPricingDialog({
  customer,
  open,
  onOpenChange,
  canEdit,
}: {
  customer: { id: string; businessName: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [scope, setScope] = useState<string>("account"); // "account" | locationId
  const [draft, setDraft] = useState<Record<string, string>>({}); // unitTypeId -> input text

  const { data: unitTypes = [] } = useQuery<WholesaleUnitType[]>({
    queryKey: ["/api/wholesale-unit-types"],
    enabled: open,
  });

  const { data: locationInfo } = useQuery<{ businessName: string; locations: Array<{ id: string; locationName: string }> }>({
    queryKey: ["/api/wholesale/claim/locations", customer?.id],
    queryFn: async () => {
      const res = await fetch(`/api/wholesale/claim/locations?customerId=${customer!.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load locations");
      return res.json();
    },
    enabled: open && !!customer,
  });
  const locations = locationInfo?.locations ?? [];
  const multiLocation = locations.length > 1;

  const accountKey = ["/api/wholesale-customer-pricing", customer?.id] as const;
  const { data: accountPricing = [], isLoading: accountLoading } = useQuery<WholesaleCustomerPricing[]>({
    queryKey: accountKey,
    queryFn: async () => {
      const res = await fetch(`/api/wholesale-customer-pricing/${customer!.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load pricing");
      return res.json();
    },
    enabled: open && !!customer,
  });

  const locationKey = ["/api/wholesale-location-pricing", scope] as const;
  const { data: locationPricing = [], isLoading: locationLoading } = useQuery<WholesaleLocationPricing[]>({
    queryKey: locationKey,
    queryFn: async () => {
      const res = await fetch(`/api/wholesale-location-pricing/${scope}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load location pricing");
      return res.json();
    },
    enabled: open && scope !== "account",
  });

  const accountByUnit = useMemo(() => {
    const m = new Map<string, WholesaleCustomerPricing>();
    for (const p of accountPricing) m.set(p.unitTypeId, p);
    return m;
  }, [accountPricing]);

  const locationByUnit = useMemo(() => {
    const m = new Map<string, WholesaleLocationPricing>();
    for (const p of locationPricing) m.set(p.unitTypeId, p);
    return m;
  }, [locationPricing]);

  const scopedByUnit: Map<string, { id: string; customPrice: string }> =
    scope === "account" ? accountByUnit : locationByUnit;
  const isLoading = scope === "account" ? accountLoading : accountLoading || locationLoading;

  // Reset scope when the dialog opens; reset the draft whenever scope or data changes.
  useEffect(() => {
    if (open) setScope("account");
  }, [open, customer?.id]);
  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const [unitTypeId, p] of Array.from(scopedByUnit.entries())) {
      next[unitTypeId] = Number(p.customPrice).toFixed(2);
    }
    setDraft(next);
  }, [open, scopedByUnit]);

  const activeUnits = unitTypes.filter((u) => u.isActive !== false);

  // What a blank row would charge in the current scope.
  const fallbackFor = (unit: WholesaleUnitType): { price: number; source: string } => {
    if (scope !== "account") {
      const acct = accountByUnit.get(unit.id);
      if (acct) return { price: Number(acct.customPrice), source: "account" };
    }
    return { price: Number(unit.defaultPrice), source: "list" };
  };

  const save = useMutation({
    mutationFn: async () => {
      const results = { set: 0, cleared: 0 };
      for (const unit of activeUnits) {
        const text = (draft[unit.id] ?? "").trim();
        const existing = scopedByUnit.get(unit.id);
        if (text === "") {
          if (existing) {
            const path = scope === "account"
              ? `/api/wholesale-customer-pricing/${existing.id}`
              : `/api/wholesale-location-pricing/${existing.id}`;
            await apiRequest("DELETE", path);
            results.cleared++;
          }
          continue;
        }
        const value = Number(text);
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error(`"${text}" isn't a valid price for ${unit.name}`);
        }
        if (!existing || Number(existing.customPrice) !== value) {
          if (scope === "account") {
            await apiRequest("POST", "/api/wholesale-customer-pricing", {
              customerId: customer!.id,
              unitTypeId: unit.id,
              customPrice: value.toFixed(2),
            });
          } else {
            await apiRequest("POST", "/api/wholesale-location-pricing", {
              locationId: scope,
              unitTypeId: unit.id,
              customPrice: value.toFixed(2),
            });
          }
          results.set++;
        }
      }
      return results;
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: accountKey });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale-customer-pricing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale-location-pricing"] });
      toast({
        title: "Pricing saved",
        description:
          r.set || r.cleared
            ? [r.set ? `${r.set} price${r.set === 1 ? "" : "s"} set` : null, r.cleared ? `${r.cleared} cleared` : null].filter(Boolean).join(", ")
            : "No changes",
      });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Couldn't save pricing", description: e.message, variant: "destructive" }),
  });

  const overrideCount = Object.values(draft).filter((v) => v.trim() !== "").length;
  const scopeName = scope === "account" ? "the whole account" : (locations.find((l) => l.id === scope)?.locationName ?? "this location");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Pricing</DialogTitle>
          <DialogDescription>
            {customer?.businessName} — leave a row blank to fall back to {scope === "account" ? "the list price" : "the account price"}. Orders and invoices use these immediately.
          </DialogDescription>
        </DialogHeader>

        {multiLocation && (
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger data-testid="select-pricing-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="account">Whole account</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>{l.locationName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="rounded-md border divide-y max-h-[50vh] overflow-y-auto">
            {activeUnits.map((unit) => {
              const text = draft[unit.id] ?? "";
              const overridden = text.trim() !== "";
              const fallback = fallbackFor(unit);
              return (
                <div key={unit.id} className="px-3 py-2.5 flex items-center justify-between gap-3" data-testid={`pricing-row-${unit.id}`}>
                  <div className="min-w-0">
                    <div className="font-medium">{unit.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {fallback.source === "account" ? "Account" : "List"} ${fallback.price.toFixed(2)}
                      {overridden && <span className="text-cedar font-medium"> · custom</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-sm">$</span>
                    <Input
                      className="w-24 text-right"
                      inputMode="decimal"
                      placeholder={fallback.price.toFixed(2)}
                      value={text}
                      disabled={!canEdit}
                      onChange={(e) => setDraft((d) => ({ ...d, [unit.id]: e.target.value }))}
                      data-testid={`input-price-${unit.id}`}
                    />
                  </div>
                </div>
              );
            })}
            {activeUnits.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">No active unit types.</p>}
          </div>
        )}

        <DialogFooter className="flex items-center sm:justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {overrideCount ? `${overrideCount} custom price${overrideCount === 1 ? "" : "s"} for ${scopeName}` : `No overrides for ${scopeName}`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-pricing">Cancel</Button>
            {canEdit && (
              <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-pricing">
                {save.isPending ? "Saving…" : "Save pricing"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
