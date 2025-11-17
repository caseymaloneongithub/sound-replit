import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Navbar } from "@/components/layout/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Mail, Phone, MapPin, Send, Check } from "lucide-react";

const contactFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  phone: z.string().optional(),
  company: z.string().optional(),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

type ContactFormData = z.infer<typeof contactFormSchema>;

export default function Contact() {
  const { toast } = useToast();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submittedData, setSubmittedData] = useState<ContactFormData | null>(null);
  const successPanelRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  
  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      company: "",
      message: "",
    },
  });

  useEffect(() => {
    if (isSubmitted && successPanelRef.current) {
      successPanelRef.current.focus();
    }
  }, [isSubmitted]);

  const onSubmit = async (data: ContactFormData) => {
    console.log("Contact form submission:", data);
    
    setSubmittedData(data);
    setIsSubmitted(true);
    
    toast({
      title: "Message sent!",
      description: "We'll get back to you within 1-2 business days.",
    });
  };

  const handleSendAnother = () => {
    setIsSubmitted(false);
    setSubmittedData(null);
    form.reset();
    
    setTimeout(() => {
      firstInputRef.current?.focus();
    }, 0);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4" style={{ fontFamily: 'var(--font-heading)' }}>
            Get in Touch
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Interested in wholesale pricing? Have questions about our products? We'd love to hear from you.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-12 max-w-5xl mx-auto">
          <div className="space-y-8">
            <Card>
              <CardHeader>
                <CardTitle>Contact Information</CardTitle>
                <CardDescription>
                  Reach out to us through any of these channels
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                    <Mail className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Email</p>
                    <a href="mailto:info@pugetsoundkombucha.com" className="text-muted-foreground hover:text-primary transition-colors">
                      info@pugetsoundkombucha.com
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                    <Phone className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Phone</p>
                    <a href="tel:+12065551234" className="text-muted-foreground hover:text-primary transition-colors">
                      (206) 555-1234
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Brewery Location</p>
                    <p className="text-muted-foreground">
                      Seattle, WA<br />
                      Pacific Northwest
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Wholesale Inquiries</CardTitle>
                <CardDescription>
                  Looking to stock our kombucha in your store?
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  We partner with retailers, restaurants, and distributors throughout the Pacific Northwest. 
                  Fill out the form to learn about our wholesale pricing and minimum order requirements.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                    <span>Competitive wholesale pricing</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                    <span>Flexible delivery schedules</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                    <span>Dedicated account support</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{isSubmitted ? "Message Sent!" : "Send us a message"}</CardTitle>
              <CardDescription>
                {isSubmitted 
                  ? "We've received your message and will respond within 1-2 business days"
                  : "Fill out the form below and we'll respond within 1-2 business days"
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isSubmitted && submittedData ? (
                <div 
                  ref={successPanelRef}
                  className="space-y-6" 
                  role="status" 
                  aria-live="polite" 
                  tabIndex={-1}
                  data-testid="success-panel"
                >
                  <div className="flex items-center justify-center py-6">
                    <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                      <Check className="w-8 h-8 text-primary" />
                    </div>
                  </div>
                  
                  <div className="space-y-4 border-t pt-6">
                    <h3 className="font-semibold text-sm text-muted-foreground">Your Message Details:</h3>
                    
                    <div className="space-y-3 text-sm">
                      <div>
                        <span className="font-medium">Name:</span>
                        <p className="text-muted-foreground">{submittedData.name}</p>
                      </div>
                      
                      <div>
                        <span className="font-medium">Email:</span>
                        <p className="text-muted-foreground">{submittedData.email}</p>
                      </div>
                      
                      {submittedData.phone && (
                        <div>
                          <span className="font-medium">Phone:</span>
                          <p className="text-muted-foreground">{submittedData.phone}</p>
                        </div>
                      )}
                      
                      {submittedData.company && (
                        <div>
                          <span className="font-medium">Company:</span>
                          <p className="text-muted-foreground">{submittedData.company}</p>
                        </div>
                      )}
                      
                      <div>
                        <span className="font-medium">Message:</span>
                        <p className="text-muted-foreground whitespace-pre-wrap">{submittedData.message}</p>
                      </div>
                    </div>
                  </div>

                  <Button 
                    onClick={handleSendAnother}
                    className="w-full rounded-full gap-2"
                    data-testid="button-send-another"
                  >
                    <Send className="w-4 h-4" />
                    Send Another Message
                  </Button>
                </div>
              ) : (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name *</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="Your name" 
                              {...field}
                              ref={firstInputRef}
                              data-testid="input-name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email *</FormLabel>
                          <FormControl>
                            <Input 
                              type="email"
                              placeholder="your@email.com" 
                              {...field}
                              data-testid="input-email"
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
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input 
                              type="tel"
                              placeholder="(206) 555-1234" 
                              {...field}
                              data-testid="input-phone"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="company"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company / Business</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="Your company name" 
                              {...field}
                              data-testid="input-company"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="message"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Message *</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Tell us about your inquiry..."
                              className="min-h-32 resize-none"
                              {...field}
                              data-testid="input-message"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button 
                      type="submit" 
                      className="w-full rounded-full gap-2"
                      disabled={form.formState.isSubmitting}
                      data-testid="button-submit"
                    >
                      <Send className="w-4 h-4" />
                      Send Message
                    </Button>
                  </form>
                </Form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
