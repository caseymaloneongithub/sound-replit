import nodemailer from 'nodemailer';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { format } from 'date-fns';
import PDFDocument from 'pdfkit';

// Email branding - black, grey, and white color scheme
const BRAND_COLORS = {
  black: '#000000',
  darkGrey: '#111827',
  mediumGrey: '#6B7280',
  lightGrey: '#9CA3AF',
  borderGrey: '#E5E7EB',
  backgroundGrey: '#F3F4F6',
  white: '#FFFFFF',
};

// Logo path for email embedding via CID attachment
const LOGO_PATH = join(process.cwd(), 'attached_assets', 'text-stacked-black_1762299663824.png');
const LOGO_CID = 'logo@pugetsoundkombucha';

// Check if logo file exists
let hasLogo = false;
try {
  readFileSync(LOGO_PATH);
  hasLogo = true;
} catch (error) {
  console.warn('[EMAIL] Logo file not found, emails will use text-based header');
}

// Email header template - using text-based header since CSS filters for logo inversion 
// don't work reliably across email clients (Gmail, Outlook, Apple Mail, etc.)
const getEmailHeader = (title: string) => {
  return `
<div style="background-color: ${BRAND_COLORS.black}; padding: 32px 24px; text-align: center;">
  <div style="margin-bottom: 16px;">
    <span style="color: ${BRAND_COLORS.white}; font-size: 24px; font-weight: bold; letter-spacing: 1px;">PUGET SOUND KOMBUCHA CO.</span>
  </div>
  <h1 style="margin: 0; font-size: 24px; color: ${BRAND_COLORS.white}; font-weight: 600;">${title}</h1>
</div>
`;
};

// Get logo attachment for email
const getLogoAttachment = () => {
  if (!hasLogo) return [];
  
  return [{
    filename: 'logo.png',
    path: LOGO_PATH,
    cid: LOGO_CID
  }];
};

// Email footer template
const getEmailFooter = () => `
<div style="margin-top: 40px; padding-top: 24px; border-top: 2px solid ${BRAND_COLORS.borderGrey};">
  <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 14px; margin: 8px 0;">
    Thank you,<br>
    <strong style="color: ${BRAND_COLORS.darkGrey};">Puget Sound Kombucha Co.</strong>
  </p>
</div>
`;

// Create reusable transporter
const createTransporter = () => {
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailAppPassword) {
    console.warn('[EMAIL] Gmail credentials not configured. Email notifications will be logged only.');
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailAppPassword,
    },
  });
};

interface PaymentFailureEmailParams {
  customerEmail: string;
  customerName: string;
  subscriptionItems: Array<{ productName: string; quantity: number }>;
  amount: number;
  errorMessage: string;
}

interface SendFileEmailParams {
  to: string;
  subject: string;
  message: string;
  attachmentPath: string;
  attachmentFilename: string;
}

export async function sendPaymentFailureEmail(params: PaymentFailureEmailParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send payment failure email to:', params.customerEmail);
    console.log('[EMAIL] Customer:', params.customerName);
    console.log('[EMAIL] Amount:', params.amount);
    console.log('[EMAIL] Error:', params.errorMessage);
    return;
  }

  const itemsList = params.subscriptionItems
    .map(item => `- ${item.productName} (${item.quantity} case${item.quantity > 1 ? 's' : ''})`)
    .join('\n');

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.customerEmail,
    subject: 'Payment Issue with Your Kombucha Subscription',
    text: `
Hi ${params.customerName},

We were unable to process your subscription payment for the following items:

${itemsList}

Amount: $${params.amount.toFixed(2)}

Reason: ${params.errorMessage}

Please update your payment method or contact us at your earliest convenience to ensure uninterrupted service.

Thank you,
Puget Sound Kombucha Co.
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader('Payment Issue')}
  
  <div style="padding: 32px 24px;">
    <p style="color: ${BRAND_COLORS.darkGrey}; line-height: 1.6; margin: 0 0 16px 0;">Hi ${params.customerName},</p>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; line-height: 1.6; margin: 0 0 24px 0;">We were unable to process your subscription payment for the following items:</p>
    
    <ul style="margin: 20px 0; padding-left: 24px; color: ${BRAND_COLORS.darkGrey};">
      ${params.subscriptionItems.map(item => 
        `<li style="margin: 8px 0;">${item.productName} (${item.quantity} case${item.quantity > 1 ? 's' : ''})</li>`
      ).join('')}
    </ul>
    
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-radius: 4px; margin: 24px 0; border-left: 4px solid ${BRAND_COLORS.black};">
      <p style="margin: 0 0 8px 0; color: ${BRAND_COLORS.darkGrey};"><strong>Amount:</strong> $${params.amount.toFixed(2)}</p>
      <p style="margin: 0; color: ${BRAND_COLORS.mediumGrey}; font-size: 14px;"><strong>Reason:</strong> ${params.errorMessage}</p>
    </div>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; line-height: 1.6; margin: 24px 0 0 0;">Please update your payment method or contact us at your earliest convenience to ensure uninterrupted service.</p>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: getLogoAttachment(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent payment failure notification to ${params.customerEmail}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send payment failure email:', error);
    throw error;
  }
}

export async function sendStaffPaymentFailureNotification(params: PaymentFailureEmailParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send staff notification about payment failure for:', params.customerName);
    return;
  }

  const itemsList = params.subscriptionItems
    .map(item => `- ${item.productName} (${item.quantity} case${item.quantity > 1 ? 's' : ''})`)
    .join('\n');

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: process.env.GMAIL_USER, // Send to same email for staff notifications
    subject: `Subscription Payment Failed - ${params.customerName}`,
    text: `
SUBSCRIPTION PAYMENT FAILURE

Customer: ${params.customerName}
Email: ${params.customerEmail}
Amount: $${params.amount.toFixed(2)}

Items:
${itemsList}

Error: ${params.errorMessage}

Action Required: Follow up with customer regarding payment issue.
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader('Subscription Payment Failure')}
  
  <div style="padding: 32px 24px;">
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr>
        <td style="padding: 12px 8px; border-bottom: 2px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.mediumGrey};"><strong>Customer:</strong></td>
        <td style="padding: 12px 8px; border-bottom: 2px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">${params.customerName}</td>
      </tr>
      <tr>
        <td style="padding: 12px 8px; border-bottom: 2px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.mediumGrey};"><strong>Email:</strong></td>
        <td style="padding: 12px 8px; border-bottom: 2px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">${params.customerEmail}</td>
      </tr>
      <tr>
        <td style="padding: 12px 8px; border-bottom: 2px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.mediumGrey};"><strong>Amount:</strong></td>
        <td style="padding: 12px 8px; border-bottom: 2px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">$${params.amount.toFixed(2)}</td>
      </tr>
    </table>
    
    <h3 style="color: ${BRAND_COLORS.darkGrey}; margin: 24px 0 12px 0;">Items:</h3>
    <ul style="margin: 0 0 24px 0; padding-left: 24px; color: ${BRAND_COLORS.darkGrey};">
      ${params.subscriptionItems.map(item => 
        `<li style="margin: 8px 0;">${item.productName} (${item.quantity} case${item.quantity > 1 ? 's' : ''})</li>`
      ).join('')}
    </ul>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; margin: 16px 0;"><strong>Error:</strong> ${params.errorMessage}</p>
    
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-left: 4px solid ${BRAND_COLORS.black}; margin-top: 24px; border-radius: 4px;">
      <p style="margin: 0; color: ${BRAND_COLORS.darkGrey};">
        <strong>Action Required:</strong> Follow up with customer regarding payment issue.
      </p>
    </div>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: getLogoAttachment(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent staff notification about payment failure for ${params.customerName}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send staff notification:', error);
    throw error;
  }
}

interface EmailVerificationCodeParams {
  email: string;
  code: string;
}

export async function sendEmailVerificationCode(params: EmailVerificationCodeParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send verification code email to:', params.email);
    console.log('[EMAIL] Verification code:', params.code);
    return;
  }

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.email,
    subject: `${params.code} - Your Verification Code - Puget Sound Kombucha Co.`,
    text: `
Your verification code is: ${params.code}

This code will expire in 5 minutes.

If you didn't request this code, you can safely ignore this email.

Thank you,
Puget Sound Kombucha Co.
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader('Your Verification Code')}
  
  <div style="padding: 32px 24px;">
    <div style="text-align: center; margin: 30px 0;">
      <div style="background-color: ${BRAND_COLORS.backgroundGrey}; 
                  padding: 24px; 
                  border-radius: 8px; 
                  border: 2px solid ${BRAND_COLORS.black};
                  font-size: 36px; 
                  font-weight: bold; 
                  letter-spacing: 10px; 
                  color: ${BRAND_COLORS.black};">
        ${params.code}
      </div>
    </div>
    
    <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 14px; margin-top: 30px; text-align: center;">
      This code will expire in 5 minutes.
    </p>
    
    <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 14px; text-align: center;">
      If you didn't request this code, you can safely ignore this email.
    </p>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: getLogoAttachment(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent verification code to ${params.email}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send verification code email:', error);
    throw error;
  }
}

interface PasswordResetEmailParams {
  email: string;
  name: string;
  resetUrl: string;
}

export async function sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send password reset email to:', params.email);
    console.log('[EMAIL] Reset URL:', params.resetUrl);
    return;
  }

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.email,
    subject: 'Reset Your Password - Puget Sound Kombucha Co.',
    text: `
Hi ${params.name},

We received a request to reset your password. Click the link below to set a new password:

${params.resetUrl}

This link will expire in 1 hour.

If you didn't request a password reset, you can safely ignore this email.

Thank you,
Puget Sound Kombucha Co.
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader('Reset Your Password')}
  
  <div style="padding: 32px 24px;">
    <p style="color: ${BRAND_COLORS.darkGrey}; line-height: 1.6; margin: 0 0 16px 0;">Hi ${params.name},</p>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; line-height: 1.6; margin: 0 0 24px 0;">We received a request to reset your password. Click the button below to set a new password:</p>
    
    <div style="text-align: center; margin: 32px 0;">
      <a href="${params.resetUrl}" 
         style="background-color: ${BRAND_COLORS.black}; 
                color: ${BRAND_COLORS.white}; 
                padding: 14px 32px; 
                text-decoration: none; 
                border-radius: 4px; 
                display: inline-block;
                font-weight: 600;
                font-size: 16px;">
        Reset Password
      </a>
    </div>
    
    <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 14px; line-height: 1.6;">
      Or copy and paste this link into your browser:<br>
      <a href="${params.resetUrl}" style="color: ${BRAND_COLORS.darkGrey}; word-break: break-all;">${params.resetUrl}</a>
    </p>
    
    <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 14px; margin-top: 30px;">
      This link will expire in 1 hour.
    </p>
    
    <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 14px;">
      If you didn't request a password reset, you can safely ignore this email.
    </p>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: getLogoAttachment(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent password reset email to ${params.email}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send password reset email:', error);
    throw error;
  }
}

interface OrderReceiptEmailParams {
  customerEmail: string;
  customerName: string;
  orderNumber: string;
  orderItems: Array<{ productName: string; quantity: number; unitPrice: string }>;
  subtotal: number;
  taxAmount?: number;
  total: number;
  orderType: 'one-time' | 'subscription';
}

export async function sendOrderReceiptEmail(params: OrderReceiptEmailParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send order receipt email to:', params.customerEmail);
    console.log('[EMAIL] Order number:', params.orderNumber);
    console.log('[EMAIL] Total:', params.total);
    return;
  }

  const itemsList = params.orderItems
    .map(item => `- ${item.productName} - ${item.quantity} case${item.quantity > 1 ? 's' : ''} @ $${item.unitPrice} each`)
    .join('\n');

  const taxLine = params.taxAmount ? `\nSales Tax: $${params.taxAmount.toFixed(2)}` : '';

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.customerEmail,
    subject: `Order Confirmation #${params.orderNumber} - Puget Sound Kombucha Co.`,
    text: `
Hi ${params.customerName},

Thank you for your ${params.orderType === 'subscription' ? 'subscription' : 'order'}! Here's your receipt:

Order Number: ${params.orderNumber}

Items:
${itemsList}

Subtotal: $${params.subtotal.toFixed(2)}${taxLine}
Total: $${params.total.toFixed(2)}

${params.orderType === 'subscription' 
  ? 'Your subscription is now active. You will receive your first pickup notification soon.'
  : 'Your order will be ready for pickup soon. We will notify you when it\'s ready.'}

Thank you for choosing Puget Sound Kombucha Co.!

Best regards,
Puget Sound Kombucha Co.
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader('Order Confirmation')}
  
  <div style="padding: 32px 24px;">
    <p style="color: ${BRAND_COLORS.darkGrey}; line-height: 1.6; margin: 0 0 16px 0;">Hi ${params.customerName},</p>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; line-height: 1.6; margin: 0 0 24px 0;">Thank you for your ${params.orderType === 'subscription' ? 'subscription' : 'order'}! Here's your receipt:</p>
    
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-radius: 4px; margin: 24px 0; border: 2px solid ${BRAND_COLORS.black};">
      <p style="margin: 0; font-weight: bold; color: ${BRAND_COLORS.black};">Order Number: ${params.orderNumber}</p>
    </div>
    
    <h2 style="font-size: 18px; margin-top: 24px; color: ${BRAND_COLORS.darkGrey}; border-bottom: 2px solid ${BRAND_COLORS.black}; padding-bottom: 8px;">Order Items</h2>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      ${params.orderItems.map(item => `
        <tr>
          <td style="padding: 12px 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">${item.productName}</td>
          <td style="padding: 12px 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: center; color: ${BRAND_COLORS.darkGrey};">${item.quantity} case${item.quantity > 1 ? 's' : ''}</td>
          <td style="padding: 12px 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; color: ${BRAND_COLORS.darkGrey};">$${item.unitPrice}</td>
        </tr>
      `).join('')}
    </table>
    
    <div style="text-align: right; margin-top: 24px; padding: 16px; background-color: ${BRAND_COLORS.backgroundGrey}; border-radius: 4px;">
      <p style="margin: 4px 0; color: ${BRAND_COLORS.mediumGrey};">Subtotal: <strong style="color: ${BRAND_COLORS.darkGrey};">$${params.subtotal.toFixed(2)}</strong></p>
      ${params.taxAmount ? `<p style="margin: 4px 0; color: ${BRAND_COLORS.mediumGrey};">Sales Tax: <strong style="color: ${BRAND_COLORS.darkGrey};">$${params.taxAmount.toFixed(2)}</strong></p>` : ''}
      <p style="margin: 8px 0 0 0; font-size: 20px; color: ${BRAND_COLORS.black}; padding-top: 8px; border-top: 2px solid ${BRAND_COLORS.borderGrey};">Total: <strong>$${params.total.toFixed(2)}</strong></p>
    </div>
    
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-left: 4px solid ${BRAND_COLORS.black}; margin-top: 24px; border-radius: 4px;">
      <p style="margin: 0; color: ${BRAND_COLORS.darkGrey};">
        ${params.orderType === 'subscription' 
          ? 'Your subscription is now active. You will receive your first pickup notification soon.'
          : 'Your order will be ready for pickup soon. We will notify you when it\'s ready.'}
      </p>
    </div>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; margin-top: 32px;">Thank you for choosing Puget Sound Kombucha Co.!</p>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: getLogoAttachment(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent order receipt to ${params.customerEmail} for order ${params.orderNumber}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send order receipt email:', error);
    throw error;
  }
}

interface ReadyForPickupEmailParams {
  customerEmail: string;
  customerName: string;
  orderNumber: string;
  orderItems: Array<{ productName: string; quantity: number }>;
}

export async function sendReadyForPickupEmail(params: ReadyForPickupEmailParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send ready for pickup email to:', params.customerEmail);
    console.log('[EMAIL] Order number:', params.orderNumber);
    return;
  }

  const itemsList = params.orderItems
    .map(item => `- ${item.productName} (${item.quantity} case${item.quantity > 1 ? 's' : ''})`)
    .join('\n');

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.customerEmail,
    subject: `Your Order is Ready for Pickup! #${params.orderNumber}`,
    text: `
Hi ${params.customerName},

Great news! Your order is ready for pickup.

Order Number: ${params.orderNumber}

Items ready for pickup:
${itemsList}

Pickup Hours: Monday-Thursday, 9am-3pm

Please come by during our pickup hours to collect your order.

Thank you for choosing Puget Sound Kombucha Co.!

Best regards,
Puget Sound Kombucha Co.
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader('Your Order is Ready for Pickup!')}
  
  <div style="padding: 32px 24px;">
    <p style="color: ${BRAND_COLORS.darkGrey}; line-height: 1.6; margin: 0 0 16px 0;">Hi ${params.customerName},</p>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; line-height: 1.6; margin: 0 0 24px 0; font-size: 16px; font-weight: 600;">Great news! Your order is ready for pickup.</p>
    
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-radius: 4px; margin: 24px 0; border: 2px solid ${BRAND_COLORS.black};">
      <p style="margin: 0; font-weight: bold; color: ${BRAND_COLORS.black};">Order Number: ${params.orderNumber}</p>
    </div>
    
    <h2 style="font-size: 18px; margin-top: 24px; color: ${BRAND_COLORS.darkGrey}; border-bottom: 2px solid ${BRAND_COLORS.black}; padding-bottom: 8px;">Items Ready for Pickup</h2>
    <ul style="margin: 16px 0; padding-left: 24px;">
      ${params.orderItems.map(item => `
        <li style="padding: 6px 0; color: ${BRAND_COLORS.darkGrey};">${item.productName} (${item.quantity} case${item.quantity > 1 ? 's' : ''})</li>
      `).join('')}
    </ul>
    
    <div style="background-color: ${BRAND_COLORS.black}; color: ${BRAND_COLORS.white}; padding: 20px; margin-top: 32px; border-radius: 4px;">
      <p style="margin: 0 0 8px 0; font-weight: bold; font-size: 16px;">Pickup Hours</p>
      <p style="margin: 0; font-size: 18px; font-weight: 600;">Monday-Thursday, 9am-3pm</p>
    </div>
    
    <p style="margin-top: 24px; color: ${BRAND_COLORS.darkGrey}; line-height: 1.6;">Please come by during our pickup hours to collect your order.</p>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; margin-top: 32px;">Thank you for choosing Puget Sound Kombucha Co.!</p>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: getLogoAttachment(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent ready for pickup notification to ${params.customerEmail} for order ${params.orderNumber}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send ready for pickup email:', error);
    throw error;
  }
}

interface ContactFormNotificationParams {
  staffEmails: string[];
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  contactCompany?: string;
  message: string;
}

export async function sendContactFormNotification(params: ContactFormNotificationParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send contact form notification to staff');
    console.log('[EMAIL] Contact from:', params.contactName, params.contactEmail);
    console.log('[EMAIL] Message:', params.message);
    return;
  }

  if (!params.staffEmails || params.staffEmails.length === 0) {
    console.log('[EMAIL] No staff emails provided, skipping notification');
    return;
  }

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.staffEmails.join(', '),
    subject: `New Contact Form Submission from ${params.contactName}`,
    text: `
New Contact Form Submission

From: ${params.contactName}
Email: ${params.contactEmail}
${params.contactPhone ? `Phone: ${params.contactPhone}` : ''}
${params.contactCompany ? `Company: ${params.contactCompany}` : ''}

Message:
${params.message}

---
This notification was sent to all staff members.
    `.trim(),
    html: `
<div style="max-width: 600px; margin: 0 auto; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 16px; line-height: 1.6; color: ${BRAND_COLORS.darkGrey};">
  ${getEmailHeader('New Contact Form Submission')}
  
  <div style="padding: 32px 24px; background-color: ${BRAND_COLORS.white};">
    <p style="margin-top: 0; color: ${BRAND_COLORS.darkGrey};">A new inquiry has been submitted through the contact form:</p>
    
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 20px; border-radius: 4px; margin: 24px 0; border-left: 4px solid ${BRAND_COLORS.black};">
      <h2 style="margin: 0 0 16px 0; font-size: 18px; color: ${BRAND_COLORS.black};">Contact Information</h2>
      <p style="margin: 8px 0;"><strong>Name:</strong> ${params.contactName}</p>
      <p style="margin: 8px 0;"><strong>Email:</strong> <a href="mailto:${params.contactEmail}" style="color: ${BRAND_COLORS.black};">${params.contactEmail}</a></p>
      ${params.contactPhone ? `<p style="margin: 8px 0;"><strong>Phone:</strong> ${params.contactPhone}</p>` : ''}
      ${params.contactCompany ? `<p style="margin: 8px 0;"><strong>Company:</strong> ${params.contactCompany}</p>` : ''}
    </div>
    
    <div style="margin: 24px 0;">
      <h2 style="font-size: 18px; margin-bottom: 12px; color: ${BRAND_COLORS.black}; border-bottom: 2px solid ${BRAND_COLORS.black}; padding-bottom: 8px;">Message</h2>
      <p style="white-space: pre-wrap; color: ${BRAND_COLORS.darkGrey}; background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-radius: 4px; margin: 0;">${params.message}</p>
    </div>
    
    <p style="margin-top: 32px; color: ${BRAND_COLORS.mediumGrey}; font-size: 14px; font-style: italic;">This notification was sent to all staff members.</p>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: getLogoAttachment(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent contact form notification to ${params.staffEmails.length} staff member(s)`);
  } catch (error) {
    console.error('[EMAIL] Failed to send contact form notification:', error);
    throw error;
  }
}

export async function sendFileEmail(params: SendFileEmailParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send file email to:', params.to);
    console.log('[EMAIL] Subject:', params.subject);
    console.log('[EMAIL] Attachment:', params.attachmentFilename);
    return;
  }

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.to,
    subject: params.subject,
    text: params.message,
    html: `
<div style="max-width: 600px; margin: 0 auto; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 16px; line-height: 1.6; color: ${BRAND_COLORS.darkGrey};">
  ${getEmailHeader(params.subject)}
  
  <div style="padding: 32px 24px; background-color: ${BRAND_COLORS.white};">
    <div style="white-space: pre-wrap; color: ${BRAND_COLORS.darkGrey};">${params.message}</div>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: [
      ...getLogoAttachment(),
      {
        filename: params.attachmentFilename,
        path: params.attachmentPath,
      }
    ],
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent file email to ${params.to}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send file email:', error);
    throw error;
  }
}

interface BillingReminderEmailParams {
  customerEmail: string;
  customerName: string;
  billingDate: Date;
  subscriptionItems: Array<{ productName: string; quantity: number; price: string }>;
  estimatedTotal: number;
}

export async function sendBillingReminderEmail(params: BillingReminderEmailParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send billing reminder email to:', params.customerEmail);
    console.log('[EMAIL] Customer:', params.customerName);
    console.log('[EMAIL] Billing date:', params.billingDate);
    return;
  }

  const formattedDate = params.billingDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const itemsList = params.subscriptionItems
    .map(item => `- ${item.productName} (${item.quantity} case${item.quantity > 1 ? 's' : ''}) - ${item.price}`)
    .join('\n');

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.customerEmail,
    subject: `Upcoming Subscription Billing - ${formattedDate}`,
    text: `
Hi ${params.customerName},

This is a friendly reminder that your kombucha subscription will be billed in 2 days on ${formattedDate}.

Subscription Items:
${itemsList}

Estimated Total: $${params.estimatedTotal.toFixed(2)} (including tax)

If you need to make any changes to your subscription, please visit your account page before your billing date.

Thank you for being a valued subscriber!

Best regards,
Puget Sound Kombucha Co.
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader('Upcoming Subscription Billing')}
  
  <div style="padding: 32px 24px;">
    <p style="color: ${BRAND_COLORS.darkGrey}; line-height: 1.6; margin: 0 0 16px 0;">Hi ${params.customerName},</p>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; line-height: 1.6; margin: 0 0 24px 0;">This is a friendly reminder that your kombucha subscription will be billed in <strong>2 days</strong>.</p>
    
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-radius: 4px; margin: 24px 0; border: 2px solid ${BRAND_COLORS.black};">
      <p style="margin: 0; font-weight: bold; color: ${BRAND_COLORS.black}; font-size: 18px;">Billing Date: ${formattedDate}</p>
    </div>
    
    <h2 style="font-size: 18px; margin-top: 24px; color: ${BRAND_COLORS.darkGrey}; border-bottom: 2px solid ${BRAND_COLORS.black}; padding-bottom: 8px;">Subscription Items</h2>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      ${params.subscriptionItems.map(item => `
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">
            ${item.productName}
          </td>
          <td style="padding: 8px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: center; color: ${BRAND_COLORS.mediumGrey};">
            ${item.quantity} case${item.quantity > 1 ? 's' : ''}
          </td>
          <td style="padding: 8px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; color: ${BRAND_COLORS.darkGrey};">
            ${item.price}
          </td>
        </tr>
      `).join('')}
    </table>
    
    <div style="background-color: ${BRAND_COLORS.black}; color: ${BRAND_COLORS.white}; padding: 16px; border-radius: 4px; margin: 24px 0;">
      <p style="margin: 0; font-size: 16px;">Estimated Total: <strong>$${params.estimatedTotal.toFixed(2)}</strong> <span style="font-size: 12px; opacity: 0.8;">(including tax)</span></p>
    </div>
    
    <p style="color: ${BRAND_COLORS.mediumGrey}; line-height: 1.6; margin: 24px 0 0 0; font-size: 14px;">If you need to make any changes to your subscription, please visit your account page before your billing date.</p>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; margin-top: 32px;">Thank you for being a valued subscriber!</p>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: getLogoAttachment(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent billing reminder to ${params.customerEmail} for billing on ${formattedDate}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send billing reminder email:', error);
    throw error;
  }
}

interface SubscriptionChargeConfirmationParams {
  customerEmail: string;
  customerName: string;
  pickupDate: Date;
  subscriptionItems: Array<{
    productName: string;
    quantity: number;
    flavorName?: string;
    price: string;
  }>;
  totalAmount: number;
  orderNumber?: string;
}

export async function sendSubscriptionChargeConfirmationEmail(params: SubscriptionChargeConfirmationParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send subscription charge confirmation to:', params.customerEmail);
    console.log('[EMAIL] Pickup date:', params.pickupDate);
    return;
  }

  const formattedPickupDate = format(params.pickupDate, 'EEEE, MMMM d, yyyy');
  
  const itemsText = params.subscriptionItems
    .map(item => {
      const flavorInfo = item.flavorName ? ` - ${item.flavorName}` : '';
      return `- ${item.productName}${flavorInfo} x ${item.quantity} (${item.price})`;
    })
    .join('\n');

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.customerEmail,
    subject: `Your Subscription Order is Confirmed! Pickup on ${format(params.pickupDate, 'EEEE, MMM d')}`,
    text: `
Hi ${params.customerName},

Your subscription has been charged and your order is confirmed!

${params.orderNumber ? `Order Number: ${params.orderNumber}\n` : ''}
PICKUP DATE: ${formattedPickupDate}

Your Items:
${itemsText}

Total Charged: $${params.totalAmount.toFixed(2)} (including tax)

PICKUP INSTRUCTIONS
-------------------
Address: 4501 Shilshole Ave NW, Seattle, WA 98107
Hours: Monday-Thursday, 9:00am to 3:00pm
Location: At the back of the building at the garage door
Phone: (206) 789-5219

Please call when you arrive and we'll bring your order out!

Thank you for being a valued subscriber!

Best regards,
Puget Sound Kombucha Co.
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader('Your Subscription Order is Confirmed!')}
  
  <div style="padding: 32px 24px;">
    <p style="color: ${BRAND_COLORS.darkGrey}; line-height: 1.6; margin: 0 0 16px 0;">Hi ${params.customerName},</p>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; line-height: 1.6; margin: 0 0 24px 0;">Your subscription has been charged and your order is confirmed!</p>
    
    ${params.orderNumber ? `
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 12px 16px; border-radius: 4px; margin: 0 0 16px 0; border: 2px solid ${BRAND_COLORS.black};">
      <p style="margin: 0; font-weight: bold; color: ${BRAND_COLORS.black};">Order Number: ${params.orderNumber}</p>
    </div>
    ` : ''}
    
    <div style="background-color: ${BRAND_COLORS.black}; color: ${BRAND_COLORS.white}; padding: 20px; border-radius: 4px; margin-bottom: 24px;">
      <p style="margin: 0 0 4px 0; font-size: 14px; opacity: 0.9;">PICKUP DATE</p>
      <p style="margin: 0; font-size: 20px; font-weight: bold;">${formattedPickupDate}</p>
    </div>
    
    <h2 style="font-size: 16px; margin: 24px 0 12px 0; color: ${BRAND_COLORS.darkGrey}; border-bottom: 2px solid ${BRAND_COLORS.black}; padding-bottom: 8px;">Your Items</h2>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      ${params.subscriptionItems.map(item => `
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">
            ${item.productName}${item.flavorName ? ` - ${item.flavorName}` : ''} x ${item.quantity}
          </td>
          <td style="padding: 8px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; color: ${BRAND_COLORS.darkGrey};">
            ${item.price}
          </td>
        </tr>
      `).join('')}
      <tr>
        <td style="padding: 12px 0; font-weight: bold; color: ${BRAND_COLORS.black};">Total Charged</td>
        <td style="padding: 12px 0; text-align: right; font-weight: bold; color: ${BRAND_COLORS.black};">$${params.totalAmount.toFixed(2)}</td>
      </tr>
    </table>
    <p style="font-size: 12px; color: ${BRAND_COLORS.mediumGrey}; margin: 0 0 24px 0;">* Price includes 10.35% sales tax</p>
    
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 20px; border-radius: 4px; border: 2px solid ${BRAND_COLORS.black};">
      <h3 style="margin: 0 0 16px 0; font-size: 16px; color: ${BRAND_COLORS.black};">📍 Pickup Instructions</h3>
      <p style="margin: 0 0 8px 0; color: ${BRAND_COLORS.darkGrey};"><strong>Address:</strong> 4501 Shilshole Ave NW, Seattle, WA 98107</p>
      <p style="margin: 0 0 8px 0; color: ${BRAND_COLORS.darkGrey};"><strong>Hours:</strong> Monday-Thursday, 9:00am to 3:00pm</p>
      <p style="margin: 0 0 8px 0; color: ${BRAND_COLORS.darkGrey};"><strong>Location:</strong> At the back of the building at the garage door</p>
      <p style="margin: 0 0 8px 0; color: ${BRAND_COLORS.darkGrey};"><strong>Phone:</strong> (206) 789-5219</p>
      <p style="margin: 16px 0 0 0; color: ${BRAND_COLORS.black}; font-weight: 600;">📞 Please call when you arrive and we'll bring your order out!</p>
    </div>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; margin-top: 32px;">Thank you for being a valued subscriber!</p>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: getLogoAttachment(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent subscription charge confirmation to ${params.customerEmail} for pickup on ${formattedPickupDate}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send subscription charge confirmation email:', error);
    throw error;
  }
}

// Wholesale Invoice Email Types
interface WholesaleInvoiceItem {
  productName: string;
  quantity: number;
  unitPrice: string;
}

interface WholesaleInvoiceLocation {
  locationName: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  contactName?: string | null;
  contactPhone?: string | null;
}

interface WholesaleInvoiceEmailParams {
  customerEmail: string;
  businessName: string;
  contactName: string;
  customerAddress: string;
  customerPhone: string;
  invoiceNumber: string;
  orderDate: Date;
  deliveryDate?: Date | null;
  dueDate?: Date | null;
  items: WholesaleInvoiceItem[];
  subtotal: number;
  notes?: string | null;
  location?: WholesaleInvoiceLocation | null;
  allowOnlinePayment: boolean;
  paymentUrl?: string | null;
}

// Generate PDF invoice buffer
export async function generateInvoicePDF(params: WholesaleInvoiceEmailParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(24).font('Helvetica-Bold').text('INVOICE', { align: 'left' });
    doc.moveDown(0.5);
    
    doc.fontSize(10).font('Helvetica');
    doc.text(`Invoice #: ${params.invoiceNumber}`);
    doc.text(`Date: ${format(params.orderDate, 'MMM dd, yyyy')}`);
    if (params.deliveryDate) {
      doc.text(`Delivery Date: ${format(params.deliveryDate, 'MMM dd, yyyy')}`);
    }
    if (params.dueDate) {
      doc.text(`Payment Due: ${format(params.dueDate, 'MMM dd, yyyy')}`);
    }
    
    doc.moveDown(1);

    // Two column layout for From/Bill To
    const startY = doc.y;
    const columnWidth = 220;
    
    // FROM
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#666666').text('FROM', 50, startY);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Puget Sound Kombucha Co.', 50, startY + 15);
    doc.font('Helvetica').fontSize(9).fillColor('#666666');
    doc.text('4501 Shilshole Ave NW', 50, startY + 30);
    doc.text('Seattle, WA 98107', 50, startY + 42);
    doc.text('emily@soundkombucha.com', 50, startY + 54);
    doc.text('(206) 789-5219', 50, startY + 66);
    
    // BILL TO
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#666666').text('BILL TO', 50 + columnWidth, startY);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text(params.businessName, 50 + columnWidth, startY + 15);
    doc.font('Helvetica').fontSize(9).fillColor('#666666');
    doc.text(params.contactName, 50 + columnWidth, startY + 30);
    doc.text(params.customerAddress, 50 + columnWidth, startY + 42);
    doc.text(params.customerEmail, 50 + columnWidth, startY + 54);
    doc.text(params.customerPhone, 50 + columnWidth, startY + 66);

    // DELIVER TO (if location provided)
    if (params.location) {
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#666666').text('DELIVER TO', 50 + columnWidth * 2, startY);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text(params.location.locationName, 50 + columnWidth * 2, startY + 15);
      doc.font('Helvetica').fontSize(9).fillColor('#666666');
      doc.text(params.location.address, 50 + columnWidth * 2, startY + 30);
      doc.text(`${params.location.city}, ${params.location.state} ${params.location.zipCode}`, 50 + columnWidth * 2, startY + 42);
      if (params.location.contactName) {
        doc.text(params.location.contactName, 50 + columnWidth * 2, startY + 54);
      }
      if (params.location.contactPhone) {
        doc.text(params.location.contactPhone, 50 + columnWidth * 2, startY + 66);
      }
    }

    doc.y = startY + 100;
    doc.moveDown(1);

    // Table header
    const tableTop = doc.y;
    doc.fillColor('#f3f4f6').rect(50, tableTop, 512, 20).fill();
    doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold');
    doc.text('Item', 55, tableTop + 5);
    doc.text('Qty', 350, tableTop + 5, { width: 60, align: 'center' });
    doc.text('Unit Price', 410, tableTop + 5, { width: 70, align: 'right' });
    doc.text('Total', 485, tableTop + 5, { width: 70, align: 'right' });

    // Table rows
    let yPos = tableTop + 25;
    doc.font('Helvetica').fontSize(10);
    
    for (const item of params.items) {
      const lineTotal = parseFloat(item.unitPrice) * item.quantity;
      doc.fillColor('#000000');
      doc.text(item.productName, 55, yPos, { width: 280 });
      doc.text(item.quantity.toString(), 350, yPos, { width: 60, align: 'center' });
      doc.text(`$${parseFloat(item.unitPrice).toFixed(2)}`, 410, yPos, { width: 70, align: 'right' });
      doc.text(`$${lineTotal.toFixed(2)}`, 485, yPos, { width: 70, align: 'right' });
      
      // Draw line under row
      yPos += 18;
      doc.strokeColor('#e5e7eb').lineWidth(0.5).moveTo(50, yPos).lineTo(562, yPos).stroke();
      yPos += 8;
    }

    // Total section
    yPos += 10;
    doc.fillColor('#f3f4f6').rect(380, yPos, 182, 30).fill();
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(12);
    doc.text('TOTAL:', 390, yPos + 8);
    doc.text(`$${params.subtotal.toFixed(2)}`, 485, yPos + 8, { width: 70, align: 'right' });

    // Notes section
    if (params.notes) {
      yPos += 50;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#666666').text('Notes:', 50, yPos);
      doc.font('Helvetica').fontSize(10).fillColor('#000000').text(params.notes, 50, yPos + 15, { width: 512 });
    }

    // Payment info at bottom
    yPos = doc.page.height - 100;
    doc.fontSize(9).fillColor('#666666');
    if (params.allowOnlinePayment && params.paymentUrl) {
      doc.text('Pay online at:', 50, yPos);
      doc.fillColor('#000000').text(params.paymentUrl, 50, yPos + 12);
    } else {
      doc.text('Payment Terms: Net 30', 50, yPos);
    }
    
    doc.fillColor('#666666').text('Thank you for your business!', 50, yPos + 30);

    doc.end();
  });
}

export async function sendWholesaleInvoiceEmail(params: WholesaleInvoiceEmailParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send wholesale invoice email to:', params.customerEmail);
    console.log('[EMAIL] Invoice:', params.invoiceNumber);
    console.log('[EMAIL] Total:', params.subtotal);
    return;
  }

  // Generate PDF
  const pdfBuffer = await generateInvoicePDF(params);
  
  const orderDateFormatted = format(params.orderDate, 'MMM dd, yyyy');
  const deliveryDateFormatted = params.deliveryDate ? format(params.deliveryDate, 'MMM dd, yyyy') : null;
  const dueDateFormatted = params.dueDate ? format(params.dueDate, 'MMM dd, yyyy') : null;

  // Build items table HTML
  const itemsHtml = params.items.map(item => {
    const lineTotal = parseFloat(item.unitPrice) * item.quantity;
    return `
      <tr>
        <td style="padding: 12px 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">${item.productName}</td>
        <td style="padding: 12px 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: center; color: ${BRAND_COLORS.darkGrey};">${item.quantity}</td>
        <td style="padding: 12px 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; color: ${BRAND_COLORS.darkGrey};">$${parseFloat(item.unitPrice).toFixed(2)}</td>
        <td style="padding: 12px 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; color: ${BRAND_COLORS.darkGrey};">$${lineTotal.toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  // Build items text list
  const itemsText = params.items.map(item => {
    const lineTotal = parseFloat(item.unitPrice) * item.quantity;
    return `- ${item.productName} x ${item.quantity} @ $${parseFloat(item.unitPrice).toFixed(2)} = $${lineTotal.toFixed(2)}`;
  }).join('\n');

  // Payment link section
  const paymentHtml = params.allowOnlinePayment && params.paymentUrl ? `
    <div style="text-align: center; margin: 32px 0;">
      <a href="${params.paymentUrl}" 
         style="background-color: ${BRAND_COLORS.black}; 
                color: ${BRAND_COLORS.white}; 
                padding: 14px 32px; 
                text-decoration: none; 
                border-radius: 4px; 
                display: inline-block;
                font-weight: 600;
                font-size: 16px;">
        Pay Invoice Online
      </a>
    </div>
    <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 14px; text-align: center; margin: 0;">
      Or copy this link: <a href="${params.paymentUrl}" style="color: ${BRAND_COLORS.darkGrey};">${params.paymentUrl}</a>
    </p>
  ` : `
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-radius: 4px; margin: 24px 0;">
      <p style="margin: 0; color: ${BRAND_COLORS.darkGrey};"><strong>Payment Terms:</strong> Net 30</p>
    </div>
  `;

  const paymentText = params.allowOnlinePayment && params.paymentUrl 
    ? `\nPay online: ${params.paymentUrl}\n`
    : '\nPayment Terms: Net 30\n';

  // Delivery location section
  const locationHtml = params.location ? `
    <div style="margin-top: 16px;">
      <h3 style="font-size: 12px; color: ${BRAND_COLORS.mediumGrey}; margin: 0 0 8px 0;">DELIVER TO</h3>
      <p style="margin: 0; color: ${BRAND_COLORS.darkGrey}; font-weight: 600;">${params.location.locationName}</p>
      <p style="margin: 4px 0 0 0; color: ${BRAND_COLORS.mediumGrey}; font-size: 14px;">${params.location.address}</p>
      <p style="margin: 2px 0 0 0; color: ${BRAND_COLORS.mediumGrey}; font-size: 14px;">${params.location.city}, ${params.location.state} ${params.location.zipCode}</p>
      ${params.location.contactName ? `<p style="margin: 2px 0 0 0; color: ${BRAND_COLORS.mediumGrey}; font-size: 14px;">${params.location.contactName}</p>` : ''}
      ${params.location.contactPhone ? `<p style="margin: 2px 0 0 0; color: ${BRAND_COLORS.mediumGrey}; font-size: 14px;">${params.location.contactPhone}</p>` : ''}
    </div>
  ` : '';

  const locationText = params.location 
    ? `\nDeliver To: ${params.location.locationName}, ${params.location.address}, ${params.location.city}, ${params.location.state} ${params.location.zipCode}\n`
    : '';

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.customerEmail,
    subject: `Invoice ${params.invoiceNumber} - Puget Sound Kombucha Co.`,
    text: `
Invoice ${params.invoiceNumber}
Puget Sound Kombucha Co.

Date: ${orderDateFormatted}
${deliveryDateFormatted ? `Delivery Date: ${deliveryDateFormatted}` : ''}
${dueDateFormatted ? `Payment Due: ${dueDateFormatted}` : ''}

Bill To:
${params.businessName}
${params.contactName}
${params.customerAddress}
${params.customerPhone}
${locationText}
Items:
${itemsText}

TOTAL: $${params.subtotal.toFixed(2)}
${params.notes ? `\nNotes: ${params.notes}` : ''}
${paymentText}
Thank you for your business!

Puget Sound Kombucha Co.
4501 Shilshole Ave NW
Seattle, WA 98107
emily@soundkombucha.com
(206) 789-5219
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader(`Invoice ${params.invoiceNumber}`)}
  
  <div style="padding: 32px 24px;">
    <div style="margin-bottom: 24px;">
      <p style="color: ${BRAND_COLORS.mediumGrey}; margin: 0 0 4px 0; font-size: 14px;">Date: <span style="color: ${BRAND_COLORS.darkGrey}; font-weight: 600;">${orderDateFormatted}</span></p>
      ${deliveryDateFormatted ? `<p style="color: ${BRAND_COLORS.mediumGrey}; margin: 0 0 4px 0; font-size: 14px;">Delivery Date: <span style="color: ${BRAND_COLORS.darkGrey}; font-weight: 600;">${deliveryDateFormatted}</span></p>` : ''}
      ${dueDateFormatted ? `<p style="color: ${BRAND_COLORS.mediumGrey}; margin: 0; font-size: 14px;">Payment Due: <span style="color: ${BRAND_COLORS.darkGrey}; font-weight: 600;">${dueDateFormatted}</span></p>` : ''}
    </div>
    
    <div style="display: flex; gap: 24px; margin-bottom: 24px;">
      <div>
        <h3 style="font-size: 12px; color: ${BRAND_COLORS.mediumGrey}; margin: 0 0 8px 0;">BILL TO</h3>
        <p style="margin: 0; color: ${BRAND_COLORS.darkGrey}; font-weight: 600;">${params.businessName}</p>
        <p style="margin: 4px 0 0 0; color: ${BRAND_COLORS.mediumGrey}; font-size: 14px;">${params.contactName}</p>
        <p style="margin: 2px 0 0 0; color: ${BRAND_COLORS.mediumGrey}; font-size: 14px;">${params.customerAddress}</p>
        <p style="margin: 2px 0 0 0; color: ${BRAND_COLORS.mediumGrey}; font-size: 14px;">${params.customerPhone}</p>
      </div>
      ${locationHtml}
    </div>
    
    <h2 style="font-size: 16px; margin: 24px 0 12px 0; color: ${BRAND_COLORS.darkGrey}; border-bottom: 2px solid ${BRAND_COLORS.black}; padding-bottom: 8px;">Items</h2>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      <thead>
        <tr style="background-color: ${BRAND_COLORS.backgroundGrey};">
          <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Item</th>
          <th style="padding: 10px 8px; text-align: center; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Qty</th>
          <th style="padding: 10px 8px; text-align: right; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Unit Price</th>
          <th style="padding: 10px 8px; text-align: right; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>
    
    <div style="text-align: right; margin: 24px 0; padding: 16px; background-color: ${BRAND_COLORS.backgroundGrey}; border-radius: 4px;">
      <p style="margin: 0; font-size: 18px; color: ${BRAND_COLORS.black}; font-weight: bold;">Total: $${params.subtotal.toFixed(2)}</p>
    </div>
    
    ${params.notes ? `
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-radius: 4px; margin: 24px 0; border-left: 4px solid ${BRAND_COLORS.black};">
      <p style="margin: 0 0 4px 0; font-weight: bold; color: ${BRAND_COLORS.darkGrey};">Notes:</p>
      <p style="margin: 0; color: ${BRAND_COLORS.mediumGrey};">${params.notes}</p>
    </div>
    ` : ''}
    
    ${paymentHtml}
    
    <p style="color: ${BRAND_COLORS.darkGrey}; margin-top: 32px;">Thank you for your business!</p>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: [
      ...getLogoAttachment(),
      {
        filename: `Invoice-${params.invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }
    ],
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent wholesale invoice email to ${params.customerEmail} for invoice ${params.invoiceNumber}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send wholesale invoice email:', error);
    throw error;
  }
}
