import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navbar } from "@/components/layout/navbar";
import Shop from "@/pages/shop";
import Subscriptions from "@/pages/subscriptions";
import Checkout from "@/pages/checkout";
import SubscriptionSuccess from "@/pages/subscription-success";
import Wholesale from "@/pages/wholesale";
import WholesaleOrders from "@/pages/wholesale-orders";
import WholesaleCustomers from "@/pages/wholesale-customers";
import WholesaleProducts from "@/pages/wholesale-products";
import Account from "@/pages/account";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/shop" />} />
      <Route path="/shop" component={Shop} />
      <Route path="/subscriptions" component={Subscriptions} />
      <Route path="/checkout" component={Checkout} />
      <Route path="/subscription-success" component={SubscriptionSuccess} />
      <Route path="/wholesale" component={Wholesale} />
      <Route path="/wholesale/orders" component={WholesaleOrders} />
      <Route path="/wholesale/customers" component={WholesaleCustomers} />
      <Route path="/wholesale/products" component={WholesaleProducts} />
      <Route path="/account" component={Account} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
