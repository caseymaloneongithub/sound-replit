import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Menu, User, Shield, Building2, ShoppingBag, UserCircle, ChevronDown, LogOut } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { CartDrawer } from "@/components/cart/cart-drawer";
import logo from "@assets/text-stacked-black_1762299663824.png";

export function Navbar() {
  const [location, setLocation] = useLocation();
  const { user, isLoading, logoutMutation } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
        <Link href="/shop" data-testid="link-home">
          <img 
            src={logo} 
            alt="Puget Sound Kombucha Co." 
            className="h-10 w-auto dark:invert cursor-pointer"
          />
        </Link>

        <div className="flex items-center gap-2">
          {!isLoading && (
            user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" data-testid="button-user-menu">
                    <User className="w-5 h-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" data-testid="menu-user-options">
                  {user.role === 'wholesale_customer' ? (
                    <>
                      <DropdownMenuItem 
                        onClick={() => setLocation('/wholesale-customer')}
                        data-testid="menu-item-orders"
                      >
                        <ShoppingBag className="w-4 h-4 mr-2" />
                        Orders
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={async () => {
                          await logoutMutation.mutateAsync();
                          setLocation('/wholesale/login');
                        }}
                        disabled={logoutMutation.isPending}
                        data-testid="menu-item-logout"
                      >
                        <LogOut className="w-4 h-4 mr-2" />
                        {logoutMutation.isPending ? 'Logging out...' : 'Log Out'}
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem 
                        onClick={() => setLocation('/account')}
                        data-testid="menu-item-profile"
                      >
                        <UserCircle className="w-4 h-4 mr-2" />
                        Profile
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => setLocation('/my-subscriptions')}
                        data-testid="menu-item-my-subscriptions"
                      >
                        <ShoppingBag className="w-4 h-4 mr-2" />
                        My Subscriptions
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => setLocation('/my-orders')}
                        data-testid="menu-item-my-orders"
                      >
                        <ShoppingBag className="w-4 h-4 mr-2" />
                        My Orders
                      </DropdownMenuItem>
                      {(user.isAdmin || user.role === 'staff') && (
                        <DropdownMenuItem 
                          onClick={() => setLocation('/staff-portal')}
                          data-testid="menu-item-staff-portal"
                        >
                          <Shield className="w-4 h-4 mr-2" />
                          Staff Portal
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem 
                        onClick={async () => {
                          await logoutMutation.mutateAsync();
                          setLocation('/auth');
                        }}
                        disabled={logoutMutation.isPending}
                        data-testid="menu-item-logout"
                      >
                        <LogOut className="w-4 h-4 mr-2" />
                        {logoutMutation.isPending ? 'Logging out...' : 'Log Out'}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" data-testid="button-login-dropdown">
                    Log In
                    <ChevronDown className="w-4 h-4 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" data-testid="menu-login-options">
                  <DropdownMenuItem 
                    onClick={() => setLocation('/auth')}
                    data-testid="menu-item-retail-login"
                  >
                    <ShoppingBag className="w-4 h-4 mr-2" />
                    Retail Login
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => setLocation('/wholesale/login')}
                    data-testid="menu-item-wholesale-login"
                  >
                    <Building2 className="w-4 h-4 mr-2" />
                    Wholesale Login
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => setLocation('/staff/login')}
                    data-testid="menu-item-staff-login"
                  >
                    <Shield className="w-4 h-4 mr-2" />
                    Staff Login
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )
          )}
          <CartDrawer />
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" data-testid="button-menu">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px] sm:w-[400px]">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-4 mt-6">
                {user && (
                  <Button 
                    variant={location === '/my-subscriptions' ? 'default' : 'ghost'}
                    onClick={() => {
                      setLocation('/my-subscriptions');
                      setMobileMenuOpen(false);
                    }}
                    data-testid="nav-mobile-my-subscriptions"
                    className="justify-start"
                  >
                    My Subscriptions
                  </Button>
                )}
                {user && (
                  <Button 
                    variant={location === '/my-orders' ? 'default' : 'ghost'}
                    onClick={() => {
                      setLocation('/my-orders');
                      setMobileMenuOpen(false);
                    }}
                    data-testid="nav-mobile-my-orders"
                    className="justify-start"
                  >
                    My Orders
                  </Button>
                )}
                {user && (user.isAdmin || user.role === 'staff') && (
                  <Button 
                    variant={location === '/staff-portal' ? 'default' : 'ghost'}
                    onClick={() => {
                      setLocation('/staff-portal');
                      setMobileMenuOpen(false);
                    }}
                    data-testid="nav-mobile-staff"
                    className="justify-start"
                  >
                    <Shield className="w-4 h-4 mr-2" />
                    Staff Portal
                  </Button>
                )}
                {user && (
                  <Button 
                    variant={location === '/account' ? 'default' : 'ghost'}
                    onClick={() => {
                      setLocation('/account');
                      setMobileMenuOpen(false);
                    }}
                    data-testid="nav-mobile-account"
                    className="justify-start"
                  >
                    <User className="w-4 h-4 mr-2" />
                    Account
                  </Button>
                )}
                {!user && !isLoading && (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setLocation('/auth');
                        setMobileMenuOpen(false);
                      }}
                      data-testid="nav-mobile-retail-login"
                      className="justify-start"
                    >
                      <ShoppingBag className="w-4 h-4 mr-2" />
                      Retail Login
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setLocation('/wholesale/login');
                        setMobileMenuOpen(false);
                      }}
                      data-testid="nav-mobile-wholesale-login"
                      className="justify-start"
                    >
                      <Building2 className="w-4 h-4 mr-2" />
                      Wholesale Login
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setLocation('/staff/login');
                        setMobileMenuOpen(false);
                      }}
                      data-testid="nav-mobile-staff-login"
                      className="justify-start"
                    >
                      <Shield className="w-4 h-4 mr-2" />
                      Staff Login
                    </Button>
                  </>
                )}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
