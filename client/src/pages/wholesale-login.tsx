import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Building2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

const loginSchema = z.object({
  username: z.string().min(1, "Email or username is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const emailLoginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  verificationCode: z.string().optional(),
});

export default function WholesaleLogin() {
  const { loginMutation } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loginMethod, setLoginMethod] = useState<'password' | 'email'>('password');
  const [emailLoginCodeSent, setEmailLoginCodeSent] = useState(false);
  const [sendingEmailLoginCode, setSendingEmailLoginCode] = useState(false);
  const [verifyingEmailLoginCode, setVerifyingEmailLoginCode] = useState(false);

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

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
      await apiRequest("POST", "/api/send-email-verification-code", { email });
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
      const data = await apiRequest("POST", "/api/verify-email-code", { 
        email, 
        code: verificationCode 
      });
      
      // Check if user is a wholesale customer
      if (data.user.role !== 'wholesale_customer') {
        toast({
          title: "Access Denied",
          description: "This login is for wholesale customers only. Please use the appropriate login page.",
          variant: "destructive",
        });
        return;
      }

      // Update the auth context with the logged-in user
      queryClient.setQueryData(["/api/user"], data.user);
      
      toast({
        title: "Welcome back!",
        description: "You have successfully logged in.",
      });
      setLocation("/wholesale-customer");
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

  const onLogin = async (values: z.infer<typeof loginSchema>) => {
    try {
      const result = await loginMutation.mutateAsync(values);
      
      if (result.role !== 'wholesale_customer') {
        toast({
          title: "Access Denied",
          description: "This login is for wholesale customers only. Please use the appropriate login page.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Welcome back!",
        description: "You have successfully logged in.",
      });
      setLocation("/wholesale-customer");
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error.message || "Invalid credentials",
        variant: "destructive",
      });
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
              Choose your preferred login method
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={loginMethod} onValueChange={(v) => setLoginMethod(v as 'password' | 'email')} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="password" data-testid="tab-wholesale-login-password">Password</TabsTrigger>
                <TabsTrigger value="email" data-testid="tab-wholesale-login-email">Email Code</TabsTrigger>
              </TabsList>

              <TabsContent value="password">
                <Form {...loginForm}>
                  <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
                    <FormField
                      control={loginForm.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email or Username</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Enter your email or username"
                              data-testid="input-wholesale-login-username"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={loginForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="Enter your password"
                              data-testid="input-wholesale-login-password"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={loginMutation.isPending}
                      data-testid="button-wholesale-login-submit"
                    >
                      {loginMutation.isPending ? "Signing in..." : "Sign In"}
                    </Button>
                    <div className="text-center mt-4">
                      <Link href="/forgot-password" className="text-sm text-primary hover:underline" data-testid="link-wholesale-forgot-password">
                        Forgot Password?
                      </Link>
                    </div>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="email">
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
              </TabsContent>
            </Tabs>
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
