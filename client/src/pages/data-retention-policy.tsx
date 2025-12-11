import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Clock, Trash2, Archive, Shield, FileText, Mail } from "lucide-react";
import { Link } from "wouter";
import logo from "@assets/text-stacked-black_1762299663824.png";

export default function DataRetentionPolicy() {
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
          <h1 className="text-3xl font-bold mb-4" data-testid="text-data-retention-title">Data Retention and Disposal Policy</h1>
          <p className="text-muted-foreground">
            Last updated: December 2024
          </p>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5 text-primary" />
                Purpose and Scope
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>
                This Data Retention and Disposal Policy outlines how Puget Sound Kombucha Co. manages the 
                lifecycle of customer and business data. We are committed to retaining data only as long 
                as necessary for legitimate business purposes and legal compliance, and to disposing of 
                data securely when it is no longer needed.
              </p>
              <p className="mt-4">
                This policy applies to all personal data collected through our website, e-commerce platform, 
                and business operations, including customer accounts, orders, subscriptions, and communications.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Data Retention Periods
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>We retain different types of data for varying periods based on business necessity and legal requirements:</p>
              
              <div className="mt-4 space-y-4">
                <div className="border-l-2 border-primary pl-4">
                  <h4 className="font-semibold">Customer Account Information</h4>
                  <p className="text-sm text-muted-foreground">Name, email, phone, password (hashed)</p>
                  <p className="text-sm"><strong>Retention:</strong> Duration of account activity plus 3 years after last activity or account deletion request</p>
                </div>
                
                <div className="border-l-2 border-primary pl-4">
                  <h4 className="font-semibold">Order and Transaction Records</h4>
                  <p className="text-sm text-muted-foreground">Purchase history, payment records, invoices</p>
                  <p className="text-sm"><strong>Retention:</strong> 7 years from transaction date (tax and legal compliance)</p>
                </div>
                
                <div className="border-l-2 border-primary pl-4">
                  <h4 className="font-semibold">Subscription Information</h4>
                  <p className="text-sm text-muted-foreground">Subscription preferences, billing history, frequency settings</p>
                  <p className="text-sm"><strong>Retention:</strong> Duration of active subscription plus 3 years after cancellation</p>
                </div>
                
                <div className="border-l-2 border-primary pl-4">
                  <h4 className="font-semibold">Communication Records</h4>
                  <p className="text-sm text-muted-foreground">Customer support emails, inquiries, feedback</p>
                  <p className="text-sm"><strong>Retention:</strong> 3 years from date of communication</p>
                </div>
                
                <div className="border-l-2 border-primary pl-4">
                  <h4 className="font-semibold">Marketing Preferences</h4>
                  <p className="text-sm text-muted-foreground">Email opt-in status, communication preferences</p>
                  <p className="text-sm"><strong>Retention:</strong> Until opt-out or account deletion, plus 1 year for compliance records</p>
                </div>
                
                <div className="border-l-2 border-primary pl-4">
                  <h4 className="font-semibold">Website Analytics and Logs</h4>
                  <p className="text-sm text-muted-foreground">IP addresses, browser data, session information</p>
                  <p className="text-sm"><strong>Retention:</strong> 90 days for security logs, 2 years for aggregated analytics</p>
                </div>
                
                <div className="border-l-2 border-primary pl-4">
                  <h4 className="font-semibold">Verification Codes</h4>
                  <p className="text-sm text-muted-foreground">Email verification codes, 2FA codes</p>
                  <p className="text-sm"><strong>Retention:</strong> 24 hours after generation or use</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Archive className="w-5 h-5 text-primary" />
                Data Storage and Archival
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <ul className="space-y-2">
                <li><strong>Active Data:</strong> Customer data in active use is stored in secure, encrypted production databases with regular backups.</li>
                <li><strong>Archived Data:</strong> Data past its active use period but within retention requirements may be moved to secure archival storage with restricted access.</li>
                <li><strong>Backup Retention:</strong> Database backups are retained for 30 days for disaster recovery purposes.</li>
                <li><strong>Geographic Location:</strong> All data is stored within United States data centers operated by our cloud infrastructure providers.</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-primary" />
                Data Disposal Procedures
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>When data reaches the end of its retention period or upon valid deletion request, we follow these disposal procedures:</p>
              <ul className="space-y-2 mt-4">
                <li><strong>Electronic Data:</strong> Permanent deletion from all production systems, databases, and backups using industry-standard secure deletion methods.</li>
                <li><strong>Backup Data:</strong> Data in backups is automatically purged as backup rotation occurs (within 30 days of deletion from production).</li>
                <li><strong>Third-Party Data:</strong> We notify and request deletion from third-party processors (e.g., Stripe) in accordance with their data retention policies.</li>
                <li><strong>Verification:</strong> Deletion requests are logged and verified to ensure complete removal across all systems.</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Legal Holds and Exceptions
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>Data may be retained beyond standard retention periods in the following circumstances:</p>
              <ul className="space-y-2 mt-4">
                <li><strong>Legal Proceedings:</strong> Data relevant to ongoing or anticipated legal matters will be preserved until resolution.</li>
                <li><strong>Regulatory Requirements:</strong> Data required for tax, financial, or regulatory compliance will be retained as mandated by law.</li>
                <li><strong>Fraud Prevention:</strong> Data related to suspected fraud or security incidents may be retained for investigation purposes.</li>
                <li><strong>Contractual Obligations:</strong> Data subject to contractual retention requirements with business partners.</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Your Rights
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert">
              <p>You have the following rights regarding your data:</p>
              <ul className="space-y-2 mt-4">
                <li><strong>Request Deletion:</strong> You may request deletion of your personal data at any time, subject to legal retention requirements.</li>
                <li><strong>Data Export:</strong> You may request a copy of your data in a portable format.</li>
                <li><strong>Account Closure:</strong> Closing your account will initiate data disposal according to this policy.</li>
                <li><strong>Retention Inquiry:</strong> You may inquire about how long your specific data will be retained.</li>
              </ul>
              <p className="mt-4">
                To exercise any of these rights, please contact us at emily@soundkombucha.com. 
                We will respond to all requests within 30 days.
              </p>
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
                If you have questions about this Data Retention and Disposal Policy, please contact us:
              </p>
              <ul className="space-y-2 mt-4">
                <li><strong>Email:</strong> emily@soundkombucha.com</li>
                <li><strong>Phone:</strong> 206-789-5219</li>
                <li><strong>Address:</strong> 4501 Shilshole Ave NW, Seattle, WA 98107</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="prose prose-sm max-w-none dark:prose-invert pt-6">
              <p className="text-center text-muted-foreground">
                This policy is reviewed annually and updated as necessary to reflect changes in our 
                data practices or legal requirements. Material changes will be communicated to affected parties.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mt-12 text-center">
          <Link href="/shop">
            <span className="text-primary hover:underline cursor-pointer" data-testid="link-back-to-shop">
              Back to Shop
            </span>
          </Link>
          <span className="mx-4 text-muted-foreground">|</span>
          <Link href="/privacy">
            <span className="text-primary hover:underline cursor-pointer" data-testid="link-privacy-from-retention">
              Privacy Policy
            </span>
          </Link>
          <span className="mx-4 text-muted-foreground">|</span>
          <Link href="/security">
            <span className="text-primary hover:underline cursor-pointer" data-testid="link-security-from-retention">
              Information Security
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
