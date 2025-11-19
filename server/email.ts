import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { join } from 'path';

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

// Email header template with logo CID reference
const getEmailHeader = (title: string) => {
  // Use CID reference for logo if available, otherwise use text-only header
  // CID (Content ID) attachments work reliably in Gmail, Outlook, and other major email clients
  const logoHtml = hasLogo
    ? `<img src="cid:${LOGO_CID}" alt="Puget Sound Kombucha Co." style="max-width: 200px; height: auto; margin-bottom: 16px; filter: brightness(0) invert(1);" />`
    : `<span style="color: ${BRAND_COLORS.white}; font-size: 24px; font-weight: bold; letter-spacing: 1px;">PUGET SOUND KOMBUCHA CO.</span>`;
  
  return `
<div style="background-color: ${BRAND_COLORS.black}; padding: 32px 24px; text-align: center;">
  <div style="margin-bottom: 16px;">
    ${logoHtml}
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
    subject: 'Your Verification Code - Puget Sound Kombucha Co.',
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
