import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { WholesaleUnitType, WholesaleCustomerPricing } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Per-customer price overrides, editable from the customer instead of only from the unit
 * (admin-wholesale-units has the same data unit-first). Same table, same endpoints —
 * wholesale_customer_pricing keyed by (customer, unit type) — which is exactly what order
 * placement charges, so what staff see here is what the customer pays.
 *
 * Blank = list price. Only rows that changed are written on save.
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
  const [draft, setDraft] = useState<Record<string, string>>({}); // unitTypeId -> input text

  const { data: unitTypes = [] } = useQuery<WholesaleUnitType[]>({
    queryKey: ["/api/wholesale-unit-types"],
    enabled: open,
  });

  const pricingKey = ["/api/wholesale-customer-pricing", customer?.id] as const;
  const { data: pricing = [], isLoading } = useQuery<WholesaleCustomerPricing[]>({
    queryKey: pricingKey,
    queryFn: async () => {
      const res = await fetch(`/api/wholesale-customer-pricing/${customer!.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load pricing");
      return res.json();
    },
    enabled: open && !!customer,
  });

  const overrideByUnit = useMemo(() => {
    const m = new Map<string, WholesaleCustomerPricing>();
    for (const p of pricing) m.set(p.unitTypeId, p);
    return m;
  }, [pricing]);

  // Reset the draft to what's stored every time the dialog opens or data refreshes.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const p of pricing) next[p.unitTypeId] = Number(p.customPrice).toFixed(2);
    setDraft(next);
  }, [open, pricing]);

  const activeUnits = unitTypes.filter((u) => u.isActive !== false);

  const save = useMutation({
    mutationFn: async () => {
      const results = { set: 0, cleared: 0 };
      for (const unit of activeUnits) {
        const text = (draft[unit.id] ?? "").trim();
        const existing = overrideByUnit.get(unit.id);
        if (text === "") {
          if (existing) {
            await apiRequest("DELETE", `/api/wholesale-customer-pricing/${existing.id}`);
            results.cleared++;
          }
          continue;
        }
        const value = Number(text);
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error(`"${text}" isn't a valid price for ${unit.name}`);
        }
        if (!existing || Number(existing.customPrice) !== value) {
          await apiRequest("POST", "/api/wholesale-customer-pricing", {
            customerId: customer!.id,
            unitTypeId: unit.id,
            customPrice: value.toFixed(2),
          });
          results.set++;
        }
      }
      return results;
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: pricingKey });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale-customer-pricing"] });
      toast({
        title: "Pricing saved",
        description:
          r.set || r.cleared
            ? [r.set ? `${r.set} price${r.set === 1 ? "" : "s"} set` : null, r.cleared ? `${r.cleared} back to list` : null].filter(Boolean).join(", ")
            : "No changes",
      });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Couldn't save pricing", description: e.message, variant: "destructive" }),
  });

  const overrideCount = Object.values(draft).filter((v) => v.trim() !== "").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Pricing</DialogTitle>
          <DialogDescription>
            {customer?.businessName} — leave a row blank to charge the list price. Orders and invoices use these immediately.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="rounded-md border divide-y max-h-[50vh] overflow-y-auto">
            {activeUnits.map((unit) => {
              const text = draft[unit.id] ?? "";
              const overridden = text.trim() !== "";
              return (
                <div key={unit.id} className="px-3 py-2.5 flex items-center justify-between gap-3" data-testid={`pricing-row-${unit.id}`}>
                  <div className="min-w-0">
                    <div className="font-medium">{unit.name}</div>
                    <div className="text-xs text-muted-foreground">
                      List ${Number(unit.defaultPrice).toFixed(2)}
                      {overridden && <span className="text-cedar font-medium"> · custom</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-sm">$</span>
                    <Input
                      className="w-24 text-right"
                      inputMode="decimal"
                      placeholder={Number(unit.defaultPrice).toFixed(2)}
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
          <span className="text-xs text-muted-foreground">{overrideCount ? `${overrideCount} custom price${overrideCount === 1 ? "" : "s"}` : "All at list price"}</span>
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
