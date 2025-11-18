import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { Navbar } from "@/components/layout/navbar";
import { ImpersonationBanner } from "@/components/layout/impersonation-banner";
import { StaffProtectedRoute, WholesaleCustomerProtectedRoute } from "@/lib/protected-route";
import AuthPage from "@/pages/auth-page";
import StaffLogin from "@/pages/staff-login";
import WholesaleLogin from "@/pages/wholesale-login";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import WholesaleRegister from "@/pages/wholesale-register";
import WholesaleCustomerDashboard from "@/pages/wholesale-customer-dashboard";
import Shop from "@/pages/shop";
import ShopV2 from "@/pages/shop-v2";
import MySubscriptions from "@/pages/my-subscriptions";
import Subscribe from "@/pages/subscribe";
import ProductSubscribe from "@/pages/product-subscribe";
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
import RetailOrders from "@/pages/retail-orders";
import RetailCustomers from "@/pages/retail-customers";
import RetailPickupReport from "@/pages/retail-pickup-report";
import Inventory from "@/pages/inventory";
import Reports from "@/pages/reports";
import Account from "@/pages/account";
import StaffPortal from "@/pages/staff-portal";
import AdminProducts from "@/pages/admin-products";
import AdminFlavors from "@/pages/admin-flavors";
import AdminRetailProducts from "@/pages/admin-retail-products";
import AdminWholesaleUnits from "@/pages/admin-wholesale-units";
import Contact from "@/pages/contact";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <Route path="/staff/login" component={StaffLogin} />
      <Route path="/wholesale/login" component={WholesaleLogin} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/wholesale/register" component={WholesaleRegister} />
      <WholesaleCustomerProtectedRoute path="/wholesale-customer" component={WholesaleCustomerDashboard} />
      <Route path="/" component={() => <Redirect to="/shop" />} />
      <Route path="/shop" component={Shop} />
      <Route path="/shop-v2" component={ShopV2} />
      <Route path="/contact" component={Contact} />
      <Route path="/subscriptions" component={() => <Redirect to="/my-subscriptions" />} />
      <Route path="/my-subscriptions" component={MySubscriptions} />
      <Route path="/subscribe/:id" component={Subscribe} />
      <Route path="/product-subscribe/:id" component={ProductSubscribe} />
      <Route path="/checkout" component={Checkout} />
      <Route path="/cart-checkout" component={CartCheckout} />
      <Route path="/checkout/success" component={CheckoutSuccess} />
      <Route path="/subscription-success" component={SubscriptionSuccess} />
      
      {/* Legacy wholesale redirects */}
      <Route path="/wholesale" component={() => <Redirect to="/staff-portal/wholesale/orders" />} />
      <Route path="/wholesale/place-order" component={() => <Redirect to="/staff-portal/wholesale/place-order" />} />
      <Route path="/wholesale/orders" component={() => <Redirect to="/staff-portal/wholesale/orders" />} />
      <Route path="/wholesale/delivery-report" component={() => <Redirect to="/staff-portal/wholesale/delivery-report" />} />
      <Route path="/wholesale/customers" component={() => <Redirect to="/staff-portal/wholesale/customers" />} />
      <Route path="/wholesale/products" component={() => <Redirect to="/staff-portal/wholesale/products" />} />
      
      {/* Consolidated Staff Portal - Wholesale Section */}
      <StaffProtectedRoute path="/staff-portal/wholesale/place-order" component={WholesalePlaceOrder} />
      <StaffProtectedRoute path="/staff-portal/wholesale/orders" component={WholesaleOrders} />
      <StaffProtectedRoute path="/staff-portal/wholesale/delivery-report" component={WholesaleDeliveryReport} />
      <StaffProtectedRoute path="/staff-portal/wholesale/customers" component={WholesaleCustomers} />
      <StaffProtectedRoute path="/staff-portal/wholesale/products" component={WholesaleProducts} />
      
      {/* Invoice pages remain accessible outside main navigation */}
      <StaffProtectedRoute path="/wholesale/invoice/:id/payment-success" component={WholesalePaymentSuccess} />
      <StaffProtectedRoute path="/wholesale/invoice/:id" component={WholesaleInvoice} />
      <StaffProtectedRoute path="/retail/orders" component={RetailOrders} />
      <StaffProtectedRoute path="/retail/customers" component={RetailCustomers} />
      <StaffProtectedRoute path="/retail/pickup-report" component={RetailPickupReport} />
      <StaffProtectedRoute path="/admin/products" component={AdminProducts} />
      <StaffProtectedRoute path="/admin/flavors" component={AdminFlavors} />
      <StaffProtectedRoute path="/admin/retail-products" component={AdminRetailProducts} />
      <StaffProtectedRoute path="/admin/wholesale-units" component={AdminWholesaleUnits} />
      <StaffProtectedRoute path="/inventory" component={Inventory} />
      <StaffProtectedRoute path="/reports" component={Reports} />
      <Route path="/account" component={Account} />
      <StaffProtectedRoute path="/staff-portal" component={StaffPortal} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <ImpersonationBanner />
          <Toaster />
          <Router />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
