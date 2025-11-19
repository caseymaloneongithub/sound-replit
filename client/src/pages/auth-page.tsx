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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserSchema } from "@shared/schema";
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
import { apiRequest, queryClient } from "@/lib/queryClient";

const loginSchema = z.object({
  username: z.string().min(1, "Email or username is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const emailLoginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  verificationCode: z.string().optional(),
});

const registerSchema = insertUserSchema.extend({
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(6, "Password must be at least 6 characters"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export default function AuthPage() {
  const { loginMutation, registerMutation } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Get redirect URL from query params
  const searchParams = new URLSearchParams(window.location.search);
  const redirectUrl = searchParams.get('redirect') || '/';
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

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      password: "",
      confirmPassword: "",
      email: "",
      firstName: "",
      lastName: "",
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
      
      // Update the auth context with the logged-in user
      queryClient.setQueryData(["/api/user"], data.user);
      
      toast({
        title: "Success",
        description: "Logged in successfully",
      });
      setLocation(redirectUrl);
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
    await loginMutation.mutateAsync(values);
    setLocation(redirectUrl);
  };

  const onRegister = async (values: z.infer<typeof registerSchema>) => {
    const { confirmPassword, ...userData } = values;
    await registerMutation.mutateAsync(userData);
    setLocation(redirectUrl);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-background to-muted/20 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Puget Sound Kombucha Co.</h1>
          <p className="text-muted-foreground">Artisanal craft kombucha from the Pacific Northwest</p>
          <p className="text-sm text-muted-foreground mt-2">Shop • Subscribe • Pickup</p>
          
          <div className="flex items-center justify-center gap-4 mt-6">
            <Link href="/staff/login" className="text-lg text-muted-foreground hover:text-primary hover:underline" data-testid="link-to-staff-login">
              Staff Login
            </Link>
            <span className="text-lg text-muted-foreground">•</span>
            <Link href="/wholesale/login" className="text-lg text-muted-foreground hover:text-primary hover:underline" data-testid="link-to-wholesale-login">
              Wholesale Login
            </Link>
          </div>
        </div>

        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login" data-testid="tab-login">Login</TabsTrigger>
            <TabsTrigger value="register" data-testid="tab-register">Register</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <Card>
              <CardHeader>
                <CardTitle>Login</CardTitle>
                <CardDescription>
                  Choose your preferred login method
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={loginMethod} onValueChange={(v) => setLoginMethod(v as 'password' | 'email')} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="password" data-testid="tab-login-password">Password</TabsTrigger>
                    <TabsTrigger value="email" data-testid="tab-login-email">Email Code</TabsTrigger>
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
                                 
                                  data-testid="input-login-username"
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
                                 
                                  data-testid="input-login-password"
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
                          data-testid="button-login-submit"
                        >
                          {loginMutation.isPending ? "Logging in..." : "Login"}
                        </Button>
                        <div className="text-center mt-4">
                          <Link href="/forgot-password" className="text-sm text-primary hover:underline" data-testid="link-forgot-password">
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
                                    placeholder="your.email@example.com"
                                    data-testid="input-email-login-email"
                                    {...field}
                                    disabled={emailLoginCodeSent}
                                  />
                                </FormControl>
                                <Button
                                  type="button"
                                  onClick={sendEmailLoginCode}
                                  disabled={sendingEmailLoginCode || emailLoginCodeSent || !field.value}
                                  data-testid="button-send-email-login-code"
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
                                    data-testid="input-email-login-code"
                                    maxLength={6}
                                    {...field}
                                    value={field.value ?? ""}
                                  />
                                </FormControl>
                                <p className="text-sm text-muted-foreground">
                                  Check your email for the verification code
                                </p>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                        <Button
                          type="submit"
                          className="w-full"
                          disabled={verifyingEmailLoginCode || !emailLoginCodeSent}
                          data-testid="button-email-login-submit"
                        >
                          {verifyingEmailLoginCode ? "Logging in..." : "Login with Code"}
                        </Button>
                        {!emailLoginCodeSent && (
                          <p className="text-sm text-muted-foreground text-center">
                            Enter your email and request a code to continue
                          </p>
                        )}
                      </form>
                    </Form>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="register">
            <Card>
              <CardHeader>
                <CardTitle>Create Account</CardTitle>
                <CardDescription>
                  Register for a new account to start shopping
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...registerForm}>
                  <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={registerForm.control}
                        name="firstName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>First Name</FormLabel>
                            <FormControl>
                              <Input
                               
                                data-testid="input-register-firstname"
                                {...field}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={registerForm.control}
                        name="lastName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Last Name</FormLabel>
                            <FormControl>
                              <Input
                               
                                data-testid="input-register-lastname"
                                {...field}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={registerForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                             
                              data-testid="input-register-email"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username</FormLabel>
                          <FormControl>
                            <Input
                             
                              data-testid="input-register-username"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                             
                              data-testid="input-register-password"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirm Password</FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                             
                              data-testid="input-register-confirm-password"
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
                      disabled={registerMutation.isPending}
                      data-testid="button-register-submit"
                    >
                      {registerMutation.isPending ? "Creating account..." : "Create Account"}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
