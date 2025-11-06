import { Button } from "@/components/ui/button";
import { Menu, User, Shield } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { CartDrawer } from "@/components/cart/cart-drawer";
import logo from "@assets/text-stacked-black_1762299663824.png";

export function Navbar() {
  const [location, setLocation] = useLocation();
  const { user, isLoading } = useAuth();
  
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

        <nav className="hidden md:flex items-center gap-1">
          <Button 
            variant={location === '/shop' ? 'default' : 'ghost'}
            onClick={() => setLocation('/shop')}
            data-testid="nav-shop"
          >
            Shop
          </Button>
          <Button 
            variant={location === '/subscriptions' ? 'default' : 'ghost'}
            onClick={() => setLocation('/subscriptions')}
            data-testid="nav-subscriptions"
          >
            Subscriptions
          </Button>
          <Button 
            variant={location.startsWith('/wholesale') ? 'default' : 'ghost'}
            onClick={() => setLocation('/wholesale')}
            data-testid="nav-wholesale"
          >
            Wholesale
          </Button>
          {user && (user.isAdmin || user.role === 'staff') && (
            <Button 
              variant={location === '/staff-portal' ? 'default' : 'ghost'}
              onClick={() => setLocation('/staff-portal')}
              data-testid="nav-staff"
            >
              <Shield className="w-4 h-4 mr-2" />
              Staff Portal
            </Button>
          )}
          {user && user.isAdmin && (
            <Button 
              variant={location === '/admin/products' ? 'default' : 'ghost'}
              onClick={() => setLocation('/admin/products')}
              data-testid="nav-products"
            >
              Products
            </Button>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {!isLoading && (
            user ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation('/account')}
                data-testid="button-account"
              >
                <User className="w-5 h-5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => setLocation('/auth')}
                data-testid="button-login"
              >
                Log In
              </Button>
            )
          )}
          <CartDrawer />
          <Button variant="ghost" size="icon" className="md:hidden" data-testid="button-menu">
            <Menu className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}
