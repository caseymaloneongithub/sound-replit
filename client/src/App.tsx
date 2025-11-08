import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { Navbar } from "@/components/layout/navbar";
import { StaffProtectedRoute, WholesaleCustomerProtectedRoute } from "@/lib/protected-route";
import AuthPage from "@/pages/auth-page";
import WholesaleRegister from "@/pages/wholesale-register";
import WholesaleCustomerDashboard from "@/pages/wholesale-customer-dashboard";
import Shop from "@/pages/shop";
import MySubscriptions from "@/pages/my-subscriptions";
import Subscribe from "@/pages/subscribe";
import Checkout from "@/pages/checkout";
import CartCheckout from "@/pages/cart-checkout";
import CheckoutSuccess from "@/pages/checkout-success";
import SubscriptionSuccess from "@/pages/subscription-success";
import WholesalePlaceOrder from "@/pages/wholesale-place-order";
import WholesaleOrders from "@/pages/wholesale-orders";
import WholesaleDeliveryReport from "@/pages/wholesale-delivery-report";
import WholesaleCustomers from "@/pages/wholesale-customers";
import WholesaleProducts from "@/pages/wholesale-products";
import WholesaleInvoice from "@/pages/wholesale-invoice";
import WholesalePaymentSuccess from "@/pages/wholesale-payment-success";
import Inventory from "@/pages/inventory";
import Reports from "@/pages/reports";
import Account from "@/pages/account";
import StaffPortal from "@/pages/staff-portal";
import AdminProducts from "@/pages/admin-products";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <Route path="/wholesale/register" component={WholesaleRegister} />
      <WholesaleCustomerProtectedRoute path="/wholesale-customer" component={WholesaleCustomerDashboard} />
      <Route path="/" component={() => <Redirect to="/shop" />} />
      <Route path="/shop" component={Shop} />
      <Route path="/my-subscriptions" component={MySubscriptions} />
      <Route path="/subscribe/:id" component={Subscribe} />
      <Route path="/checkout" component={Checkout} />
      <Route path="/cart-checkout" component={CartCheckout} />
      <Route path="/checkout/success" component={CheckoutSuccess} />
      <Route path="/subscription-success" component={SubscriptionSuccess} />
      <Route path="/wholesale" component={() => <Redirect to="/staff-portal" />} />
      <StaffProtectedRoute path="/wholesale/place-order" component={WholesalePlaceOrder} />
      <StaffProtectedRoute path="/wholesale/orders" component={WholesaleOrders} />
      <StaffProtectedRoute path="/wholesale/invoice/:id/payment-success" component={WholesalePaymentSuccess} />
      <StaffProtectedRoute path="/wholesale/invoice/:id" component={WholesaleInvoice} />
      <StaffProtectedRoute path="/wholesale/delivery-report" component={WholesaleDeliveryReport} />
      <StaffProtectedRoute path="/wholesale/customers" component={WholesaleCustomers} />
      <StaffProtectedRoute path="/wholesale/products" component={WholesaleProducts} />
      <StaffProtectedRoute path="/admin/products" component={AdminProducts} />
      <StaffProtectedRoute path="/inventory" component={Inventory} />
      <StaffProtectedRoute path="/reports" component={Reports} />
      <Route path="/account" component={Account} />
      <Route path="/staff-portal" component={StaffPortal} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Router />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
