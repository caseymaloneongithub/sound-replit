import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WholesaleOrder, WholesaleCustomer, User } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FileText, Eye, Check, Mail, CalendarIcon, Loader2, DollarSign, Clock, AlertCircle } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, addDays, differenceInDays, isPast } from "date-fns";
import { Link } from "wouter";

type WholesaleOrderWithPayment = WholesaleOrder & {
  dueDate?: string | null;
  paidAt?: string | null;
  invoiceSentAt?: string | null;
};

export default function WholesaleInvoices() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("unpaid");
  const [markPaidDialogOpen, setMarkPaidDialogOpen] = useState(false);
  const [sendInvoiceDialogOpen, setSendInvoiceDialogOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const { data: orders = [], isLoading: ordersLoading } = useQuery<WholesaleOrderWithPayment[]>({
    queryKey: ["/api/wholesale/orders"],
  });

  const { data: customers = [] } = useQuery<WholesaleCustomer[]>({
    queryKey: ["/api/wholesale/customers"],
  });

  const getCustomerName = (customerId: string) => {
    const customer = customers.find(c => c.id === customerId);
    return customer?.businessName || "Unknown Customer";
  };

  const getCustomer = (customerId: string) => {
    return customers.find(c => c.id === customerId);
  };

  // Filter invoices by payment status
  const unpaidInvoices = orders.filter(o => !o.paidAt);
  const paidInvoices = orders.filter(o => o.paidAt);
  const overdueInvoices = unpaidInvoices.filter(o => {
    if (!o.dueDate) return false;
    return isPast(new Date(o.dueDate));
  });

  const markPaidMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return await apiRequest("POST", `/api/wholesale/orders/${orderId}/mark-paid`, {});
    },
    onSuccess: () => {
      toast({
        title: "Invoice Marked as Paid",
        description: "The invoice has been marked as paid successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/orders"] });
      setMarkPaidDialogOpen(false);
      setSelectedOrderId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to mark invoice as paid",
        variant: "destructive",
      });
    },
  });

  const sendInvoiceMutation = useMutation({
    mutationFn: async ({ orderId, dueDateValue }: { orderId: string; dueDateValue: Date }) => {
      return await apiRequest("POST", `/api/wholesale/orders/${orderId}/send-invoice`, {
        dueDate: dueDateValue.toISOString(),
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Invoice Sent",
        description: data.message || "Invoice email sent successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/orders"] });
      setSendInvoiceDialogOpen(false);
      setSelectedOrderId(null);
      setDueDate(undefined);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send invoice",
        variant: "destructive",
      });
    },
  });

  const handleMarkPaid = (orderId: string) => {
    setSelectedOrderId(orderId);
    setMarkPaidDialogOpen(true);
  };

  const handleSendInvoice = (orderId: string) => {
    setSelectedOrderId(orderId);
    // Default due date is 30 days from today
    setDueDate(addDays(new Date(), 30));
    setSendInvoiceDialogOpen(true);
  };

  const confirmMarkPaid = () => {
    if (selectedOrderId) {
      markPaidMutation.mutate(selectedOrderId);
    }
  };

  const confirmSendInvoice = () => {
    if (selectedOrderId && dueDate) {
      sendInvoiceMutation.mutate({ orderId: selectedOrderId, dueDateValue: dueDate });
    }
  };

  const getPaymentStatus = (order: WholesaleOrderWithPayment) => {
    if (order.paidAt) {
      return { label: "Paid", variant: "default" as const, icon: Check };
    }
    if (order.dueDate && isPast(new Date(order.dueDate))) {
      const daysOverdue = differenceInDays(new Date(), new Date(order.dueDate));
      return { label: `${daysOverdue} days overdue`, variant: "destructive" as const, icon: AlertCircle };
    }
    if (order.dueDate) {
      const daysUntilDue = differenceInDays(new Date(order.dueDate), new Date());
      return { label: `Due in ${daysUntilDue} days`, variant: "secondary" as const, icon: Clock };
    }
    return { label: "Pending", variant: "outline" as const, icon: Clock };
  };

  const renderInvoiceRow = (order: WholesaleOrderWithPayment) => {
    const paymentStatus = getPaymentStatus(order);
    const StatusIcon = paymentStatus.icon;
    const customer = getCustomer(order.customerId);

    return (
      <TableRow key={order.id} data-testid={`row-invoice-${order.id}`}>
        <TableCell className="font-medium">
          <Link href={`/wholesale/invoice/${order.id}`}>
            <span className="text-primary hover:underline cursor-pointer" data-testid={`link-invoice-${order.id}`}>
              {order.invoiceNumber}
            </span>
          </Link>
        </TableCell>
        <TableCell>{getCustomerName(order.customerId)}</TableCell>
        <TableCell>{format(new Date(order.orderDate), "MMM dd, yyyy")}</TableCell>
        <TableCell>
          {order.dueDate ? format(new Date(order.dueDate), "MMM dd, yyyy") : "Not set"}
        </TableCell>
        <TableCell className="text-right font-semibold">
          ${Number(order.totalAmount).toFixed(2)}
        </TableCell>
        <TableCell>
          <Badge variant={paymentStatus.variant} className="gap-1">
            <StatusIcon className="h-3 w-3" />
            {paymentStatus.label}
          </Badge>
        </TableCell>
        <TableCell>
          {order.invoiceSentAt ? (
            <span className="text-xs text-muted-foreground">
              Sent {format(new Date(order.invoiceSentAt), "MMM dd")}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Not sent</span>
          )}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <Link href={`/wholesale/invoice/${order.id}`}>
              <Button variant="ghost" size="icon" data-testid={`button-view-invoice-${order.id}`}>
                <Eye className="h-4 w-4" />
              </Button>
            </Link>
            {isAdmin && !order.paidAt && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleSendInvoice(order.id)}
                  data-testid={`button-send-invoice-${order.id}`}
                >
                  <Mail className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleMarkPaid(order.id)}
                  data-testid={`button-mark-paid-${order.id}`}
                >
                  <DollarSign className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  if (!isAdmin) {
    return (
      <StaffLayout>
        <div className="max-w-7xl mx-auto px-6 py-12">
          <Card>
            <CardContent className="py-12 text-center">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">You don't have permission to view invoices.</p>
            </CardContent>
          </Card>
        </div>
      </StaffLayout>
    );
  }

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
            Invoice Management
          </h1>
          <p className="text-muted-foreground">
            Track and manage wholesale invoice payments
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Unpaid</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${unpaidInvoices.reduce((sum, o) => sum + Number(o.totalAmount), 0).toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">{unpaidInvoices.length} invoices</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Overdue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">
                ${overdueInvoices.reduce((sum, o) => sum + Number(o.totalAmount), 0).toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">{overdueInvoices.length} invoices</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Paid This Month</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                ${paidInvoices
                  .filter(o => {
                    const paidDate = new Date(o.paidAt!);
                    const now = new Date();
                    return paidDate.getMonth() === now.getMonth() && paidDate.getFullYear() === now.getFullYear();
                  })
                  .reduce((sum, o) => sum + Number(o.totalAmount), 0).toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">
                {paidInvoices.filter(o => {
                  const paidDate = new Date(o.paidAt!);
                  const now = new Date();
                  return paidDate.getMonth() === now.getMonth() && paidDate.getFullYear() === now.getFullYear();
                }).length} invoices
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Paid</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${paidInvoices.reduce((sum, o) => sum + Number(o.totalAmount), 0).toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">{paidInvoices.length} invoices</p>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="unpaid" data-testid="tab-unpaid">
              <Clock className="w-4 h-4 mr-2" />
              Unpaid ({unpaidInvoices.length})
            </TabsTrigger>
            <TabsTrigger value="overdue" data-testid="tab-overdue">
              <AlertCircle className="w-4 h-4 mr-2" />
              Overdue ({overdueInvoices.length})
            </TabsTrigger>
            <TabsTrigger value="paid" data-testid="tab-paid">
              <Check className="w-4 h-4 mr-2" />
              Paid ({paidInvoices.length})
            </TabsTrigger>
            <TabsTrigger value="all" data-testid="tab-all">
              <FileText className="w-4 h-4 mr-2" />
              All ({orders.length})
            </TabsTrigger>
          </TabsList>

          {ordersLoading ? (
            <div className="flex items-center justify-center py-12 gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-muted-foreground">Loading invoices...</span>
            </div>
          ) : (
            <>
              <TabsContent value="unpaid">
                {unpaidInvoices.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Check className="w-12 h-12 mx-auto mb-4 text-green-500" />
                      <p className="text-muted-foreground">All invoices are paid!</p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Order Date</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Sent</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unpaidInvoices.map(renderInvoiceRow)}
                      </TableBody>
                    </Table>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="overdue">
                {overdueInvoices.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Check className="w-12 h-12 mx-auto mb-4 text-green-500" />
                      <p className="text-muted-foreground">No overdue invoices!</p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Order Date</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Sent</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {overdueInvoices.map(renderInvoiceRow)}
                      </TableBody>
                    </Table>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="paid">
                {paidInvoices.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                      <p className="text-muted-foreground">No paid invoices yet</p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Order Date</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Sent</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paidInvoices.map(renderInvoiceRow)}
                      </TableBody>
                    </Table>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="all">
                {orders.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                      <p className="text-muted-foreground">No invoices found</p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Order Date</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Sent</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orders.map(renderInvoiceRow)}
                      </TableBody>
                    </Table>
                  </Card>
                )}
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>

      {/* Mark as Paid Dialog */}
      <Dialog open={markPaidDialogOpen} onOpenChange={setMarkPaidDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Invoice as Paid</DialogTitle>
            <DialogDescription>
              Are you sure you want to mark this invoice as paid? This action records the current date as the payment date.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={confirmMarkPaid} 
              disabled={markPaidMutation.isPending}
              data-testid="button-confirm-mark-paid"
            >
              {markPaidMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Marking...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Mark as Paid
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Invoice Dialog with Due Date */}
      <Dialog open={sendInvoiceDialogOpen} onOpenChange={setSendInvoiceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Invoice</DialogTitle>
            <DialogDescription>
              Set the payment due date and send the invoice email to the customer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Payment Due Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                    data-testid="button-select-due-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dueDate ? format(dueDate, "PPP") : "Select due date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dueDate}
                    onSelect={setDueDate}
                    disabled={(date) => date < new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                Default is 30 days from today. You can adjust as needed.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendInvoiceDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={confirmSendInvoice} 
              disabled={sendInvoiceMutation.isPending || !dueDate}
              data-testid="button-confirm-send-invoice"
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
