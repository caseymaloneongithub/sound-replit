import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
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
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const smsLoginSchema = z.object({
  phoneNumber: z.string().min(10, "Phone number must be at least 10 digits"),
  verificationCode: z.string().optional(),
});

const registerSchema = insertUserSchema.extend({
  password: z.string().min(6, "Password must be at least 6 characters"),
  phoneNumber: z.string().min(10, "Phone number must be at least 10 digits"),
  confirmPassword: z.string().min(6, "Password must be at least 6 characters"),
  verificationCode: z.string().optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export default function AuthPage() {
  const { loginMutation, registerMutation } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [codeSent, setCodeSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [loginMethod, setLoginMethod] = useState<'password' | 'sms'>('password');
  const [smsLoginCodeSent, setSmsLoginCodeSent] = useState(false);
  const [sendingSmsLoginCode, setSendingSmsLoginCode] = useState(false);
  const [verifyingSmsLoginCode, setVerifyingSmsLoginCode] = useState(false);

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const smsLoginForm = useForm<z.infer<typeof smsLoginSchema>>({
    resolver: zodResolver(smsLoginSchema),
    defaultValues: {
      phoneNumber: "",
      verificationCode: "",
    },
  });

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      password: "",
      confirmPassword: "",
      phoneNumber: "",
      email: "",
      firstName: "",
      lastName: "",
      verificationCode: "",
    },
  });

  const sendVerificationCode = async () => {
    const phoneNumber = registerForm.getValues("phoneNumber");
    
    if (!phoneNumber || phoneNumber.length < 10) {
      toast({
        title: "Error",
        description: "Please enter a valid phone number",
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
    const phoneNumber = registerForm.getValues("phoneNumber");
    const code = registerForm.getValues("verificationCode");
    
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
        description: "Phone number verified successfully",
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

  const sendSmsLoginCode = async () => {
    const phoneNumber = smsLoginForm.getValues("phoneNumber");
    
    if (!phoneNumber || phoneNumber.length < 10) {
      toast({
        title: "Error",
        description: "Please enter a valid phone number",
        variant: "destructive",
      });
      return;
    }

    setSendingSmsLoginCode(true);
    try {
      await apiRequest("POST", "/api/login/sms/request", { phoneNumber });
      setSmsLoginCodeSent(true);
      toast({
        title: "Code Sent",
        description: "Login code sent to your phone",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send login code",
        variant: "destructive",
      });
    } finally {
      setSendingSmsLoginCode(false);
    }
  };

  const onSmsLogin = async (values: z.infer<typeof smsLoginSchema>) => {
    const { phoneNumber, verificationCode } = values;
    
    if (!verificationCode || verificationCode.length !== 6) {
      toast({
        title: "Error",
        description: "Please enter the 6-digit verification code",
        variant: "destructive",
      });
      return;
    }

    setVerifyingSmsLoginCode(true);
    try {
      const response = await apiRequest("POST", "/api/login/sms/verify", { 
        phoneNumber, 
        code: verificationCode 
      });
      
      // Parse the user object from the response
      const user = await response.json();
      
      // Update the auth context with the logged-in user
      queryClient.setQueryData(["/api/user"], user);
      
      toast({
        title: "Success",
        description: "Logged in successfully",
      });
      setLocation("/");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Invalid verification code",
        variant: "destructive",
      });
    } finally {
      setVerifyingSmsLoginCode(false);
    }
  };

  const onLogin = async (values: z.infer<typeof loginSchema>) => {
    await loginMutation.mutateAsync(values);
    setLocation("/");
  };

  const onRegister = async (values: z.infer<typeof registerSchema>) => {
    if (!phoneVerified) {
      toast({
        title: "Error",
        description: "Please verify your phone number first",
        variant: "destructive",
      });
      return;
    }
    
    const { confirmPassword, verificationCode, ...userData } = values;
    await registerMutation.mutateAsync(userData);
    setLocation("/");
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-width-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Puget Sound Kombucha Co.</h1>
          <p className="text-muted-foreground">Artisanal craft kombucha from the Pacific Northwest</p>
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
                <Tabs value={loginMethod} onValueChange={(v) => setLoginMethod(v as 'password' | 'sms')} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="password" data-testid="tab-login-password">Password</TabsTrigger>
                    <TabsTrigger value="sms" data-testid="tab-login-sms">SMS Code</TabsTrigger>
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
                                  placeholder="Enter your password"
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
                      </form>
                    </Form>
                  </TabsContent>

                  <TabsContent value="sms">
                    <Form {...smsLoginForm}>
                      <form onSubmit={smsLoginForm.handleSubmit(onSmsLogin)} className="space-y-4">
                        <FormField
                          control={smsLoginForm.control}
                          name="phoneNumber"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Phone Number</FormLabel>
                              <div className="flex gap-2">
                                <FormControl>
                                  <Input
                                    placeholder="+1 (555) 123-4567"
                                    data-testid="input-sms-login-phone"
                                    {...field}
                                    disabled={smsLoginCodeSent}
                                  />
                                </FormControl>
                                <Button
                                  type="button"
                                  onClick={sendSmsLoginCode}
                                  disabled={sendingSmsLoginCode || smsLoginCodeSent || !field.value}
                                  data-testid="button-send-sms-login-code"
                                >
                                  {sendingSmsLoginCode ? "Sending..." : smsLoginCodeSent ? "Sent" : "Send Code"}
                                </Button>
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        {smsLoginCodeSent && (
                          <FormField
                            control={smsLoginForm.control}
                            name="verificationCode"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Verification Code</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="Enter 6-digit code"
                                    data-testid="input-sms-login-code"
                                    maxLength={6}
                                    {...field}
                                    value={field.value ?? ""}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                        <Button
                          type="submit"
                          className="w-full"
                          disabled={verifyingSmsLoginCode || !smsLoginCodeSent}
                          data-testid="button-sms-login-submit"
                        >
                          {verifyingSmsLoginCode ? "Logging in..." : "Login with Code"}
                        </Button>
                        {!smsLoginCodeSent && (
                          <p className="text-sm text-muted-foreground text-center">
                            Enter your phone number and request a code to continue
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
                                placeholder="First name"
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
                                placeholder="Last name"
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
                              placeholder="Enter your email"
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
                              placeholder="Choose a username"
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
                      name="phoneNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone Number (Required)</FormLabel>
                          <div className="flex gap-2">
                            <FormControl>
                              <Input
                                placeholder="+1 (555) 123-4567"
                                data-testid="input-register-phone"
                                {...field}
                                value={field.value ?? ""}
                                disabled={phoneVerified}
                              />
                            </FormControl>
                            <Button
                              type="button"
                              onClick={sendVerificationCode}
                              disabled={sendingCode || phoneVerified || !field.value}
                              data-testid="button-send-code"
                            >
                              {sendingCode ? "Sending..." : phoneVerified ? "Verified" : "Send Code"}
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {codeSent && !phoneVerified && (
                      <FormField
                        control={registerForm.control}
                        name="verificationCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Verification Code</FormLabel>
                            <div className="flex gap-2">
                              <FormControl>
                                <Input
                                  placeholder="Enter 6-digit code"
                                  data-testid="input-verification-code"
                                  maxLength={6}
                                  {...field}
                                  value={field.value ?? ""}
                                />
                              </FormControl>
                              <Button
                                type="button"
                                onClick={verifyCode}
                                disabled={verifyingCode}
                                data-testid="button-verify-code"
                              >
                                {verifyingCode ? "Verifying..." : "Verify"}
                              </Button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    <FormField
                      control={registerForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="Choose a password"
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
                              placeholder="Confirm your password"
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
                      disabled={registerMutation.isPending || !phoneVerified}
                      data-testid="button-register-submit"
                    >
                      {registerMutation.isPending ? "Creating account..." : "Create Account"}
                    </Button>
                    {!phoneVerified && (
                      <p className="text-sm text-muted-foreground text-center">
                        Please verify your phone number to continue
                      </p>
                    )}
                  </form>
                </Form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            Looking for wholesale pricing?{" "}
            <button
              type="button"
              onClick={() => setLocation("/wholesale-register")}
              className="p-0 h-auto font-semibold text-primary hover:underline"
              data-testid="button-wholesale-register-link"
            >
              Register as a Wholesale Customer
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
