import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Redirect, Route } from "wouter";

export function ProtectedRoute({
  path,
  component: Component,
}: {
  path: string;
  component: () => React.JSX.Element;
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
        </div>
      </Route>
    );
  }

  if (!user) {
    return (
      <Route path={path}>
        <Redirect to="/auth" />
      </Route>
    );
  }

  // Guards the retail customer account area (/my-account), which is built around
  // Subscribe & Save. Wholesale accounts don't have subscriptions, so send them to their
  // own portal rather than showing them an empty subscriptions page they can't use.
  // The navbar already hides the link; this covers a direct URL or an old bookmark.
  if (user.role === 'wholesale_customer') {
    return (
      <Route path={path}>
        <Redirect to="/wholesale-customer" />
      </Route>
    );
  }

  return <Route path={path} component={Component} />
}

export function StaffProtectedRoute({
  path,
  component: Component,
}: {
  path: string;
  component: () => React.JSX.Element;
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
        </div>
      </Route>
    );
  }

  if (!user) {
    return (
      <Route path={path}>
        <Redirect to="/staff/login" />
      </Route>
    );
  }

  if (!['staff', 'admin', 'super_admin'].includes(user.role)) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold">Access Denied</h1>
            <p className="text-muted-foreground">You need staff or admin privileges to access this page.</p>
          </div>
        </div>
      </Route>
    );
  }

  return <Route path={path} component={Component} />
}

export function WholesaleCustomerProtectedRoute({
  path,
  component: Component,
}: {
  path: string;
  component: () => React.JSX.Element;
}) {
  const { user, isLoading } = useAuth();
  // A wholesale login that isn't on an account yet (or is still pending) belongs on the
  // claim page, not on pages that assume an account. Pending contacts may use the order
  // page to build the order they'll place once approved.
  const { data: claim, isLoading: claimLoading } = useQuery<{ state: string }>({
    queryKey: ["/api/wholesale/claim/status"],
    enabled: !!user && user.role === "wholesale_customer",
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
        </div>
      </Route>
    );
  }

  if (!user) {
    return (
      <Route path={path}>
        <Redirect to="/wholesale/login" />
      </Route>
    );
  }

  if (user.role === 'wholesale_customer' && claimLoading) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
        </div>
      </Route>
    );
  }
  if (user.role === 'wholesale_customer' && claim && claim.state !== 'linked' && path !== '/wholesale/claim') {
    const pendingMayOrder = claim.state === 'pending' && path === '/wholesale-customer/place-order';
    if (!pendingMayOrder) {
      return (
        <Route path={path}>
          <Redirect to="/wholesale/claim" />
        </Route>
      );
    }
  }

  // Allow wholesale customers and super admins (for testing/viewing purposes)
  if (user.role !== 'wholesale_customer' && user.role !== 'super_admin') {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold">Access Denied</h1>
            <p className="text-muted-foreground">This page is for wholesale customers only.</p>
          </div>
        </div>
      </Route>
    );
  }

  return <Route path={path} component={Component} />
}
