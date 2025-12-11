import { Link } from "wouter";
import { Shield, Lock, Database, MapPin, Mail, Phone } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-muted/50 border-t mt-auto">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="font-semibold mb-4">Puget Sound Kombucha Co.</h3>
            <p className="text-sm text-muted-foreground">
              Handcrafted kombucha brewed in the heart of Ballard, Seattle. 
              Naturally fermented, locally loved.
            </p>
          </div>
          
          <div>
            <h3 className="font-semibold mb-4">Contact</h3>
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 flex-shrink-0" />
                <span>4501 Shilshole Ave NW, Seattle, WA 98107</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 flex-shrink-0" />
                <a href="mailto:emily@soundkombucha.com" className="hover:text-primary transition-colors">
                  emily@soundkombucha.com
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 flex-shrink-0" />
                <a href="tel:+12067895219" className="hover:text-primary transition-colors">
                  206-789-5219
                </a>
              </div>
            </div>
          </div>
          
          <div>
            <h3 className="font-semibold mb-4">Legal</h3>
            <div className="space-y-2 text-sm">
              <Link href="/privacy">
                <span className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors cursor-pointer" data-testid="link-privacy-policy">
                  <Lock className="w-4 h-4" />
                  Privacy Policy
                </span>
              </Link>
              <Link href="/security">
                <span className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors cursor-pointer" data-testid="link-security-policy">
                  <Shield className="w-4 h-4" />
                  Information Security
                </span>
              </Link>
              <Link href="/data-retention">
                <span className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors cursor-pointer" data-testid="link-data-retention-policy">
                  <Database className="w-4 h-4" />
                  Data Retention
                </span>
              </Link>
            </div>
          </div>
        </div>
        
        <div className="mt-8 pt-8 border-t text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} Puget Sound Kombucha Co. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
