import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Users, Share2, Cookie, Bell, UserX, Mail, FileText } from "lucide-react";
import { Link } from "wouter";
import logo from "@assets/text-stacked-black_1762299663824.png";

export default function PrivacyPolicy() {
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
          <h1 className="text-3xl font-bold mb-4" data-testid="text-privacy-title">Privacy Policy</h1>
          <p className="text-muted-foreground">
            Last updated: December 2024
          </p>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Introduction
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>
                Puget Sound Kombucha Co. ("we," "us," or "our") is committed to protecting your privacy. 
                This Privacy Policy explains how we collect, use, disclose, and safeguard your information 
                when you visit our website, make purchases, or use our services. Please read this policy 
                carefully to understand our practices regarding your personal data.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                Information We Collect
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p><strong>Personal Information:</strong></p>
              <ul className="space-y-2">
                <li><strong>Contact Information:</strong> Name, email address, phone number, and mailing address.</li>
                <li><strong>Account Information:</strong> Username, password (securely hashed), and account preferences.</li>
                <li><strong>Payment Information:</strong> Processed securely by Stripe; we only store the last 4 digits of your card for reference.</li>
                <li><strong>Order Information:</strong> Purchase history, subscription preferences, and delivery details.</li>
              </ul>
              <p className="mt-4"><strong>Automatically Collected Information:</strong></p>
              <ul className="space-y-2">
                <li>IP address and browser type</li>
                <li>Device information and operating system</li>
                <li>Pages visited and time spent on our site</li>
                <li>Referring website addresses</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                How We Use Your Information
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>We use the information we collect to:</p>
              <ul className="space-y-2">
                <li>Process and fulfill your orders and subscriptions</li>
                <li>Send order confirmations, shipping updates, and delivery notifications</li>
                <li>Manage your account and provide customer support</li>
                <li>Send subscription reminders and billing notifications</li>
                <li>Improve our website, products, and services</li>
                <li>Communicate about promotions, new products, or company updates (with your consent)</li>
                <li>Comply with legal obligations and prevent fraud</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Share2 className="w-5 h-5 text-primary" />
                Information Sharing
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>We do not sell, trade, or rent your personal information. We may share your information with:</p>
              <ul className="space-y-2">
                <li><strong>Service Providers:</strong> Third parties who assist with payment processing (Stripe), email services, and website hosting.</li>
                <li><strong>Legal Requirements:</strong> When required by law, court order, or to protect our rights and safety.</li>
                <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets.</li>
              </ul>
              <p className="mt-4">
                All third-party service providers are contractually obligated to protect your information 
                and use it only for the purposes we specify.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cookie className="w-5 h-5 text-primary" />
                Cookies and Tracking
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>We use cookies and similar technologies to:</p>
              <ul className="space-y-2">
                <li>Remember your preferences and login status</li>
                <li>Maintain your shopping cart during your session</li>
                <li>Analyze website traffic and usage patterns</li>
                <li>Improve website functionality and user experience</li>
              </ul>
              <p className="mt-4">
                You can control cookies through your browser settings. However, disabling cookies may 
                affect certain features of our website.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserX className="w-5 h-5 text-primary" />
                Your Rights and Choices
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>You have the right to:</p>
              <ul className="space-y-2">
                <li><strong>Access:</strong> Request a copy of your personal data we hold.</li>
                <li><strong>Correct:</strong> Update or correct inaccurate information in your account.</li>
                <li><strong>Delete:</strong> Request deletion of your personal data (subject to legal retention requirements).</li>
                <li><strong>Opt-out:</strong> Unsubscribe from marketing emails at any time.</li>
                <li><strong>Data Portability:</strong> Request your data in a machine-readable format.</li>
              </ul>
              <p className="mt-4">
                To exercise any of these rights, please contact us at emily@soundkombucha.com.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-primary" />
                Data Retention
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>
                We retain your personal information for as long as necessary to fulfill the purposes 
                outlined in this policy, unless a longer retention period is required by law. This includes:
              </p>
              <ul className="space-y-2">
                <li>Active account data: Retained while your account is active</li>
                <li>Order history: Retained for 7 years for tax and legal purposes</li>
                <li>Marketing preferences: Until you opt-out or request deletion</li>
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
                If you have any questions about this Privacy Policy or our data practices, please contact us:
              </p>
              <ul className="space-y-2 mt-4">
                <li><strong>Email:</strong> emily@soundkombucha.com</li>
                <li><strong>Phone:</strong> 206-789-5219</li>
                <li><strong>Address:</strong> 4501 Shilshole Ave NW, Seattle, WA 98107</li>
              </ul>
              <p className="mt-4">
                We will respond to all privacy-related inquiries within 30 days.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert pt-6">
              <p className="text-center text-muted-foreground">
                This Privacy Policy may be updated periodically. We will notify you of any material 
                changes by posting the new policy on this page with an updated revision date.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mt-12 text-center">
          <Link href="/shop">
            <span className="text-primary hover:underline cursor-pointer" data-testid="link-back-to-shop">
              ← Back to Shop
            </span>
          </Link>
          <span className="mx-4 text-muted-foreground">|</span>
          <Link href="/security">
            <span className="text-primary hover:underline cursor-pointer" data-testid="link-security-from-privacy">
              Information Security Policy
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
