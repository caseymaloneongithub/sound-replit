import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Printer, ArrowLeft, CreditCard, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCaseQuantity } from "@shared/pricing";

export default function WholesaleInvoice() {
  const [, params] = useRoute("/wholesale/invoice/:id");
  const [, setLocation] = useLocation();
  const orderId = params?.id;
  const { toast } = useToast();

  const { data: invoiceData, isLoading } = useQuery<{
    order: any;
    customer: any;
    items: any[];
  }>({
    queryKey: ["/api/wholesale/orders", orderId, "invoice"],
    enabled: !!orderId,
  });

  const paymentMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/wholesale/orders/${orderId}/create-payment`, {});
      return await response.json();
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

  return (
    <div className="min-h-screen bg-background">
      <div className="print:hidden sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center gap-4 px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/wholesale/orders")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">Invoice {order.invoiceNumber}</h1>
          <div className="ml-auto flex items-center gap-2">
            {customer.allowOnlinePayment && (
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
                    <CreditCard className="mr-2 h-4 w-4" />
                    Pay Now
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
        <Card className="print:shadow-none print:border-0">
          <CardContent className="p-8 print:p-0">
            <div className="mb-8">
              <h1 className="text-3xl font-bold mb-2">INVOICE</h1>
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
            </div>

            <div className={`grid ${order.location ? 'grid-cols-3' : 'grid-cols-2'} gap-8 mb-8`}>
              <div>
                <h2 className="font-semibold text-sm text-muted-foreground mb-2">FROM</h2>
                <div>
                  <div className="font-semibold">Puget Sound Kombucha Co.</div>
                  <div className="text-sm text-muted-foreground">4501 Shilshole Ave NW</div>
                  <div className="text-sm text-muted-foreground">Seattle, WA 98107</div>
                  <div className="text-sm text-muted-foreground">emily@soundkombucha.com</div>
                  <div className="text-sm text-muted-foreground">(206) 789-5219</div>
                </div>
              </div>

              <div>
                <h2 className="font-semibold text-sm text-muted-foreground mb-2">BILL TO</h2>
                <div data-testid="customer-info">
                  <div className="font-semibold">{customer.businessName}</div>
                  <div className="text-sm text-muted-foreground">{customer.contactName}</div>
                  <div className="text-sm text-muted-foreground">{customer.address}</div>
                  <div className="text-sm text-muted-foreground">{customer.email}</div>
                  <div className="text-sm text-muted-foreground">{customer.phone}</div>
                </div>
              </div>

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
                    <th className="text-right py-3 font-semibold">Cases</th>
                    <th className="text-right py-3 font-semibold">Price/Case</th>
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
                      <td className="text-right py-4">
                        <div>{formatCaseQuantity(item.quantity)}</div>
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
              <div className="w-64 space-y-2">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal:</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
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
              <p className="mt-2">Questions? Contact us at emily@soundkombucha.com or (206) 789-5219</p>
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
          
          /* Page setup */
          @page {
            size: letter;
            margin: 0.5in;
          }
          
          /* Prevent page breaks inside elements */
          tr, .grid > div {
            page-break-inside: avoid !important;
          }
        }
      `}</style>
    </div>
  );
}
