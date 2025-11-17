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

const smsLoginSchema = z.object({
  phoneNumber: z.string().min(10, "Phone number must be at least 10 digits"),
  verificationCode: z.string().optional(),
  smsConsent: z.boolean().refine(val => val === true, {
    message: "You must agree to receive text messages to use SMS login",
  }),
});

const emailLoginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  verificationCode: z.string().optional(),
});

const registerSchema = insertUserSchema.extend({
  password: z.string().min(6, "Password must be at least 6 characters"),
  phoneNumber: z.string().min(10, "Phone number must be at least 10 digits"),
  confirmPassword: z.string().min(6, "Password must be at least 6 characters"),
  verificationCode: z.string().optional(),
  smsConsent: z.boolean().refine(val => val === true, {
    message: "You must agree to receive text messages to verify your phone number",
  }),
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
  const [loginMethod, setLoginMethod] = useState<'password' | 'sms' | 'email'>('password');
  const [smsLoginCodeSent, setSmsLoginCodeSent] = useState(false);
  const [sendingSmsLoginCode, setSendingSmsLoginCode] = useState(false);
  const [verifyingSmsLoginCode, setVerifyingSmsLoginCode] = useState(false);
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

  const smsLoginForm = useForm<z.infer<typeof smsLoginSchema>>({
    resolver: zodResolver(smsLoginSchema),
    defaultValues: {
      phoneNumber: "",
      verificationCode: "",
      smsConsent: false,
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
      phoneNumber: "",
      email: "",
      firstName: "",
      lastName: "",
      verificationCode: "",
      smsConsent: false,
    },
  });

  const sendVerificationCode = async () => {
    const phoneNumber = registerForm.getValues("phoneNumber");
    const smsConsent = registerForm.getValues("smsConsent");
    
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
    const smsConsent = smsLoginForm.getValues("smsConsent");
    
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
        description: "You must agree to receive text messages to use SMS login",
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
      setLocation("/");
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
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-background to-muted/20 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Puget Sound Kombucha Co.</h1>
          <p className="text-muted-foreground">Artisanal craft kombucha from the Pacific Northwest</p>
          <p className="text-sm text-muted-foreground mt-2">Shop • Subscribe • Pickup</p>
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
                <Tabs value={loginMethod} onValueChange={(v) => setLoginMethod(v as 'password' | 'sms' | 'email')} className="w-full">
                  <TabsList className="grid w-full grid-cols-3 mb-4">
                    <TabsTrigger value="password" data-testid="tab-login-password">Password</TabsTrigger>
                    <TabsTrigger value="sms" data-testid="tab-login-sms">SMS Code</TabsTrigger>
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
                          <Link href="/forgot-password">
                            <a className="text-sm text-primary hover:underline" data-testid="link-forgot-password">
                              Forgot Password?
                            </a>
                          </Link>
                        </div>
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
                        <FormField
                          control={smsLoginForm.control}
                          name="smsConsent"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                              <FormControl>
                                <Checkbox
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  data-testid="checkbox-sms-login-consent"
                                />
                              </FormControl>
                              <div className="space-y-1 leading-none">
                                <FormLabel>
                                  I agree to receive text messages for authentication purposes
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
                        {smsLoginCodeSent && (
                          <FormField
                            control={smsLoginForm.control}
                            name="verificationCode"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Verification Code</FormLabel>
                                <FormControl>
                                  <Input
                                   
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
                      name="phoneNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone Number (Required)</FormLabel>
                          <div className="flex gap-2">
                            <FormControl>
                              <Input
                               
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
                    <FormField
                      control={registerForm.control}
                      name="smsConsent"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-register-sms-consent"
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

        <div className="mt-6 text-center space-y-2">
          <div className="flex items-center justify-center gap-4 text-sm">
            <Link href="/staff/login">
              <a className="text-muted-foreground hover:text-primary hover:underline" data-testid="link-to-staff-login">
                Staff Login
              </a>
            </Link>
            <span className="text-muted-foreground">•</span>
            <Link href="/wholesale/login">
              <a className="text-muted-foreground hover:text-primary hover:underline" data-testid="link-to-wholesale-login">
                Wholesale Login
              </a>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
