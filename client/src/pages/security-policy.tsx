import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Lock, Eye, Server, Mail, FileCheck, Clock } from "lucide-react";
import { Link } from "wouter";
import logo from "@assets/text-stacked-black_1762299663824.png";

export default function SecurityPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <Link href="/shop">
            <img 
              src={logo} 
              alt="Puget Sound Kombucha Co." 
              className="h-16 w-auto mx-auto mb-6 dark:invert cursor-pointer"
            />
          </Link>
          <h1 className="text-3xl font-bold mb-4" data-testid="text-security-title">Information Security Policy</h1>
          <p className="text-muted-foreground">
            Last updated: December 2024
          </p>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Our Commitment to Security
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>
                At Puget Sound Kombucha Co., we take the security and privacy of your information seriously. 
                This policy outlines how we protect your data and the measures we take to ensure your 
                information remains secure when you shop with us or use our services.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-primary" />
                Payment Security
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <ul className="space-y-2">
                <li>All payment transactions are processed through <strong>Stripe</strong>, a PCI-DSS Level 1 certified payment processor.</li>
                <li>We never store your complete credit card information on our servers.</li>
                <li>All payment data is encrypted using industry-standard TLS/SSL encryption.</li>
                <li>Stripe tokenizes your payment information, meaning your sensitive card details never touch our systems.</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5 text-primary" />
                Data Storage & Protection
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <ul className="space-y-2">
                <li>Customer data is stored in secure, encrypted databases hosted on enterprise-grade cloud infrastructure.</li>
                <li>We use PostgreSQL databases with encryption at rest and in transit.</li>
                <li>Regular automated backups ensure data integrity and disaster recovery capabilities.</li>
                <li>Access to customer data is restricted to authorized personnel only.</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-primary" />
                Data We Collect
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>We collect only the information necessary to fulfill your orders and provide our services:</p>
              <ul className="space-y-2 mt-4">
                <li><strong>Account Information:</strong> Name, email address, phone number, and password (securely hashed).</li>
                <li><strong>Order Information:</strong> Delivery/pickup addresses, order history, and subscription preferences.</li>
                <li><strong>Payment Information:</strong> Processed and stored securely by Stripe; we only retain the last 4 digits for reference.</li>
                <li><strong>Communication Records:</strong> Emails and inquiries you send to us.</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-primary" />
                How We Use Your Data
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <ul className="space-y-2">
                <li>Processing and fulfilling your orders and subscriptions.</li>
                <li>Sending order confirmations, shipping updates, and subscription reminders.</li>
                <li>Providing customer support and responding to inquiries.</li>
                <li>Improving our products and services based on aggregated, anonymized data.</li>
              </ul>
              <p className="mt-4 font-medium">
                We do NOT sell, rent, or share your personal information with third parties for marketing purposes.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Data Retention
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <ul className="space-y-2">
                <li>Account information is retained while your account is active.</li>
                <li>Order history is retained for 7 years for tax and legal compliance purposes.</li>
                <li>You may request deletion of your account and personal data at any time by contacting us.</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-primary" />
                Contact Us
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>
                If you have any questions about our security practices or wish to exercise your data rights, 
                please contact us:
              </p>
              <div className="mt-4 space-y-2 not-prose">
                <p><strong>Email:</strong> <a href="mailto:emily@soundkombucha.com" className="text-primary hover:underline">emily@soundkombucha.com</a></p>
                <p><strong>Phone:</strong> <a href="tel:+12067895219" className="text-primary hover:underline">206-789-5219</a></p>
                <p><strong>Address:</strong> 4501 Shilshole Ave NW, Seattle, WA 98107</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-12 text-center">
          <Link href="/shop">
            <span className="text-primary hover:underline cursor-pointer" data-testid="link-back-to-shop">
              ← Back to Shop
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
