import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Building2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

const emailLoginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  verificationCode: z.string().optional(),
});

export default function WholesaleLogin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [emailLoginCodeSent, setEmailLoginCodeSent] = useState(false);
  const [sendingEmailLoginCode, setSendingEmailLoginCode] = useState(false);
  const [verifyingEmailLoginCode, setVerifyingEmailLoginCode] = useState(false);

  const emailLoginForm = useForm<z.infer<typeof emailLoginSchema>>({
    resolver: zodResolver(emailLoginSchema),
    defaultValues: {
      email: "",
      verificationCode: "",
    },
  });

  const sendEmailLoginCode = async () => {
    const email = emailLoginForm.getValues("email");
    
    if (!email) {
      toast({
        title: "Error",
        description: "Please enter your email address",
        variant: "destructive",
      });
      return;
    }

    setSendingEmailLoginCode(true);
    try {
      await apiRequest("POST", "/api/wholesale/send-email-code", { email });
      setEmailLoginCodeSent(true);
      toast({
        title: "Code Sent",
        description: "Verification code sent to your email",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send verification code",
        variant: "destructive",
      });
    } finally {
      setSendingEmailLoginCode(false);
    }
  };

  const onEmailLogin = async (values: z.infer<typeof emailLoginSchema>) => {
    const { email, verificationCode } = values;
    
    if (!verificationCode || verificationCode.length !== 6) {
      toast({
        title: "Error",
        description: "Please enter the 6-digit verification code",
        variant: "destructive",
      });
      return;
    }

    setVerifyingEmailLoginCode(true);
    try {
      const data = await apiRequest("POST", "/api/wholesale/verify-email-code", { 
        email, 
        code: verificationCode 
      });
      
      // Update the auth context with the logged-in user
      queryClient.setQueryData(["/api/user"], data.user);
      
      // Invalidate to ensure all components using useAuth get the update
      await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      
      toast({
        title: "Welcome back!",
        description: "You have successfully logged in.",
      });
      
      // Give React Query a moment to update before redirecting
      setTimeout(() => {
        setLocation("/wholesale-customer");
      }, 100);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Invalid verification code",
        variant: "destructive",
      });
    } finally {
      setVerifyingEmailLoginCode(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Building2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Wholesale Portal</h1>
          <p className="text-muted-foreground">
            Sign in to access your wholesale account
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Wholesale Login</CardTitle>
            <CardDescription>
              Enter your email to receive a verification code
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...emailLoginForm}>
              <form onSubmit={emailLoginForm.handleSubmit(onEmailLogin)} className="space-y-4">
                <FormField
                  control={emailLoginForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="Enter your email"
                            data-testid="input-wholesale-email-login"
                            {...field}
                            disabled={emailLoginCodeSent}
                          />
                        </FormControl>
                        <Button
                          type="button"
                          onClick={sendEmailLoginCode}
                          disabled={sendingEmailLoginCode || emailLoginCodeSent || !field.value}
                          data-testid="button-send-wholesale-email-code"
                        >
                          {sendingEmailLoginCode ? "Sending..." : emailLoginCodeSent ? "Sent" : "Send Code"}
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {emailLoginCodeSent && (
                  <FormField
                    control={emailLoginForm.control}
                    name="verificationCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Verification Code</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Enter 6-digit code"
                            maxLength={6}
                            data-testid="input-wholesale-email-verification-code"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                        <p className="text-xs text-muted-foreground">
                          Check your email for the verification code. It expires in 5 minutes.
                        </p>
                      </FormItem>
                    )}
                  />
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={verifyingEmailLoginCode || !emailLoginCodeSent}
                  data-testid="button-wholesale-email-login-submit"
                >
                  {verifyingEmailLoginCode ? "Verifying..." : "Verify & Login"}
                </Button>

                {emailLoginCodeSent && (
                  <div className="text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEmailLoginCodeSent(false);
                        emailLoginForm.setValue("verificationCode", "");
                      }}
                      data-testid="button-wholesale-resend-email-code"
                    >
                      Resend Code
                    </Button>
                  </div>
                )}
              </form>
            </Form>
          </CardContent>
        </Card>

        <div className="text-center mt-6 space-y-2">
          <p className="text-sm text-muted-foreground">
            Need a wholesale account?{" "}
            <Link href="/wholesale/register" className="text-primary hover:underline" data-testid="link-to-wholesale-register">
              Request access
            </Link>
          </p>
          <p className="text-sm text-muted-foreground">
            Looking for retail shopping?{" "}
            <Link href="/auth" className="text-primary hover:underline" data-testid="link-to-retail-login">
              Go to retail login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
