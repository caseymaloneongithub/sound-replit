import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Printer, ArrowLeft, Landmark, Loader2, Mail } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { User } from "@shared/schema";

export default function WholesaleInvoice() {
  // Mounted at both the staff path and a customer path. Customers previously landed on
  // the staff route from "Pay Now" / "View Invoice" and got Access Denied.
  const [, params] = useRoute("/wholesale/invoice/:id");
  const [, customerParams] = useRoute("/wholesale-customer/invoice/:id");
  const [, setLocation] = useLocation();
  const orderId = params?.id ?? customerParams?.id;
  const { toast } = useToast();

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const isStaff = user?.role === "staff" || user?.role === "admin" || user?.role === "super_admin";

  const { data: invoiceData, isLoading } = useQuery<{
    order: any;
    customer: any;
    items: any[];
    adjustments: Array<{ id: string; label: string; amount: string }>;
  }>({
    queryKey: ["/api/wholesale/orders", orderId, "invoice"],
    enabled: !!orderId,
  });

  const [adjLabel, setAdjLabel] = useState("");
  const [adjAmount, setAdjAmount] = useState("");

  const refreshInvoice = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/wholesale/orders", orderId, "invoice"] });

  const addAdjustment = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/wholesale/orders/${orderId}/adjustments`, {
        label: adjLabel,
        amount: Number(adjAmount),
      }),
    onSuccess: () => {
      setAdjLabel("");
      setAdjAmount("");
      refreshInvoice();
    },
    onError: (e: any) => toast({ title: "Couldn't add adjustment", description: e.message, variant: "destructive" }),
  });

  const removeAdjustment = useMutation({
    mutationFn: async (adjustmentId: string) =>
      apiRequest("DELETE", `/api/wholesale/orders/${orderId}/adjustments/${adjustmentId}`),
    onSuccess: refreshInvoice,
    onError: (e: any) => toast({ title: "Couldn't remove adjustment", description: e.message, variant: "destructive" }),
  });

  const paymentMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/wholesale/orders/${orderId}/create-payment`, {});
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      toast({
        title: "Payment Error",
        description: error.message || "Failed to initiate payment",
        variant: "destructive",
      });
    },
  });

  // Send dialog: recipients / subject / note are pre-loaded and editable
  // before anything goes out (owner, 2026-09-02).
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [sendSubject, setSendSubject] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const fetchPreview = async (fields: { to: string; subject: string; message: string }) => {
    setPreviewBusy(true);
    try {
      const to = fields.to.split(/[,;]/).map((e) => e.trim()).filter(Boolean);
      const data = await apiRequest("POST", `/api/wholesale/orders/${orderId}/send-invoice`, {
        preview: true,
        to: to.length ? to : undefined,
        subject: fields.subject.trim() || undefined,
        message: fields.message.trim() || undefined,
      });
      setPreviewHtml(data.html);
    } catch (e: any) {
      toast({ title: "Couldn't build preview", description: e.message, variant: "destructive" });
    } finally {
      setPreviewBusy(false);
    }
  };

  const sendInvoiceMutation = useMutation({
    mutationFn: async () => {
      const to = sendTo.split(/[,;]/).map((e) => e.trim()).filter(Boolean);
      return await apiRequest("POST", `/api/wholesale/orders/${orderId}/send-invoice`, {
        to,
        subject: sendSubject.trim() || undefined,
        message: sendMessage.trim() || undefined,
      });
    },
    onSuccess: (data) => {
      setSendOpen(false);
      toast({
        title: "Invoice Sent",
        description: data.message || "Invoice email sent successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Email Error",
        description: error.message || "Failed to send invoice email",
        variant: "destructive",
      });
    },
  });

  const handleSendInvoice = () => {
    // Same routing the server uses: the location's invoice inbox(es), account otherwise.
    const order = invoiceData?.order;
    const customer = invoiceData?.customer;
    const to = String(order?.location?.contactEmail || customer?.email || "");
    const subject = `Invoice ${order?.invoiceNumber ?? ""} - Puget Sound Kombucha Co.`;
    setSendTo(to);
    setSendSubject(subject);
    setSendMessage("");
    setPreviewHtml(null);
    setSendOpen(true);
    fetchPreview({ to, subject, message: "" });
  };

  const handlePrint = () => {
    window.print();
  };

  const handlePayNow = () => {
    paymentMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="text-muted-foreground">Loading invoice...</div>
        </div>
      </div>
    );
  }

  if (!invoiceData) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="text-muted-foreground">Invoice not found</div>
        </div>
      </div>
    );
  }

  const { order, customer, items } = invoiceData;
  const subtotal = items.reduce((sum: number, item: any) => {
    return sum + parseFloat(item.unitPrice) * item.quantity;
  }, 0);
  // Adjustments lock the moment money starts moving: paid, or an ACH debit in flight.
  const adjustmentsLocked = !!order.paidAt || (!!order.paymentInitiatedAt && !order.paymentFailedAt);

  return (
    <div className="min-h-screen bg-background">
      <div className="print:hidden sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center gap-4 px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              // Navigate to appropriate orders page based on user role
              const isStaffOrAdmin = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'staff';
              setLocation(isStaffOrAdmin ? "/wholesale/orders" : "/wholesale-customer/orders");
            }}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">Invoice {order.invoiceNumber}</h1>
          <div className="ml-auto flex items-center gap-2">
            {/* A bank debit already in flight: no pay button, or the customer pays twice. */}
            {order.paymentInitiatedAt && !order.paidAt && (
              <span className="text-sm text-muted-foreground flex items-center gap-2" data-testid="text-payment-processing">
                Bank payment processing
              </span>
            )}
            {customer.allowOnlinePayment && !order.paidAt && !order.paymentInitiatedAt && (
              <Button
                onClick={handlePayNow}
                disabled={paymentMutation.isPending}
                data-testid="button-pay-now"
              >
                {paymentMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Landmark className="mr-2 h-4 w-4" />
                    Pay by bank transfer
                  </>
                )}
              </Button>
            )}
            {isAdmin && (
              <Button
                onClick={handleSendInvoice}
                variant="outline"
                disabled={sendInvoiceMutation.isPending}
                data-testid="button-send-invoice"
              >
                {sendInvoiceMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Send Invoice
                  </>
                )}
              </Button>
            )}
            <Button
              onClick={handlePrint}
              variant="outline"
              data-testid="button-print"
            >
              <Printer className="mr-2 h-4 w-4" />
              Print Invoice
            </Button>
          </div>
        </div>
      </div>

      <div className="container max-w-4xl py-8 px-4 print:p-0 print:max-w-none" id="invoice-print-area">
        <Card className="print:shadow-none print:border-0 relative overflow-hidden">
          {order.paidAt && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div 
                className="text-green-500/20 font-bold text-[120px] transform -rotate-45 select-none"
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                PAID
              </div>
            </div>
          )}
          <CardContent className="p-8 print:p-0 relative">
            <div className="mb-8">
              <div className="flex items-start justify-between">
                <h1 className="text-3xl font-bold mb-2">INVOICE</h1>
                {order.paidAt && (
                  <div className="bg-green-100 text-green-800 px-4 py-2 rounded-md font-semibold text-sm" data-testid="badge-paid">
                    PAID - {format(new Date(order.paidAt), "MMM dd, yyyy")}
                  </div>
                )}
              </div>
              <div className="text-muted-foreground">
                Invoice #: <span className="font-semibold text-foreground" data-testid="text-invoice-number">{order.invoiceNumber}</span>
              </div>
              <div className="text-muted-foreground">
                Date: <span className="font-semibold text-foreground">{format(new Date(order.orderDate), "MMM dd, yyyy")}</span>
              </div>
              {order.deliveryDate && (
                <div className="text-muted-foreground">
                  Delivery Date: <span className="font-semibold text-foreground">{format(new Date(order.deliveryDate), "MMM dd, yyyy")}</span>
                </div>
              )}
              {order.dueDate && (
                <div className="text-muted-foreground">
                  Payment Due: <span className="font-semibold text-foreground">{format(new Date(order.dueDate), "MMM dd, yyyy")}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-8 mb-8">
              <div>
                <h2 className="font-semibold text-sm text-muted-foreground mb-2">FROM</h2>
                <div>
                  <div className="font-semibold">Puget Sound Kombucha Co.</div>
                  <div className="text-sm text-muted-foreground">4501 Shilshole Ave NW</div>
                  <div className="text-sm text-muted-foreground">Seattle, WA 98107</div>
                  <div className="text-sm text-muted-foreground">orders@soundkombucha.com</div>
                  <div className="text-sm text-muted-foreground">(206) 789-5219</div>
                  {/* Checks go to the mailing address, not the brewery. */}
                  {!order.paidAt && (
                    <div className="text-sm text-muted-foreground mt-3" data-testid="text-remit-address">
                      <div className="font-medium text-foreground">Mail checks to</div>
                      <div>1008 W Sherri Dr</div>
                      <div>Gilbert, AZ 85233</div>
                    </div>
                  )}
                </div>
              </div>

              {/* BILL TO only when there is no delivery location to identify the store —
                  the account's billing email (e.g. the first location's) misleads on
                  multi-location customers (owner, 2026-08-31). */}
              {!order.location && (
                <div>
                  <h2 className="font-semibold text-sm text-muted-foreground mb-2">BILL TO</h2>
                  <div data-testid="customer-info">
                    <div className="font-semibold">{customer.businessName}</div>
                    <div className="text-sm text-muted-foreground">{customer.contactName}</div>
                    <div className="text-sm text-muted-foreground">{customer.phone}</div>
                  </div>
                </div>
              )}

              {order.location && (
                <div>
                  <h2 className="font-semibold text-sm text-muted-foreground mb-2">DELIVER TO</h2>
                  <div data-testid="delivery-location">
                    <div className="font-semibold">{order.location.locationName}</div>
                    <div className="text-sm text-muted-foreground">{order.location.address}</div>
                    <div className="text-sm text-muted-foreground">
                      {order.location.city}, {order.location.state} {order.location.zipCode}
                    </div>
                    {order.location.contactName && (
                      <div className="text-sm text-muted-foreground mt-2">
                        <div className="font-medium">Contact:</div>
                        <div>{order.location.contactName}</div>
                        {order.location.contactPhone && (
                          <div>{order.location.contactPhone}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <Separator className="my-6" />

            <div className="mb-8">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 font-semibold">Product</th>
                    <th className="text-right py-3 font-semibold">Quantity</th>
                    <th className="text-right py-3 font-semibold">Price/Unit</th>
                    <th className="text-right py-3 font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any) => (
                    <tr key={item.id} className="border-b" data-testid={`invoice-item-${item.id}`}>
                      <td className="py-4">
                        <div className="font-medium">{item.product.name}</div>
                        <div className="text-sm text-muted-foreground">{item.product.flavor}</div>
                      </td>
                      {/* Plain count — "4 cases (48 bottles)" read absurdly on keg lines. */}
                      <td className="text-right py-4">
                        <div>{item.quantity}</div>
                      </td>
                      <td className="text-right py-4">${parseFloat(item.unitPrice).toFixed(2)}</td>
                      <td className="text-right py-4 font-medium">
                        ${(parseFloat(item.unitPrice) * item.quantity).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end mb-8">
              <div className="w-80 space-y-2">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal:</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>

                {/* Signed adjustments: pallet fees, damage credits. Customers see them
                    read-only; staff can edit until payment starts. */}
                {(invoiceData.adjustments ?? []).map((a) => (
                  <div key={a.id} className="flex justify-between items-center text-muted-foreground" data-testid={`adjustment-${a.id}`}>
                    <span className="flex items-center gap-1">
                      {isStaff && !adjustmentsLocked && (
                        <button
                          type="button"
                          onClick={() => removeAdjustment.mutate(a.id)}
                          className="print:hidden text-destructive hover:opacity-70 mr-1"
                          aria-label={`Remove ${a.label}`}
                          data-testid={`button-remove-adjustment-${a.id}`}
                        >
                          ×
                        </button>
                      )}
                      {a.label}:
                    </span>
                    <span className={Number(a.amount) < 0 ? "text-green-700 dark:text-green-400" : ""}>
                      {Number(a.amount) < 0 ? "−" : "+"}${Math.abs(Number(a.amount)).toFixed(2)}
                    </span>
                  </div>
                ))}

                {isStaff && !adjustmentsLocked && (
                  <div className="print:hidden flex items-center gap-2 pt-1">
                    <Input
                      value={adjLabel}
                      onChange={(e) => setAdjLabel(e.target.value)}
                      placeholder="e.g. Pallet fee"
                      className="h-8 text-sm"
                      data-testid="input-adjustment-label"
                    />
                    <Input
                      value={adjAmount}
                      onChange={(e) => setAdjAmount(e.target.value.replace(/[^0-9.\-]/g, ""))}
                      placeholder="+/- amount"
                      inputMode="decimal"
                      className="h-8 w-28 text-sm text-right"
                      data-testid="input-adjustment-amount"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={!adjLabel.trim() || !adjAmount || Number(adjAmount) === 0 || addAdjustment.isPending}
                      onClick={() => addAdjustment.mutate()}
                      data-testid="button-add-adjustment"
                    >
                      Add
                    </Button>
                  </div>
                )}

                <Separator />
                <div className="flex justify-between text-lg font-bold">
                  <span>Total:</span>
                  <span data-testid="invoice-total">${parseFloat(order.totalAmount).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {order.notes && (
              <div className="mt-8 p-4 bg-muted rounded-md">
                <h3 className="font-semibold mb-2">Notes:</h3>
                <p className="text-sm text-muted-foreground">{order.notes}</p>
              </div>
            )}

            <div className="mt-12 text-center text-sm text-muted-foreground">
              <p>Thank you for your business!</p>
              <p className="mt-2">Questions? Contact us at orders@soundkombucha.com or (206) 789-5219</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <style>{`
        @media print {
          /* Hide everything by default */
          body * {
            visibility: hidden;
          }
          
          /* Show only the invoice print area and its contents */
          #invoice-print-area,
          #invoice-print-area * {
            visibility: visible;
          }
          
          /* Position the print area at top-left */
          #invoice-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          
          /* Reset backgrounds and colors for clean printing */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          
          html, body {
            background: white !important;
            color: black !important;
            font-size: 12pt !important;
            line-height: 1.4 !important;
          }
          
          /* Remove shadows and borders from card */
          .shadow, .shadow-sm, .shadow-md, .shadow-lg,
          [class*="border"] {
            box-shadow: none !important;
          }
          
          /* Make all backgrounds white */
          [class*="bg-card"], [class*="bg-muted"], [class*="bg-background"] {
            background: white !important;
          }
          
          /* Ensure all text is black */
          [class*="text-muted"], [class*="text-foreground"], p, span, div, h1, h2, h3, td, th {
            color: black !important;
          }
          
          /* Table styling for print */
          table {
            width: 100% !important;
            border-collapse: collapse !important;
          }
          
          th, td {
            border: 1px solid #ccc !important;
            padding: 8px !important;
          }
          
          th {
            background: #f5f5f5 !important;
            font-weight: bold !important;
          }
          
          /* Remove rounded corners for cleaner print */
          [class*="rounded"] {
            border-radius: 0 !important;
          }
          
          /* Notes section styling */
          [class*="bg-muted"] {
            border: 1px solid #ccc !important;
            background: #f9f9f9 !important;
          }
          
          /* Page setup - zero margin removes browser headers/footers */
          @page {
            size: letter;
            margin: 0;
          }
          
          /* Add padding to content since page margin is 0 */
          #invoice-print-area {
            padding: 0.5in !important;
            transform: scale(0.82);
            transform-origin: top left;
            width: 122% !important; /* Compensate for scale (100/0.82) */
            box-sizing: border-box;
          }
          
          /* Prevent page breaks */
          #invoice-print-area, #invoice-print-area * {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          
          /* Compact spacing for print */
          .mb-8 {
            margin-bottom: 1rem !important;
          }
          
          .mt-12 {
            margin-top: 1.5rem !important;
          }
          
          .gap-8 {
            gap: 1rem !important;
          }
          
          .py-4, .py-3 {
            padding-top: 0.25rem !important;
            padding-bottom: 0.25rem !important;
          }
        }
      `}</style>

      {/* Send-invoice dialog: full rendered preview, everything editable before it goes out */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send invoice {order.invoiceNumber}</DialogTitle>
            <DialogDescription>
              The Wave-style PDF is attached automatically. Separate several recipients with commas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="send-to">To</Label>
                <Input id="send-to" value={sendTo} onChange={(e) => setSendTo(e.target.value)} data-testid="input-send-to" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="send-subject">Subject</Label>
                <Input id="send-subject" value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} data-testid="input-send-subject" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="send-message">Email text (optional)</Label>
              <Textarea id="send-message" rows={3} value={sendMessage} onChange={(e) => setSendMessage(e.target.value)}
                placeholder="Shown at the top of the email, above the invoice details"
                data-testid="input-send-message" />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm text-muted-foreground">Preview</Label>
              <Button variant="outline" size="sm" disabled={previewBusy}
                onClick={() => fetchPreview({ to: sendTo, subject: sendSubject, message: sendMessage })}
                data-testid="button-update-preview">
                {previewBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Update preview
              </Button>
            </div>
            {previewHtml ? (
              <iframe title="Email preview" srcDoc={previewHtml} sandbox=""
                className="w-full h-96 rounded-md border bg-white" data-testid="iframe-email-preview" />
            ) : (
              <div className="h-96 rounded-md border flex items-center justify-center text-muted-foreground">
                {previewBusy ? "Building preview…" : "No preview yet"}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)}>Cancel</Button>
            <Button
              onClick={() => sendInvoiceMutation.mutate()}
              disabled={sendInvoiceMutation.isPending || !sendTo.trim()}
              data-testid="button-send-invoice-confirm"
            >
              {sendInvoiceMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Send invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
