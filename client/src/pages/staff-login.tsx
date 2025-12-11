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
import { Label } from "@/components/ui/label";
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
import { Lock } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

const loginSchema = z.object({
  username: z.string().min(1, "Email or username is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const emailLoginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  verificationCode: z.string().optional(),
});

export default function StaffLogin() {
  const { loginMutation } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loginMethod, setLoginMethod] = useState<'password' | 'email'>('password');
  const [emailLoginCodeSent, setEmailLoginCodeSent] = useState(false);
  const [sendingEmailLoginCode, setSendingEmailLoginCode] = useState(false);
  const [verifyingEmailLoginCode, setVerifyingEmailLoginCode] = useState(false);
  
  // 2FA state for password login
  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFAEmail, setTwoFAEmail] = useState('');
  const [twoFACode, setTwoFACode] = useState('');
  const [verifying2FA, setVerifying2FA] = useState(false);
  const [resending2FA, setResending2FA] = useState(false);

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
      
      // Check if user is staff/admin
      if (!['staff', 'admin', 'super_admin'].includes(data.user.role)) {
        toast({
          title: "Access Denied",
          description: "This login is for staff and administrators only. Please use the retail login page.",
          variant: "destructive",
        });
        return;
      }

      // Update the auth context with the logged-in user
      queryClient.setQueryData(["/api/user"], data.user);
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      
      toast({
        title: "Welcome back!",
        description: "You have successfully logged in.",
      });
      
      // Add small delay to ensure auth state propagates
      setTimeout(() => {
        setLocation("/staff-portal/wholesale/orders");
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

  const onLogin = async (values: z.infer<typeof loginSchema>) => {
    try {
      const response = await apiRequest("POST", "/api/login", values);
      
      // Check if 2FA is required
      if (response.requires2FA) {
        setTwoFAEmail(response.email);
        setRequires2FA(true);
        toast({
          title: "Verification Required",
          description: "A verification code has been sent to your email",
        });
        return;
      }
      
      if (!['staff', 'admin', 'super_admin'].includes(response.role)) {
        toast({
          title: "Access Denied",
          description: "This login is for staff and administrators only. Please use the retail login page.",
          variant: "destructive",
        });
        return;
      }

      // Invalidate queries to ensure auth state updates
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      
      toast({
        title: "Welcome back!",
        description: "You have successfully logged in.",
      });
      
      // Add small delay to ensure auth state propagates
      setTimeout(() => {
        setLocation("/staff-portal/wholesale/orders");
      }, 100);
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error.message || "Invalid credentials",
        variant: "destructive",
      });
    }
  };
  
  const verify2FACode = async () => {
    if (twoFACode.length !== 6) {
      toast({
        title: "Invalid Code",
        description: "Please enter the 6-digit verification code",
        variant: "destructive",
      });
      return;
    }
    
    setVerifying2FA(true);
    try {
      const response = await apiRequest("POST", "/api/verify-2fa", {
        email: twoFAEmail,
        code: twoFACode,
      });
      
      // Check if user is staff/admin
      if (!['staff', 'admin', 'super_admin'].includes(response.user.role)) {
        toast({
          title: "Access Denied",
          description: "This login is for staff and administrators only. Please use the retail login page.",
          variant: "destructive",
        });
        setRequires2FA(false);
        setTwoFAEmail('');
        setTwoFACode('');
        return;
      }
      
      queryClient.setQueryData(["/api/user"], response.user);
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      
      toast({
        title: "Welcome back!",
        description: "You have successfully logged in.",
      });
      
      setTimeout(() => {
        setLocation("/staff-portal/wholesale/orders");
      }, 100);
    } catch (error: any) {
      toast({
        title: "Verification Failed",
        description: error.message || "Invalid or expired code",
        variant: "destructive",
      });
    } finally {
      setVerifying2FA(false);
    }
  };
  
  const resend2FACode = async () => {
    setResending2FA(true);
    try {
      await apiRequest("POST", "/api/resend-2fa", { email: twoFAEmail });
      toast({
        title: "Code Resent",
        description: "A new verification code has been sent to your email",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to resend code",
        variant: "destructive",
      });
    } finally {
      setResending2FA(false);
    }
  };
  
  const cancel2FA = () => {
    setRequires2FA(false);
    setTwoFAEmail('');
    setTwoFACode('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Staff Portal</h1>
          <p className="text-muted-foreground">
            Sign in to access the staff management system
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{requires2FA ? "Verify Your Identity" : "Staff Login"}</CardTitle>
            <CardDescription>
              {requires2FA 
                ? `Enter the 6-digit code sent to ${twoFAEmail}`
                : "Choose your preferred login method"
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {requires2FA ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="staff-2fa-code">Verification Code</Label>
                  <Input
                    id="staff-2fa-code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={twoFACode}
                    onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, ''))}
                    className="text-center text-2xl tracking-widest"
                    data-testid="input-staff-2fa-code"
                  />
                </div>
                <Button
                  onClick={verify2FACode}
                  className="w-full"
                  disabled={verifying2FA || twoFACode.length !== 6}
                  data-testid="button-staff-verify-2fa"
                >
                  {verifying2FA ? "Verifying..." : "Verify & Sign In"}
                </Button>
                <div className="flex items-center justify-between text-sm">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resend2FACode}
                    disabled={resending2FA}
                    data-testid="button-staff-resend-2fa"
                  >
                    {resending2FA ? "Sending..." : "Resend Code"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={cancel2FA}
                    data-testid="button-staff-cancel-2fa"
                  >
                    Back to Login
                  </Button>
                </div>
              </div>
            ) : (
            <Tabs value={loginMethod} onValueChange={(v) => setLoginMethod(v as 'password' | 'email')} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="password" data-testid="tab-staff-login-password">Password</TabsTrigger>
                <TabsTrigger value="email" data-testid="tab-staff-login-email">Email Code</TabsTrigger>
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
                              data-testid="input-staff-login-username"
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
                              data-testid="input-staff-login-password"
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
                      disabled={loginForm.formState.isSubmitting}
                      data-testid="button-staff-login-submit"
                    >
                      {loginForm.formState.isSubmitting ? "Signing in..." : "Sign In"}
                    </Button>
                    <div className="text-center mt-4">
                      <Link href="/forgot-password" className="text-sm text-primary hover:underline" data-testid="link-staff-forgot-password">
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
                                data-testid="input-staff-email-login"
                                {...field}
                                disabled={emailLoginCodeSent}
                              />
                            </FormControl>
                            <Button
                              type="button"
                              onClick={sendEmailLoginCode}
                              disabled={sendingEmailLoginCode || emailLoginCodeSent || !field.value}
                              data-testid="button-send-staff-email-code"
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
                                data-testid="input-staff-email-verification-code"
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
                      data-testid="button-staff-email-login-submit"
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
                          data-testid="button-staff-resend-email-code"
                        >
                          Resend Code
                        </Button>
                      </div>
                    )}
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
            )}
          </CardContent>
        </Card>

        <div className="text-center mt-6">
          <p className="text-sm text-muted-foreground">
            Not a staff member?{" "}
            <Link href="/auth" className="text-primary hover:underline" data-testid="link-to-retail-login">
              Go to retail login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
