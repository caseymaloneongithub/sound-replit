import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Textarea } from "@/components/ui/textarea";

const wholesaleRegisterSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(6, "Password must be at least 6 characters"),
  businessName: z.string().min(2, "Business name is required"),
  contactName: z.string().min(2, "Contact person name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  address: z.string().min(5, "Business address is required"),
  phoneNumber: z.string().min(10, "Phone number must be at least 10 digits"),
  verificationCode: z.string().optional(),
  smsConsent: z.boolean().refine(val => val === true, {
    message: "You must agree to receive text messages to verify your phone number",
  }),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export default function WholesaleRegister() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [codeSent, setCodeSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [registering, setRegistering] = useState(false);

  const form = useForm<z.infer<typeof wholesaleRegisterSchema>>({
    resolver: zodResolver(wholesaleRegisterSchema),
    defaultValues: {
      username: "",
      password: "",
      confirmPassword: "",
      businessName: "",
      contactName: "",
      email: "",
      phone: "",
      address: "",
      phoneNumber: "",
      verificationCode: "",
      smsConsent: false,
    },
  });

  const sendVerificationCode = async () => {
    const phoneNumber = form.getValues("phoneNumber");
    const smsConsent = form.getValues("smsConsent");
    
    if (!phoneNumber || phoneNumber.length < 10) {
      toast({
        title: "Error",
        description: "Please enter a valid phone number",
        variant: "destructive",
      });
      return;
    }

    if (!smsConsent) {
      toast({
        title: "SMS Consent Required",
        description: "You must agree to receive text messages to verify your phone number",
        variant: "destructive",
      });
      return;
    }

    setSendingCode(true);
    try {
      await apiRequest("POST", "/api/send-verification-code", { phoneNumber });
      setCodeSent(true);
      toast({
        title: "Code Sent",
        description: "Verification code sent to your phone",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send verification code",
        variant: "destructive",
      });
    } finally {
      setSendingCode(false);
    }
  };

  const verifyCode = async () => {
    const phoneNumber = form.getValues("phoneNumber");
    const code = form.getValues("verificationCode");

    if (!code || code.length !== 6) {
      toast({
        title: "Error",
        description: "Please enter the 6-digit verification code",
        variant: "destructive",
      });
      return;
    }

    setVerifyingCode(true);
    try {
      await apiRequest("POST", "/api/verify-code", { phoneNumber, code });
      setPhoneVerified(true);
      toast({
        title: "Success",
        description: "Phone number verified!",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Invalid verification code",
        variant: "destructive",
      });
    } finally {
      setVerifyingCode(false);
    }
  };

  const onSubmit = async (values: z.infer<typeof wholesaleRegisterSchema>) => {
    if (!phoneVerified) {
      toast({
        title: "Error",
        description: "Please verify your phone number first",
        variant: "destructive",
      });
      return;
    }

    setRegistering(true);
    try {
      await apiRequest("POST", "/api/register-wholesale", {
        username: values.username,
        password: values.password,
        phoneNumber: values.phoneNumber,
        businessName: values.businessName,
        contactName: values.contactName,
        email: values.email,
        phone: values.phone,
        address: values.address,
      });

      toast({
        title: "Success",
        description: "Wholesale account created! You can now login.",
      });
      
      setLocation("/auth");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Registration failed",
        variant: "destructive",
      });
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <Card className="w-full max-w-2xl" data-testid="card-wholesale-register">
        <CardHeader>
          <CardTitle className="text-3xl" data-testid="text-wholesale-register-title">
            Wholesale Account Registration
          </CardTitle>
          <CardDescription data-testid="text-wholesale-register-description">
            Register your business for wholesale pricing and bulk ordering
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="businessName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Business Name *</FormLabel>
                      <FormControl>
                        <Input
                         
                          data-testid="input-business-name"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="contactName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Person *</FormLabel>
                      <FormControl>
                        <Input
                         
                          data-testid="input-contact-name"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email *</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                         
                          data-testid="input-email"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Business Phone *</FormLabel>
                      <FormControl>
                        <Input
                         
                          data-testid="input-phone"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Address *</FormLabel>
                    <FormControl>
                      <Textarea
                       
                        data-testid="input-address"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="border-t pt-4">
                <h3 className="font-semibold mb-3">Account Credentials</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username *</FormLabel>
                        <FormControl>
                          <Input
                           
                            data-testid="input-username"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="phoneNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number (for login) *</FormLabel>
                        <FormControl>
                          <Input
                           
                            data-testid="input-phone-number"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2 mt-4">
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password *</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                           
                            data-testid="input-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm Password *</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                           
                            data-testid="input-confirm-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="font-semibold mb-3">Phone Verification</h3>
                <div className="space-y-3">
                  <FormField
                    control={form.control}
                    name="smsConsent"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="checkbox-wholesale-sms-consent"
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>
                            I agree to receive text messages for verification purposes
                          </FormLabel>
                          <p className="text-xs text-muted-foreground">
                            By checking this box, you consent to receive SMS verification codes from Puget Sound Kombucha Co. 
                            Message frequency varies. Message & data rates may apply. Text STOP to unsubscribe, HELP for help. 
                            Consent is not a condition of purchase.
                          </p>
                          <FormMessage />
                        </div>
                      </FormItem>
                    )}
                  />
                  {!codeSent && (
                    <Button
                      type="button"
                      onClick={sendVerificationCode}
                      disabled={sendingCode}
                      variant="outline"
                      className="w-full"
                      data-testid="button-send-code"
                    >
                      {sendingCode ? "Sending..." : "Send Verification Code"}
                    </Button>
                  )}

                  {codeSent && !phoneVerified && (
                    <div className="space-y-2">
                      <FormField
                        control={form.control}
                        name="verificationCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Verification Code</FormLabel>
                            <FormControl>
                              <Input
                               
                                maxLength={6}
                                data-testid="input-verification-code"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="button"
                        onClick={verifyCode}
                        disabled={verifyingCode}
                        className="w-full"
                        data-testid="button-verify-code"
                      >
                        {verifyingCode ? "Verifying..." : "Verify Code"}
                      </Button>
                    </div>
                  )}

                  {phoneVerified && (
                    <div className="text-sm text-green-600 dark:text-green-400 font-medium" data-testid="text-phone-verified">
                      ✓ Phone number verified
                    </div>
                  )}
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={!phoneVerified || registering}
                data-testid="button-register"
              >
                {registering ? "Creating Account..." : "Create Wholesale Account"}
              </Button>

              <div className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setLocation("/auth")}
                  className="p-0 h-auto text-primary hover:underline"
                  data-testid="button-go-to-login"
                >
                  Login here
                </button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
