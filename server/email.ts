import nodemailer from 'nodemailer';
import { format } from 'date-fns';
import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
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

// Logo: served from the public R2 bucket rather than attached per-email — one mechanism
// that works over SMTP and HTTP mail APIs alike, and smaller emails.
const LOGO_URL = 'https://pub-fa09cd644b5c4f1985abd165027b2596.r2.dev/images/email-logo-white.png';
const hasLogo = true;

// Kept for call-site compatibility; the logo is a hosted image now, nothing to attach.
const getLogoAttachment = (): any[] => [];

// Email header template with white logo PNG on black background
const getEmailHeader = (title: string) => {
  const logoHtml = hasLogo 
    ? `<img src="${LOGO_URL}" alt="Puget Sound Kombucha Co." style="max-width: 200px; height: auto;" />`
    : `<div style="margin-bottom: 8px;">
        <span style="color: ${BRAND_COLORS.white}; font-size: 28px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase;">PUGET SOUND</span>
      </div>
      <div>
        <span style="color: ${BRAND_COLORS.white}; font-size: 18px; font-weight: 500; letter-spacing: 3px; text-transform: uppercase;">KOMBUCHA CO.</span>
      </div>`;
  
  return `
<div style="background-color: ${BRAND_COLORS.black}; padding: 32px 24px; text-align: center;">
  <div style="margin-bottom: 20px;">
    ${logoHtml}
  </div>
  <h1 style="margin: 0; font-size: 24px; color: ${BRAND_COLORS.white}; font-weight: 600;">${title}</h1>
</div>
`;
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
/**
 * Send one email through the Resend HTTP API (https over 443 — no SMTP ports, which
 * Railway blocks). Accepts nodemailer-shaped mailOptions so every existing send function
 * works unchanged. From-address comes from RESEND_FROM (must be on the verified domain).
 */
async function resendSendMail(mailOptions: any): Promise<void> {
  const attachments = await Promise.all((mailOptions.attachments ?? []).map(async (a: any) => {
    let content: string | undefined;
    if (a.content) {
      content = Buffer.isBuffer(a.content) ? a.content.toString('base64') : Buffer.from(String(a.content)).toString('base64');
    } else if (a.path) {
      const { readFile } = await import('fs/promises');
      content = (await readFile(a.path)).toString('base64');
    }
    return { filename: a.filename, content };
  }));
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || mailOptions.from,
      to: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
      subject: mailOptions.subject,
      html: mailOptions.html,
      text: mailOptions.text,
      ...(attachments.length ? { attachments } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function resendVerify(): Promise<true> {
  const res = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Resend API key rejected (HTTP ${res.status})`);
  return true;
}

const createTransporter = () => {
  // Preferred: Resend over HTTPS. SMTP ports are blocked on Railway (verified 2026-08-25:
  // ETIMEDOUT to smtp.gmail.com:465 even on the paid plan), so the SMTP path below only
  // serves environments that allow it.
  if (process.env.RESEND_API_KEY) {
    return { sendMail: resendSendMail, verify: resendVerify } as any;
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailAppPassword) {
    console.warn('[EMAIL] Gmail credentials not configured. Email notifications will be logged only.');
    return null;
  }

  return nodemailer.createTransport({
    // Explicit host/port rather than service:'gmail', and short timeouts: on hosts with
    // broken IPv6 egress (Railway among them) the default config can hang a request for
    // two minutes instead of failing. This fails in seconds with a real error.
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: gmailUser,
      pass: gmailAppPassword,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
};

/**
 * Startup self-check: connects and authenticates to SMTP, then logs a definitive verdict.
 * Turns "email is stuck" from a guessing game into one line in the deploy logs.
 */
export async function verifyEmailTransport(): Promise<void> {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[EMAIL] Mail check: neither RESEND_API_KEY nor GMAIL_USER/GMAIL_APP_PASSWORD set — all email is log-only.');
    return;
  }
  try {
    await transporter.verify();
    console.log(`[EMAIL] ${process.env.RESEND_API_KEY ? 'Resend HTTP API check: key accepted' : 'SMTP check: connected and authenticated to smtp.gmail.com'} — email will send.`);
  } catch (err: any) {
    console.error('[EMAIL] SMTP check FAILED: ' + (err?.code ?? '') + ' ' + (err?.message ?? err));
    console.error('[EMAIL] ETIMEDOUT/ECONNECTION here means the host cannot reach smtp.gmail.com:465 (port block or IPv6 egress — try NODE_OPTIONS=--dns-result-order=ipv4first). EAUTH means the app password is wrong.');
  }
}

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

// Staff heads-up when a customer adds/updates a payment method — during the
// migration window this is the "Kristina added her card" signal. Transactional,
// so gated only on mail being configured.
export async function sendPaymentMethodAddedNotification(params: { staffEmails: string[]; customerLabel: string; methodLabel: string }): Promise<void> {
  const transporter = createTransporter();
  if (!transporter || params.staffEmails.length === 0) {
    console.log(`[EMAIL] (not sent — mail not configured) payment method added: ${params.customerLabel}`);
    return;
  }
  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: params.staffEmails.join(', '),
    subject: `Payment method added — ${params.customerLabel}`,
    text: `${params.customerLabel} just saved a payment method (${params.methodLabel}). If they have a subscription waiting on a card, it will bill on its scheduled date — or they can use "Try payment again" for an immediate charge.`,
  });
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
  name?: string;
  /**
   * One-click sign-in URL. When present the email leads with a button and offers the code
   * as a fallback, since some mail clients rewrite or strip links. Both redeem the same
   * single-use credential.
   */
  magicLink?: string;
  /**
   * How long the code/link is valid, in minutes. MUST match the expiresAt the caller
   * stored. Defaults to 5 (retail/staff 2FA); wholesale login passes 15. This template is
   * shared — hardcoding one flow's expiry here once told 2FA users they had 15 minutes
   * when their code died at 5.
   */
  expiresMinutes?: number;
}

export async function sendEmailVerificationCode(params: EmailVerificationCodeParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send verification code email to:', params.email);
    console.log('[EMAIL] Verification code:', params.code);
    if (params.magicLink) console.log('[EMAIL] Magic link:', params.magicLink);
    return;
  }

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.email,
    subject: `${params.code} - Your Verification Code - Puget Sound Kombucha Co.`,
    text: `
${params.magicLink ? `Sign in here:\n${params.magicLink}\n\nOr enter this code: ${params.code}` : `Your verification code is: ${params.code}`}

This ${params.magicLink ? 'link and code expire' : 'code will expire'} in ${params.expiresMinutes ?? 5} minutes and can only be used once.

If you didn't request this, you can safely ignore this email.

Thank you,
Puget Sound Kombucha Co.
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader('Your Verification Code')}
  
  <div style="padding: 32px 24px;">
    ${params.magicLink ? `
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.magicLink}"
         style="display: inline-block;
                background-color: ${BRAND_COLORS.black};
                color: ${BRAND_COLORS.white};
                padding: 16px 32px;
                border-radius: 8px;
                font-size: 16px;
                font-weight: bold;
                text-decoration: none;">
        Sign in to your account
      </a>
    </div>

    <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 14px; text-align: center; margin-top: 24px;">
      Or enter this code instead:
    </p>
    ` : ''}

    <div style="text-align: center; margin: ${params.magicLink ? '12px' : '30px'} 0;">
      <div style="background-color: ${BRAND_COLORS.backgroundGrey};
                  padding: ${params.magicLink ? '16px' : '24px'};
                  border-radius: 8px;
                  border: 2px solid ${BRAND_COLORS.black};
                  font-size: ${params.magicLink ? '28px' : '36px'};
                  font-weight: bold;
                  letter-spacing: 10px;
                  color: ${BRAND_COLORS.black};">
        ${params.code}
      </div>
    </div>

    <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 14px; margin-top: 30px; text-align: center;">
      This ${params.magicLink ? 'link and code expire' : 'code will expire'} in ${params.expiresMinutes ?? 5} minutes and can only be used once.
    </p>

    <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 14px; text-align: center;">
      If you didn't request this, you can safely ignore this email.
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

// Retail Order Admin Notification - sent to admins when retail order is placed
interface RetailOrderAdminNotificationParams {
  adminEmails: string[];
  customerName: string;
  customerEmail: string;
  orderNumber: string;
  orderDate: Date;
  orderItems: Array<{ productName: string; quantity: number; unitPrice: string }>;
  subtotal: number;
  taxAmount?: number;
  total: number;
  orderType: 'one-time' | 'subscription';
}

export async function sendRetailOrderAdminNotification(params: RetailOrderAdminNotificationParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send retail order notification to admins');
    console.log('[EMAIL] Order number:', params.orderNumber);
    return;
  }

  const orderDateFormatted = format(params.orderDate, 'MMMM d, yyyy \'at\' h:mm a');
  
  const itemsHtml = params.orderItems.map(item => {
    const lineTotal = parseFloat(item.unitPrice) * item.quantity;
    return `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">${item.productName}</td>
        <td style="padding: 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: center; color: ${BRAND_COLORS.darkGrey};">${item.quantity} case${item.quantity > 1 ? 's' : ''}</td>
        <td style="padding: 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; color: ${BRAND_COLORS.darkGrey};">$${lineTotal.toFixed(2)}</td>
      </tr>
    `;
  }).join('');
  
  const itemsText = params.orderItems.map(item => {
    const lineTotal = parseFloat(item.unitPrice) * item.quantity;
    return `- ${item.productName} x ${item.quantity} = $${lineTotal.toFixed(2)}`;
  }).join('\n');

  const orderTypeLabel = params.orderType === 'subscription' ? 'New Subscription' : 'New Retail Order';
  const orderTypeBgColor = params.orderType === 'subscription' ? '#dcfce7' : '#dbeafe';
  const orderTypeBorderColor = params.orderType === 'subscription' ? '#22c55e' : '#3b82f6';
  const orderTypeTextColor = params.orderType === 'subscription' ? '#166534' : '#1e40af';

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.adminEmails.join(', '),
    subject: `${orderTypeLabel}: #${params.orderNumber} - ${params.customerName} ($${params.total.toFixed(2)})`,
    text: `
${orderTypeLabel}

Order #: ${params.orderNumber}
Customer: ${params.customerName}
Email: ${params.customerEmail}
Order Date: ${orderDateFormatted}

Items:
${itemsText}

Subtotal: $${params.subtotal.toFixed(2)}
${params.taxAmount ? `Sales Tax: $${params.taxAmount.toFixed(2)}` : ''}
Total: $${params.total.toFixed(2)}

---
Puget Sound Kombucha Co.
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader(orderTypeLabel)}
  
  <div style="padding: 32px 24px;">
    <div style="background-color: ${orderTypeBgColor}; border: 2px solid ${orderTypeBorderColor}; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
      <p style="margin: 0; font-size: 14px; color: ${orderTypeTextColor}; font-weight: bold;">${orderTypeLabel.toUpperCase()}</p>
      <p style="margin: 8px 0 0 0; font-size: 24px; color: ${orderTypeTextColor}; font-weight: bold;">$${params.total.toFixed(2)}</p>
    </div>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.mediumGrey}; width: 120px;">Order #</td>
        <td style="padding: 10px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey}; font-weight: 600;">${params.orderNumber}</td>
      </tr>
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.mediumGrey};">Customer</td>
        <td style="padding: 10px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey}; font-weight: 600;">${params.customerName}</td>
      </tr>
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.mediumGrey};">Email</td>
        <td style="padding: 10px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">${params.customerEmail}</td>
      </tr>
      <tr>
        <td style="padding: 10px 0; color: ${BRAND_COLORS.mediumGrey};">Order Date</td>
        <td style="padding: 10px 0; color: ${BRAND_COLORS.darkGrey};">${orderDateFormatted}</td>
      </tr>
    </table>
    
    <h3 style="font-size: 14px; color: ${BRAND_COLORS.darkGrey}; margin: 0 0 12px 0;">Order Items</h3>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      <thead>
        <tr style="background-color: ${BRAND_COLORS.backgroundGrey};">
          <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Item</th>
          <th style="padding: 10px 8px; text-align: center; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Qty</th>
          <th style="padding: 10px 8px; text-align: right; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>
    
    <div style="text-align: right; padding: 16px; background-color: ${BRAND_COLORS.backgroundGrey}; border-radius: 4px;">
      <p style="margin: 4px 0; color: ${BRAND_COLORS.mediumGrey};">Subtotal: <strong style="color: ${BRAND_COLORS.darkGrey};">$${params.subtotal.toFixed(2)}</strong></p>
      ${params.taxAmount ? `<p style="margin: 4px 0; color: ${BRAND_COLORS.mediumGrey};">Sales Tax: <strong style="color: ${BRAND_COLORS.darkGrey};">$${params.taxAmount.toFixed(2)}</strong></p>` : ''}
      <p style="margin: 8px 0 0 0; font-size: 18px; color: ${BRAND_COLORS.black}; padding-top: 8px; border-top: 2px solid ${BRAND_COLORS.borderGrey};">Total: <strong>$${params.total.toFixed(2)}</strong></p>
    </div>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: getLogoAttachment(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent retail order notification to admins for order ${params.orderNumber}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send retail order notification:', error);
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

// Admin notification when wholesale invoice is paid online
interface WholesaleInvoicePaidNotificationParams {
  adminEmails: string[];
  businessName: string;
  invoiceNumber: string;
  amount: number;
  paidAt: Date;
}

export async function sendWholesaleInvoicePaidNotification(params: WholesaleInvoicePaidNotificationParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send wholesale invoice paid notification to admins');
    console.log('[EMAIL] Invoice:', params.invoiceNumber, 'Amount:', params.amount);
    return;
  }

  const formattedDate = format(params.paidAt, 'MMMM d, yyyy \'at\' h:mm a');
  
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.adminEmails.join(', '),
    subject: `Invoice Paid: ${params.invoiceNumber} - ${params.businessName} ($${params.amount.toFixed(2)})`,
    text: `
Wholesale Invoice Paid Online

Invoice: ${params.invoiceNumber}
Customer: ${params.businessName}
Amount: $${params.amount.toFixed(2)}
Paid: ${formattedDate}

This payment was processed via Stripe.

---
Puget Sound Kombucha Co.
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader('Invoice Paid')}
  
  <div style="padding: 32px 24px;">
    <div style="background-color: #dcfce7; border: 2px solid #16a34a; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
      <p style="margin: 0; font-size: 16px; color: #166534; font-weight: bold;">Payment Received</p>
      <p style="margin: 8px 0 0 0; font-size: 24px; color: #166534; font-weight: bold;">$${params.amount.toFixed(2)}</p>
    </div>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.mediumGrey}; width: 120px;">Invoice</td>
        <td style="padding: 12px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey}; font-weight: 600;">${params.invoiceNumber}</td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.mediumGrey};">Customer</td>
        <td style="padding: 12px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey}; font-weight: 600;">${params.businessName}</td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.mediumGrey};">Paid</td>
        <td style="padding: 12px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">${formattedDate}</td>
      </tr>
      <tr>
        <td style="padding: 12px 0; color: ${BRAND_COLORS.mediumGrey};">Method</td>
        <td style="padding: 12px 0; color: ${BRAND_COLORS.darkGrey};">Stripe (Online)</td>
      </tr>
    </table>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: getLogoAttachment(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent wholesale invoice paid notification to admins for ${params.invoiceNumber}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send wholesale invoice paid notification:', error);
    throw error;
  }
}

// Wholesale Invoice Payment Receipt - sent to customer when they pay online
interface WholesalePaymentReceiptParams {
  customerEmail: string;
  businessName: string;
  contactName: string;
  invoiceNumber: string;
  amount: number;
  paidAt: Date;
  items: { productName: string; quantity: number; unitPrice: string }[];
}

export async function sendWholesalePaymentReceipt(params: WholesalePaymentReceiptParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send payment receipt to:', params.customerEmail);
    console.log('[EMAIL] Invoice:', params.invoiceNumber, 'Amount:', params.amount);
    return;
  }

  const formattedDate = format(params.paidAt, 'MMMM d, yyyy \'at\' h:mm a');
  
  // Build items table
  const itemsHtml = params.items.map(item => {
    const lineTotal = parseFloat(item.unitPrice) * item.quantity;
    return `
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">${item.productName}</td>
        <td style="padding: 8px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: center; color: ${BRAND_COLORS.darkGrey};">${item.quantity}</td>
        <td style="padding: 8px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; color: ${BRAND_COLORS.darkGrey};">$${parseFloat(item.unitPrice).toFixed(2)}</td>
        <td style="padding: 8px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; color: ${BRAND_COLORS.darkGrey};">$${lineTotal.toFixed(2)}</td>
      </tr>
    `;
  }).join('');
  
  const itemsText = params.items.map(item => {
    const lineTotal = parseFloat(item.unitPrice) * item.quantity;
    return `- ${item.productName} x ${item.quantity} @ $${parseFloat(item.unitPrice).toFixed(2)} = $${lineTotal.toFixed(2)}`;
  }).join('\n');

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.customerEmail,
    subject: `Payment Receipt - Invoice ${params.invoiceNumber} - Puget Sound Kombucha Co.`,
    text: `
Payment Receipt

Thank you for your payment!

Invoice: ${params.invoiceNumber}
Amount Paid: $${params.amount.toFixed(2)}
Date: ${formattedDate}

Items:
${itemsText}

Total: $${params.amount.toFixed(2)}

This receipt confirms your payment has been successfully processed.

---
Puget Sound Kombucha Co.
4501 Shilshole Ave NW
Seattle, WA 98107
emily@soundkombucha.com
(206) 789-5219
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader('Payment Receipt')}
  
  <div style="padding: 32px 24px;">
    <p style="color: ${BRAND_COLORS.darkGrey}; font-size: 16px; margin: 0 0 24px 0;">
      Dear ${params.contactName},
    </p>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; font-size: 16px; margin: 0 0 24px 0;">
      Thank you for your payment! This email confirms that your payment has been successfully processed.
    </p>
    
    <div style="background-color: #dcfce7; border: 2px solid #16a34a; border-radius: 8px; padding: 20px; margin-bottom: 24px; text-align: center;">
      <p style="margin: 0; font-size: 14px; color: #166534; font-weight: bold;">PAYMENT CONFIRMED</p>
      <p style="margin: 8px 0 0 0; font-size: 28px; color: #166534; font-weight: bold;">$${params.amount.toFixed(2)}</p>
      <p style="margin: 8px 0 0 0; font-size: 12px; color: #166534;">${formattedDate}</p>
    </div>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      <tr>
        <td style="padding: 8px 0; color: ${BRAND_COLORS.mediumGrey}; width: 120px;">Invoice #</td>
        <td style="padding: 8px 0; color: ${BRAND_COLORS.darkGrey}; font-weight: 600;">${params.invoiceNumber}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: ${BRAND_COLORS.mediumGrey};">Business</td>
        <td style="padding: 8px 0; color: ${BRAND_COLORS.darkGrey};">${params.businessName}</td>
      </tr>
    </table>
    
    <h3 style="font-size: 14px; color: ${BRAND_COLORS.darkGrey}; margin: 24px 0 12px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; padding-bottom: 8px;">Order Details</h3>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      <thead>
        <tr style="background-color: ${BRAND_COLORS.backgroundGrey};">
          <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Item</th>
          <th style="padding: 10px 8px; text-align: center; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Qty</th>
          <th style="padding: 10px 8px; text-align: right; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Price</th>
          <th style="padding: 10px 8px; text-align: right; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>
    
    <div style="text-align: right; padding: 16px 0; border-top: 2px solid ${BRAND_COLORS.borderGrey};">
      <span style="font-size: 16px; color: ${BRAND_COLORS.darkGrey}; font-weight: bold;">Total Paid: $${params.amount.toFixed(2)}</span>
    </div>
    
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-radius: 4px; margin-top: 24px;">
      <p style="margin: 0; color: ${BRAND_COLORS.mediumGrey}; font-size: 14px;">
        Please keep this email for your records. If you have any questions about this payment, please contact us.
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
    console.log(`[EMAIL] ✅ Sent payment receipt to ${params.customerEmail} for invoice ${params.invoiceNumber}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send payment receipt:', error);
    throw error;
  }
}

// Wholesale Order Confirmation - sent to customer when order is placed
interface WholesaleOrderConfirmationParams {
  customerEmail: string;
  businessName: string;
  contactName: string;
  invoiceNumber: string;
  orderDate: Date;
  deliveryDate?: Date | null;
  dueDate?: Date | null;
  totalAmount: number;
  items: { productName: string; quantity: number; unitPrice: string }[];
  notes?: string | null;
}

export async function sendWholesaleOrderConfirmation(params: WholesaleOrderConfirmationParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send order confirmation to:', params.customerEmail);
    console.log('[EMAIL] Invoice:', params.invoiceNumber);
    return;
  }

  const orderDateFormatted = format(params.orderDate, 'MMMM d, yyyy');
  const deliveryDateFormatted = params.deliveryDate ? format(params.deliveryDate, 'MMMM d, yyyy') : null;
  const dueDateFormatted = params.dueDate ? format(params.dueDate, 'MMMM d, yyyy') : null;
  
  const itemsHtml = params.items.map(item => {
    const lineTotal = parseFloat(item.unitPrice) * item.quantity;
    return `
      <tr>
        <td style="padding: 10px 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">${item.productName}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: center; color: ${BRAND_COLORS.darkGrey};">${item.quantity}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; color: ${BRAND_COLORS.darkGrey};">$${parseFloat(item.unitPrice).toFixed(2)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; color: ${BRAND_COLORS.darkGrey};">$${lineTotal.toFixed(2)}</td>
      </tr>
    `;
  }).join('');
  
  const itemsText = params.items.map(item => {
    const lineTotal = parseFloat(item.unitPrice) * item.quantity;
    return `- ${item.productName} x ${item.quantity} @ $${parseFloat(item.unitPrice).toFixed(2)} = $${lineTotal.toFixed(2)}`;
  }).join('\n');

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.customerEmail,
    subject: `Order Confirmation - ${params.invoiceNumber} - Puget Sound Kombucha Co.`,
    text: `
Order Confirmation

Thank you for your order!

Invoice #: ${params.invoiceNumber}
Order Date: ${orderDateFormatted}
${deliveryDateFormatted ? `Delivery Date: ${deliveryDateFormatted}` : ''}
${dueDateFormatted ? `Payment Due: ${dueDateFormatted}` : ''}

Items:
${itemsText}

Total: $${params.totalAmount.toFixed(2)}
${params.notes ? `\nNotes: ${params.notes}` : ''}

HOW TO PAY${dueDateFormatted ? ` (due ${dueDateFormatted})` : ''}
Mail a check to: Puget Sound Kombucha Co., 1008 W Sherri Dr, Gilbert, AZ 85233
Or pay online by bank transfer — the link is on your invoice.

We will contact you to confirm delivery details.

---
Puget Sound Kombucha Co.
4501 Shilshole Ave NW
Seattle, WA 98107
emily@soundkombucha.com
(206) 789-5219
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader('Order Confirmation')}
  
  <div style="padding: 32px 24px;">
    <p style="color: ${BRAND_COLORS.darkGrey}; font-size: 16px; margin: 0 0 24px 0;">
      Dear ${params.contactName},
    </p>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; font-size: 16px; margin: 0 0 24px 0;">
      Thank you for your order! We've received your order and will contact you to confirm delivery details.
    </p>
    
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 6px 0; color: ${BRAND_COLORS.mediumGrey}; width: 120px;">Invoice #</td>
          <td style="padding: 6px 0; color: ${BRAND_COLORS.darkGrey}; font-weight: 600;">${params.invoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: ${BRAND_COLORS.mediumGrey};">Order Date</td>
          <td style="padding: 6px 0; color: ${BRAND_COLORS.darkGrey};">${orderDateFormatted}</td>
        </tr>
        ${deliveryDateFormatted ? `
        <tr>
          <td style="padding: 6px 0; color: ${BRAND_COLORS.mediumGrey};">Delivery Date</td>
          <td style="padding: 6px 0; color: ${BRAND_COLORS.darkGrey};">${deliveryDateFormatted}</td>
        </tr>
        ` : ''}
        ${dueDateFormatted ? `
        <tr>
          <td style="padding: 6px 0; color: ${BRAND_COLORS.mediumGrey};">Payment Due</td>
          <td style="padding: 6px 0; color: ${BRAND_COLORS.darkGrey}; font-weight: 600;">${dueDateFormatted}</td>
        </tr>
        ` : ''}
      </table>
    </div>
    
    <h3 style="font-size: 14px; color: ${BRAND_COLORS.darkGrey}; margin: 24px 0 12px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; padding-bottom: 8px;">Order Items</h3>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      <thead>
        <tr style="background-color: ${BRAND_COLORS.backgroundGrey};">
          <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Item</th>
          <th style="padding: 10px 8px; text-align: center; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Qty</th>
          <th style="padding: 10px 8px; text-align: right; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Price</th>
          <th style="padding: 10px 8px; text-align: right; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>
    
    <div style="text-align: right; padding: 16px 0; border-top: 2px solid ${BRAND_COLORS.borderGrey};">
      <span style="font-size: 18px; color: ${BRAND_COLORS.darkGrey}; font-weight: bold;">Total: $${params.totalAmount.toFixed(2)}</span>
    </div>
    
    ${params.notes ? `
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-radius: 4px; margin-top: 16px;">
      <p style="margin: 0; color: ${BRAND_COLORS.mediumGrey}; font-size: 12px; font-weight: bold;">ORDER NOTES</p>
      <p style="margin: 8px 0 0 0; color: ${BRAND_COLORS.darkGrey}; font-size: 14px;">${params.notes}</p>
    </div>
    ` : ''}
    
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-radius: 4px; margin-top: 16px;">
      <p style="margin: 0; color: ${BRAND_COLORS.mediumGrey}; font-size: 12px; font-weight: bold;">HOW TO PAY${dueDateFormatted ? ` &mdash; DUE ${dueDateFormatted.toUpperCase()}` : ''}</p>
      <p style="margin: 8px 0 0 0; color: ${BRAND_COLORS.darkGrey}; font-size: 14px;"><strong>Mail a check:</strong> Puget Sound Kombucha Co., 1008 W Sherri Dr, Gilbert, AZ 85233</p>
      <p style="margin: 6px 0 0 0; color: ${BRAND_COLORS.darkGrey}; font-size: 14px;"><strong>Or pay online</strong> by bank transfer &mdash; the link is on your invoice.</p>
    </div>

    <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 14px; margin: 24px 0 0 0;">
      If you have any questions about your order, please don't hesitate to contact us.
    </p>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: getLogoAttachment(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent order confirmation to ${params.customerEmail} for ${params.invoiceNumber}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send order confirmation:', error);
    throw error;
  }
}

// Wholesale Order Admin Notification - sent to admins when order is placed
interface WholesaleOrderAdminNotificationParams {
  adminEmails: string[];
  businessName: string;
  contactName: string;
  invoiceNumber: string;
  orderDate: Date;
  deliveryDate?: Date | null;
  totalAmount: number;
  items: { productName: string; quantity: number; unitPrice: string }[];
}

export async function sendWholesaleOrderAdminNotification(params: WholesaleOrderAdminNotificationParams): Promise<void> {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('[EMAIL] Would send order notification to admins');
    console.log('[EMAIL] Invoice:', params.invoiceNumber);
    return;
  }

  const orderDateFormatted = format(params.orderDate, 'MMMM d, yyyy \'at\' h:mm a');
  const deliveryDateFormatted = params.deliveryDate ? format(params.deliveryDate, 'MMMM d, yyyy') : 'Not specified';
  
  const itemsHtml = params.items.map(item => {
    const lineTotal = parseFloat(item.unitPrice) * item.quantity;
    return `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">${item.productName}</td>
        <td style="padding: 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: center; color: ${BRAND_COLORS.darkGrey};">${item.quantity}</td>
        <td style="padding: 8px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; color: ${BRAND_COLORS.darkGrey};">$${lineTotal.toFixed(2)}</td>
      </tr>
    `;
  }).join('');
  
  const itemsText = params.items.map(item => {
    const lineTotal = parseFloat(item.unitPrice) * item.quantity;
    return `- ${item.productName} x ${item.quantity} = $${lineTotal.toFixed(2)}`;
  }).join('\n');

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.adminEmails.join(', '),
    subject: `New Wholesale Order: ${params.invoiceNumber} - ${params.businessName} ($${params.totalAmount.toFixed(2)})`,
    text: `
New Wholesale Order

Invoice #: ${params.invoiceNumber}
Customer: ${params.businessName}
Contact: ${params.contactName}
Order Date: ${orderDateFormatted}
Delivery Date: ${deliveryDateFormatted}

Items:
${itemsText}

Total: $${params.totalAmount.toFixed(2)}

---
Puget Sound Kombucha Co.
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader('New Wholesale Order')}
  
  <div style="padding: 32px 24px;">
    <div style="background-color: #dbeafe; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
      <p style="margin: 0; font-size: 14px; color: #1e40af; font-weight: bold;">NEW ORDER RECEIVED</p>
      <p style="margin: 8px 0 0 0; font-size: 24px; color: #1e40af; font-weight: bold;">$${params.totalAmount.toFixed(2)}</p>
    </div>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.mediumGrey}; width: 120px;">Invoice #</td>
        <td style="padding: 10px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey}; font-weight: 600;">${params.invoiceNumber}</td>
      </tr>
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.mediumGrey};">Customer</td>
        <td style="padding: 10px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey}; font-weight: 600;">${params.businessName}</td>
      </tr>
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.mediumGrey};">Contact</td>
        <td style="padding: 10px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">${params.contactName}</td>
      </tr>
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.mediumGrey};">Order Date</td>
        <td style="padding: 10px 0; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; color: ${BRAND_COLORS.darkGrey};">${orderDateFormatted}</td>
      </tr>
      <tr>
        <td style="padding: 10px 0; color: ${BRAND_COLORS.mediumGrey};">Delivery</td>
        <td style="padding: 10px 0; color: ${BRAND_COLORS.darkGrey};">${deliveryDateFormatted}</td>
      </tr>
    </table>
    
    <h3 style="font-size: 14px; color: ${BRAND_COLORS.darkGrey}; margin: 0 0 12px 0;">Order Items</h3>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      <thead>
        <tr style="background-color: ${BRAND_COLORS.backgroundGrey};">
          <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Item</th>
          <th style="padding: 10px 8px; text-align: center; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Qty</th>
          <th style="padding: 10px 8px; text-align: right; font-size: 12px; color: ${BRAND_COLORS.mediumGrey};">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>
    
    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: getLogoAttachment(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent order notification to admins for ${params.invoiceNumber}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send order notification:', error);
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

export interface WholesaleInvoiceEmailParams {
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
  paidAt?: Date | null;
}

// PDF Layout Constants - Compact layout to fit on one page
const PDF_MARGIN = 40;
const PDF_WIDTH = 612; // Letter size
const PDF_CONTENT_WIDTH = PDF_WIDTH - (PDF_MARGIN * 2); // 532px usable
const LINE_HEIGHT = 12;
const SECTION_GAP = 12;
const LABEL_COLOR = '#666666';
const TEXT_COLOR = '#333333';
const HEADER_BG = '#f5f5f5';

// Helper: Render an address block, returns final Y position
function renderAddressBlock(
  doc: PDFKit.PDFDocument, 
  label: string, 
  lines: string[], 
  x: number, 
  y: number, 
  width: number
): number {
  let currentY = y;
  
  // Label
  doc.fontSize(8).font('Helvetica-Bold').fillColor(LABEL_COLOR);
  doc.text(label, x, currentY, { width });
  currentY += 11;
  
  // First line (business/location name) - bold
  if (lines.length > 0) {
    doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_COLOR);
    doc.text(lines[0], x, currentY, { width });
    currentY += 11;
  }
  
  // Remaining lines - regular
  doc.fontSize(8).font('Helvetica').fillColor(LABEL_COLOR);
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]) {
      doc.text(lines[i], x, currentY, { width });
      currentY += 10;
    }
  }
  
  return currentY;
}

// Generate PDF invoice buffer — laid out to match the Wave invoices customers have
// received for years (logo left, INVOICE right, remit address, meta rows, banded
// items table, Notes/Terms), with our extras kept: deliver-to, pay-online, PAID mark.
export async function generateInvoicePDF(params: WholesaleInvoiceEmailParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: PDF_MARGIN, size: 'LETTER' });
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    renderInvoicePage(doc, params);
    doc.end();
  });
}

// Draw one Wave-style invoice onto the CURRENT page of an existing document —
// shared by the emailed single-invoice PDF and the driver's delivery packet.
export function renderInvoicePage(doc: PDFKit.PDFDocument, params: WholesaleInvoiceEmailParams): void {
  {
    const RIGHT = PDF_WIDTH - PDF_MARGIN;
    const money = (n: number) => `$${n.toFixed(2)}`;

    // ===== PAID WATERMARK =====
    if (params.paidAt) {
      doc.save();
      doc.rotate(-30, { origin: [PDF_WIDTH / 2, 396] });
      doc.fontSize(110).font('Helvetica-Bold').fillColor('#16a34a').opacity(0.12);
      doc.text('PAID', 0, 340, { width: PDF_WIDTH, align: 'center' });
      doc.restore().opacity(1);
    }

    // ===== HEADER: logo left, INVOICE + company block right =====
    try {
      doc.image('attached_assets/invoice-logo.png', PDF_MARGIN, PDF_MARGIN, { width: 62 });
    } catch {
      doc.fontSize(13).font('Helvetica-Bold').fillColor(TEXT_COLOR)
        .text('Puget Sound Kombucha Co.', PDF_MARGIN, PDF_MARGIN);
    }
    doc.fontSize(26).font('Helvetica-Bold').fillColor(TEXT_COLOR);
    doc.text('INVOICE', PDF_MARGIN, PDF_MARGIN, { width: PDF_CONTENT_WIDTH, align: 'right' });

    let y = PDF_MARGIN + 34;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_COLOR);
    doc.text('Puget Sound Kombucha Co.', PDF_MARGIN, y, { width: PDF_CONTENT_WIDTH, align: 'right' });
    doc.font('Helvetica').fillColor(LABEL_COLOR);
    for (const line of ['Please remit checks to:', '1008 West Sherri Drive', 'Gilbert, Arizona 85233', 'United States', '(206) 789-5219', 'www.soundkombucha.com']) {
      y += 11;
      doc.text(line, PDF_MARGIN, y, { width: PDF_CONTENT_WIDTH, align: 'right' });
    }

    // ===== BILL TO (left) =====
    let leftY = PDF_MARGIN + 96;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(LABEL_COLOR).text('Bill to', PDF_MARGIN, leftY);
    leftY += 12;
    doc.font('Helvetica-Bold').fillColor(TEXT_COLOR).text(params.businessName, PDF_MARGIN, leftY, { width: 260 });
    leftY = doc.y + 1;
    doc.font('Helvetica').fillColor(LABEL_COLOR);
    for (const line of [params.customerAddress, params.contactName, params.customerEmail, params.customerPhone]) {
      if (line) { doc.text(line, PDF_MARGIN, leftY, { width: 260 }); leftY = doc.y + 1; }
    }
    if (params.location) {
      leftY += 6;
      doc.font('Helvetica-Bold').fillColor(LABEL_COLOR).text('Deliver to', PDF_MARGIN, leftY);
      leftY += 12;
      doc.font('Helvetica').fillColor(LABEL_COLOR);
      doc.text(`${params.location.locationName} — ${params.location.address}, ${params.location.city}, ${params.location.state} ${params.location.zipCode}`, PDF_MARGIN, leftY, { width: 300 });
      leftY = doc.y + 1;
    }

    // ===== META (right): number / dates / amount due =====
    const total = params.items.reduce((sum, it) => sum + Number(it.unitPrice) * it.quantity, 0);
    let metaY = Math.max(PDF_MARGIN + 118, y + 20);
    const metaRow = (label: string, value: string, bold = false) => {
      doc.fontSize(9).font('Helvetica').fillColor(LABEL_COLOR);
      doc.text(label, RIGHT - 260, metaY, { width: 150, align: 'right' });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(TEXT_COLOR);
      doc.text(value, RIGHT - 105, metaY, { width: 105, align: 'right' });
      metaY += 14;
    };
    metaRow('Invoice Number:', params.invoiceNumber);
    metaRow('Invoice Date:', format(params.orderDate, 'MMMM d, yyyy'));
    if (params.deliveryDate) metaRow('Delivery Date:', format(params.deliveryDate, 'MMMM d, yyyy'));
    if (params.dueDate) metaRow('Payment Due:', format(params.dueDate, 'MMMM d, yyyy'));
    doc.rect(RIGHT - 265, metaY - 3, 265, 18).fill(HEADER_BG);
    doc.fillColor(TEXT_COLOR);
    metaY += 1;
    metaRow('Amount Due (USD):', money(total), true);

    // ===== ITEMS TABLE =====
    let tableY = Math.max(leftY, metaY) + 24;
    const COL_QTY = RIGHT - 210, COL_PRICE = RIGHT - 140, COL_AMT = RIGHT - 70;
    doc.rect(PDF_MARGIN, tableY - 5, PDF_CONTENT_WIDTH, 19).fill(HEADER_BG);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_COLOR);
    doc.text('Items', PDF_MARGIN + 6, tableY);
    doc.text('Quantity', COL_QTY - 40, tableY, { width: 60, align: 'right' });
    doc.text('Price', COL_PRICE - 30, tableY, { width: 60, align: 'right' });
    doc.text('Amount', COL_AMT - 10, tableY, { width: 80, align: 'right' });
    tableY += 20;
    doc.font('Helvetica');
    for (const item of params.items) {
      doc.fillColor(TEXT_COLOR).text(item.productName, PDF_MARGIN + 6, tableY, { width: COL_QTY - PDF_MARGIN - 60 });
      const rowBottom = doc.y;
      doc.text(String(item.quantity), COL_QTY - 40, tableY, { width: 60, align: 'right' });
      doc.text(money(Number(item.unitPrice)), COL_PRICE - 30, tableY, { width: 60, align: 'right' });
      doc.text(money(Number(item.unitPrice) * item.quantity), COL_AMT - 10, tableY, { width: 80, align: 'right' });
      tableY = Math.max(rowBottom, doc.y) + 6;
      doc.moveTo(PDF_MARGIN, tableY - 3).lineTo(RIGHT, tableY - 3).lineWidth(0.5).strokeColor('#e5e5e5').stroke();
    }

    // ===== TOTALS =====
    tableY += 6;
    doc.fontSize(9).font('Helvetica').fillColor(LABEL_COLOR).text('Total:', COL_PRICE - 60, tableY, { width: 90, align: 'right' });
    doc.fillColor(TEXT_COLOR).text(money(total), COL_AMT - 10, tableY, { width: 80, align: 'right' });
    tableY += 16;
    doc.rect(COL_PRICE - 70, tableY - 4, RIGHT - (COL_PRICE - 70), 18).fill(HEADER_BG);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_COLOR);
    doc.text('Amount Due (USD):', COL_PRICE - 65, tableY, { width: 95, align: 'right' });
    doc.text(money(total), COL_AMT - 10, tableY, { width: 80, align: 'right' });

    // ===== NOTES / TERMS =====
    let notesY = tableY + 36;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(LABEL_COLOR).text('Notes / Terms', PDF_MARGIN, notesY);
    notesY += 13;
    doc.font('Helvetica').fillColor(TEXT_COLOR);
    doc.text('Thanks again! Let us know when you need more kombucha!', PDF_MARGIN, notesY, { width: PDF_CONTENT_WIDTH });
    notesY = doc.y + 4;
    if (params.notes) {
      doc.fillColor(LABEL_COLOR).text(params.notes, PDF_MARGIN, notesY, { width: PDF_CONTENT_WIDTH });
    }

    // ===== FOOTER: how to pay =====
    const footerY = doc.page.height - 60;
    doc.fontSize(8).fillColor(LABEL_COLOR);
    if (params.paidAt) {
      doc.text(`Paid on ${format(params.paidAt, 'MMM dd, yyyy')} - Thank you!`, PDF_MARGIN, footerY);
    } else if (params.allowOnlinePayment && params.paymentUrl) {
      doc.fillColor(TEXT_COLOR).text(`Pay online: ${params.paymentUrl} — or mail a check to the address above.`, PDF_MARGIN, footerY, { width: PDF_CONTENT_WIDTH, lineBreak: false });
    } else {
      doc.text('Payment Terms: Net 30 — please mail a check to the address above.', PDF_MARGIN, footerY, { width: PDF_CONTENT_WIDTH });
    }
  }
}

// Driver's delivery packet: page 1 is the route in drive order, then each stop's
// invoice on its own page — one print job hands the driver everything.
export async function generateDeliveryPacketPDF(input: {
  routeDate: Date;
  totalDistanceMeters?: number | null;
  totalDurationSeconds?: number | null;
  stops: Array<{ order: number; label: string; address: string; arrival?: Date | null; invoiceNumber?: string | null; totalAmount?: string | null; notes?: string | null; paid?: boolean }>;
  // Aggregated across all deliveries (real products only, no invoice adjustments) —
  // what to load on the truck.
  packingList: Array<{ productName: string; quantity: number }>;
  invoices: WholesaleInvoiceEmailParams[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: PDF_MARGIN, size: 'LETTER' });
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ===== PAGE 1: THE ROUTE =====
    try {
      doc.image('attached_assets/invoice-logo.png', PDF_MARGIN, PDF_MARGIN, { width: 48 });
    } catch { /* wordmark below carries it */ }
    doc.fontSize(22).font('Helvetica-Bold').fillColor(TEXT_COLOR);
    doc.text('Delivery Route', PDF_MARGIN, PDF_MARGIN + 4, { width: PDF_CONTENT_WIDTH, align: 'right' });
    doc.fontSize(11).font('Helvetica').fillColor(LABEL_COLOR);
    doc.text(format(input.routeDate, 'EEEE, MMMM d, yyyy'), PDF_MARGIN, PDF_MARGIN + 32, { width: PDF_CONTENT_WIDTH, align: 'right' });

    const miles = input.totalDistanceMeters ? (input.totalDistanceMeters / 1609.34).toFixed(1) + ' mi' : null;
    const mins = input.totalDurationSeconds ? Math.round(input.totalDurationSeconds / 60) : null;
    const duration = mins != null ? (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`) : null;
    const summary = [`${input.stops.length} stops`, miles, duration ? `about ${duration} driving` : null].filter(Boolean).join('  ·  ');
    doc.text(summary, PDF_MARGIN, PDF_MARGIN + 46, { width: PDF_CONTENT_WIDTH, align: 'right' });

    let y = PDF_MARGIN + 78;
    doc.moveTo(PDF_MARGIN, y).lineTo(PDF_WIDTH - PDF_MARGIN, y).lineWidth(1).strokeColor('#dddddd').stroke();
    y += 12;

    for (const stop of input.stops) {
      if (y > doc.page.height - 90) { doc.addPage(); y = PDF_MARGIN; }
      doc.fontSize(11).font('Helvetica-Bold').fillColor(TEXT_COLOR);
      doc.text(`${stop.order}.  ${stop.label}`, PDF_MARGIN, y, { width: PDF_CONTENT_WIDTH - 110 });
      if (stop.arrival) {
        doc.fontSize(10).font('Helvetica').fillColor(LABEL_COLOR);
        doc.text(`ETA ${format(stop.arrival, 'h:mm a')}`, PDF_WIDTH - PDF_MARGIN - 100, y, { width: 100, align: 'right' });
      }
      y = doc.y + 2;
      doc.fontSize(9).font('Helvetica').fillColor(LABEL_COLOR);
      if (stop.address) { doc.text(stop.address, PDF_MARGIN + 18, y, { width: PDF_CONTENT_WIDTH - 18 }); y = doc.y + 1; }
      const bits = [
        stop.invoiceNumber ? `${stop.invoiceNumber} · $${Number(stop.totalAmount ?? 0).toFixed(2)}${stop.paid ? ' · PAID' : ''}` : null,
        stop.notes ? `Note: ${stop.notes}` : null,
      ].filter(Boolean);
      if (bits.length) { doc.fillColor(TEXT_COLOR).text(bits.join('   —   '), PDF_MARGIN + 18, y, { width: PDF_CONTENT_WIDTH - 18 }); y = doc.y + 1; }
      y += 7;
      doc.moveTo(PDF_MARGIN, y).lineTo(PDF_WIDTH - PDF_MARGIN, y).lineWidth(0.5).strokeColor('#eeeeee').stroke();
      y += 10;
    }

    // ===== PACKING LIST: what to load on the truck =====
    if (input.packingList.length > 0) {
      doc.addPage();
      doc.fontSize(22).font('Helvetica-Bold').fillColor(TEXT_COLOR);
      doc.text('Packing List', PDF_MARGIN, PDF_MARGIN);
      doc.fontSize(10).font('Helvetica').fillColor(LABEL_COLOR);
      doc.text(`Everything across all ${input.invoices.length} deliveries on ${format(input.routeDate, 'MMMM d')}`, PDF_MARGIN, PDF_MARGIN + 28);

      let py = PDF_MARGIN + 56;
      doc.rect(PDF_MARGIN, py - 5, PDF_CONTENT_WIDTH, 19).fill(HEADER_BG);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXT_COLOR);
      doc.text('Product', PDF_MARGIN + 6, py);
      doc.text('Total', PDF_WIDTH - PDF_MARGIN - 80, py, { width: 74, align: 'right' });
      py += 22;
      doc.fontSize(11).font('Helvetica');
      let grandTotal = 0;
      for (const line of input.packingList) {
        if (py > doc.page.height - 70) { doc.addPage(); py = PDF_MARGIN; }
        doc.fillColor(TEXT_COLOR).text(line.productName, PDF_MARGIN + 6, py, { width: PDF_CONTENT_WIDTH - 110 });
        doc.text(String(line.quantity), PDF_WIDTH - PDF_MARGIN - 80, py, { width: 74, align: 'right' });
        grandTotal += line.quantity;
        py = doc.y + 5;
        doc.moveTo(PDF_MARGIN, py - 2).lineTo(PDF_WIDTH - PDF_MARGIN, py - 2).lineWidth(0.5).strokeColor('#eeeeee').stroke();
        py += 4;
      }
      py += 4;
      doc.font('Helvetica-Bold').fillColor(TEXT_COLOR);
      doc.text('Total units', PDF_MARGIN + 6, py);
      doc.text(String(grandTotal), PDF_WIDTH - PDF_MARGIN - 80, py, { width: 74, align: 'right' });
    }

    // ===== INVOICES, IN DRIVE ORDER =====
    for (const inv of input.invoices) {
      doc.addPage();
      renderInvoicePage(doc, inv);
    }

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

  // Payment link section - hide if invoice is already paid
  const paidDateFormatted = params.paidAt ? format(params.paidAt, 'MMM dd, yyyy') : null;
  
  const paymentHtml = params.paidAt ? `
    <div style="background-color: #dcfce7; padding: 16px; border-radius: 4px; margin: 24px 0; text-align: center;">
      <p style="margin: 0; color: #166534; font-weight: 600; font-size: 16px;">PAID - ${paidDateFormatted}</p>
      <p style="margin: 8px 0 0 0; color: #166534; font-size: 14px;">Thank you for your payment!</p>
    </div>
  ` : params.allowOnlinePayment && params.paymentUrl ? `
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
        Pay by Bank Transfer
      </a>
    </div>
    <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 14px; text-align: center; margin: 0;">
      Or copy this link: <a href="${params.paymentUrl}" style="color: ${BRAND_COLORS.darkGrey};">${params.paymentUrl}</a>
    </p>
    <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 13px; text-align: center; margin: 12px 0 0 0;">
      Bank transfers take 4&ndash;5 business days to clear.
    </p>
    <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 13px; text-align: center; margin: 8px 0 0 0;">
      Prefer to mail a check? Puget Sound Kombucha Co., 1008 W Sherri Dr, Gilbert, AZ 85233
    </p>
  ` : `
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-radius: 4px; margin: 24px 0;">
      <p style="margin: 0; color: ${BRAND_COLORS.darkGrey};"><strong>Payment Terms:</strong> Net 30</p>
      <p style="margin: 8px 0 0 0; color: ${BRAND_COLORS.mediumGrey}; font-size: 14px;">Mail checks to: Puget Sound Kombucha Co., 1008 W Sherri Dr, Gilbert, AZ 85233</p>
    </div>
  `;

  const paymentText = params.paidAt 
    ? `\nPAID - ${paidDateFormatted}\nThank you for your payment!\n`
    : params.allowOnlinePayment && params.paymentUrl
      ? `\nPay by bank transfer: ${params.paymentUrl}\n(Bank transfers take 4-5 business days to clear.)\nOr mail a check to: Puget Sound Kombucha Co., 1008 W Sherri Dr, Gilbert, AZ 85233\n`
      : '\nPayment Terms: Net 30\nMail checks to: Puget Sound Kombucha Co., 1008 W Sherri Dr, Gilbert, AZ 85233\n';

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

// Admin email for notifications
const ADMIN_EMAIL = 'emily@soundkombucha.com';

/**
 * Send data retention cleanup notification to admin
 */
export async function sendDataRetentionNotification(params: {
  emailCodesDeleted: number;
  smsCodesDeleted: number;
  consumedEmailCodesDeleted: number;
  consumedSmsCodesDeleted: number;
}): Promise<void> {
  const transporter = createTransporter();
  if (!transporter) {
    console.log('[EMAIL] Skipping data retention notification - email not configured');
    return;
  }

  const totalDeleted = params.emailCodesDeleted + params.smsCodesDeleted + 
                       params.consumedEmailCodesDeleted + params.consumedSmsCodesDeleted;

  if (totalDeleted === 0) {
    return; // No notification needed if nothing was deleted
  }

  const timestamp = format(new Date(), 'MMMM d, yyyy h:mm a');

  const mailOptions = {
    from: `"Puget Sound Kombucha Co." <${process.env.GMAIL_USER}>`,
    to: ADMIN_EMAIL,
    subject: `[Data Retention] ${totalDeleted} expired records cleaned up`,
    text: `
Data Retention Cleanup Report
${timestamp}

The automated data retention job has cleaned up the following expired records:

- Expired email verification codes: ${params.emailCodesDeleted}
- Expired SMS verification codes: ${params.smsCodesDeleted}
- Consumed email verification codes: ${params.consumedEmailCodesDeleted}
- Consumed SMS verification codes: ${params.consumedSmsCodesDeleted}

Total records deleted: ${totalDeleted}

These are temporary security tokens that have expired per our data retention policy (24 hours for unused codes, 1 hour for consumed codes).

No customer data, orders, or business records were affected.

---
Puget Sound Kombucha Co.
Automated System Notification
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader('Data Retention Report')}
  
  <div style="padding: 32px 24px;">
    <p style="color: ${BRAND_COLORS.mediumGrey}; margin: 0 0 24px 0; font-size: 14px;">
      ${timestamp}
    </p>
    
    <p style="color: ${BRAND_COLORS.darkGrey}; margin: 0 0 16px 0;">
      The automated data retention job has cleaned up the following expired records:
    </p>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr style="background-color: ${BRAND_COLORS.backgroundGrey};">
        <td style="padding: 12px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey};">Expired email verification codes</td>
        <td style="padding: 12px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; font-weight: bold;">${params.emailCodesDeleted}</td>
      </tr>
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey};">Expired SMS verification codes</td>
        <td style="padding: 12px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; font-weight: bold;">${params.smsCodesDeleted}</td>
      </tr>
      <tr style="background-color: ${BRAND_COLORS.backgroundGrey};">
        <td style="padding: 12px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey};">Consumed email verification codes</td>
        <td style="padding: 12px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; font-weight: bold;">${params.consumedEmailCodesDeleted}</td>
      </tr>
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey};">Consumed SMS verification codes</td>
        <td style="padding: 12px; border-bottom: 1px solid ${BRAND_COLORS.borderGrey}; text-align: right; font-weight: bold;">${params.consumedSmsCodesDeleted}</td>
      </tr>
      <tr style="background-color: ${BRAND_COLORS.black}; color: ${BRAND_COLORS.white};">
        <td style="padding: 12px; font-weight: bold;">Total records deleted</td>
        <td style="padding: 12px; text-align: right; font-weight: bold;">${totalDeleted}</td>
      </tr>
    </table>
    
    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-radius: 4px; border-left: 4px solid ${BRAND_COLORS.mediumGrey};">
      <p style="margin: 0; color: ${BRAND_COLORS.mediumGrey}; font-size: 14px;">
        These are temporary security tokens that have expired per our data retention policy (24 hours for unused codes, 1 hour for consumed codes). No customer data, orders, or business records were affected.
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
    console.log(`[EMAIL] ✅ Sent data retention notification to admin`);
  } catch (error) {
    console.error('[EMAIL] Failed to send data retention notification:', error);
  }
}

interface WholesaleWelcomeParams {
  email: string;
  businessName: string;
  contactName: string;
  /** Durable login-page URL — deliberately NOT a magic link, which would be dead in 15 minutes. */
  loginUrl: string;
  /** True when the applicant already had an account: same email, different framing. */
  alreadyExisted: boolean;
}

/**
 * Sent when a wholesale application is auto-provisioned into an account (or when the
 * applicant already had one). This closes the loop that used to dead-end: applications
 * previously sat as CRM leads until someone manually created the account AND manually
 * told the customer — now the account exists immediately and this email says so.
 *
 * Links to the login page rather than embedding a magic link: welcome emails get read
 * hours or days later, and a one-shot 15-minute token would greet most readers with
 * "link expired". From the login page a fresh link is one email-entry away.
 */
export async function sendWholesaleWelcomeEmail(params: WholesaleWelcomeParams): Promise<void> {
  const transporter = createTransporter();
  // Same prod-only gate as the other wholesale emails — dev/test hold real addresses.
  if (process.env.WHOLESALE_APPROVAL_EMAILS !== 'true') {
    console.log(`[EMAIL] (not sent — WHOLESALE_APPROVAL_EMAILS is not true) wholesale welcome to ${params.email}`);
    return;
  }

  const heading = params.alreadyExisted ? 'You already have an account' : 'Your wholesale account is ready';
  const intro = params.alreadyExisted
    ? `Thanks for reaching out — good news: ${params.businessName} already has a wholesale account with us.`
    : `Welcome aboard! Your wholesale account for ${params.businessName} is set up and ready to order.`;

  if (!transporter) {
    console.log('[EMAIL] Would send wholesale welcome email to:', params.email);
    console.log('[EMAIL] Login URL:', params.loginUrl, params.alreadyExisted ? '(existing account)' : '(new account)');
    return;
  }

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.email,
    subject: `${heading} - Puget Sound Kombucha Co.`,
    text: `
Hi ${params.contactName},

${intro}

Order online any time — no password, no account setup:
${params.loginUrl}

How ordering works:
- Type your store name on that page, pick your location, build the order.
- Choose delivery to your address or pickup at the brewery.
- Billing contacts can also sign in with just their email to see order history and invoices.

Questions? Just reply to this email or call ${'(206) 789-5219'}.

Thank you,
Puget Sound Kombucha Co.
    `.trim(),
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: ${BRAND_COLORS.white};">
  ${getEmailHeader(heading)}

  <div style="padding: 32px 24px;">
    <p style="color: ${BRAND_COLORS.black}; font-size: 16px;">Hi ${params.contactName},</p>
    <p style="color: ${BRAND_COLORS.black}; font-size: 16px;">${intro}</p>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${params.loginUrl}"
         style="display: inline-block;
                background-color: ${BRAND_COLORS.black};
                color: ${BRAND_COLORS.white};
                padding: 16px 32px;
                border-radius: 8px;
                font-size: 16px;
                font-weight: bold;
                text-decoration: none;">
        Place an order
      </a>
    </div>

    <p style="color: ${BRAND_COLORS.mediumGrey}; font-size: 14px; text-align: center;">
      No password, no account setup — type your store name and order.
    </p>

    <div style="background-color: ${BRAND_COLORS.backgroundGrey}; padding: 16px; border-radius: 8px; margin-top: 24px;">
      <p style="margin: 0 0 8px 0; color: ${BRAND_COLORS.black}; font-weight: 600;">How ordering works</p>
      <ul style="margin: 0; padding-left: 18px; color: ${BRAND_COLORS.darkGrey}; font-size: 14px; line-height: 1.7;">
        <li>Type your store name, pick your location, build the order.</li>
        <li>Delivery to your address, or pickup at the brewery.</li>
        <li>Billing contacts can sign in with just their email for order history and invoices.</li>
      </ul>
    </div>

    ${getEmailFooter()}
  </div>
</div>
    `.trim(),
    attachments: getLogoAttachment(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('[EMAIL] Wholesale welcome email sent to:', params.email);
  } catch (error) {
    console.error('[EMAIL] Failed to send wholesale welcome email:', error);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------
// Claim-your-store: "you're connected" — the one automatic wholesale email besides order
// confirmations. Gated on WHOLESALE_APPROVAL_EMAILS=true so it can only fire where that
// is deliberately set (production). Dev and test databases carry real customer addresses;
// without the flag this logs what it would have sent and returns.
// ---------------------------------------------------------------------------------------
interface WholesaleContactApprovedParams {
  to: string;
  businessName: string;
  orderPlaced: boolean;
  portalUrl: string;
}

export function wholesaleApprovalEmailsEnabled(): boolean {
  return process.env.WHOLESALE_APPROVAL_EMAILS === 'true';
}

export async function sendWholesaleContactApprovedEmail(params: WholesaleContactApprovedParams): Promise<void> {
  const transporter = createTransporter();
  if (!wholesaleApprovalEmailsEnabled() || !transporter) {
    console.log(`[EMAIL] (not sent — ${!wholesaleApprovalEmailsEnabled() ? 'WHOLESALE_APPROVAL_EMAILS is not true' : 'mail not configured'}) approval email to ${params.to} for ${params.businessName}`);
    return;
  }
  const orderLine = params.orderPlaced
    ? `<p style="margin: 0 0 16px; color: ${BRAND_COLORS.darkGrey};">The order you built while you were waiting has been placed — you'll get a separate confirmation for it.</p>`
    : '';
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.to,
    subject: `You're connected to ${params.businessName}`,
    text: `You're connected to ${params.businessName} on Puget Sound Kombucha's wholesale site.\n\n${params.orderPlaced ? 'The order you built while waiting has been placed; a separate confirmation is on its way.\n\n' : ''}Order any time: ${params.portalUrl}\nSign in with just this email — no password.`,
    html: `
<!DOCTYPE html>
<html><body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:${BRAND_COLORS.backgroundGrey};">
  <div style="max-width:600px; margin:0 auto; background:${BRAND_COLORS.white};">
    ${getEmailHeader("You're connected")}
    <div style="padding: 32px 24px;">
      <p style="margin: 0 0 16px; color: ${BRAND_COLORS.darkGrey}; font-size: 16px;">You're now a contact on <strong>${params.businessName}</strong> and can order for the store.</p>
      ${orderLine}
      <p style="margin: 0 0 24px; color: ${BRAND_COLORS.darkGrey};">Sign in with just this email address — no password — and you'll stay signed in on your device for 30 days.</p>
      <p style="margin: 0 0 24px;"><a href="${params.portalUrl}" style="display:inline-block; background:${BRAND_COLORS.black}; color:${BRAND_COLORS.white}; text-decoration:none; padding: 12px 22px; border-radius: 6px; font-weight: 600;">Order online</a></p>
      ${getEmailFooter()}
    </div>
  </div>
</body></html>`,
    attachments: getLogoAttachment(),
  };
  await transporter.sendMail(mailOptions);
  console.log(`[EMAIL] Approval email sent to ${params.to} for ${params.businessName}`);
}

// ---------------------------------------------------------------------------------------
// Retail welcome: "you've been added to our new ordering system" + a set-password link.
// Sent when staff add a customer (or press Send welcome on one) — never automatically on
// import. Gated on RETAIL_WELCOME_EMAILS=true, set only in production: dev and test
// databases hold real customer addresses.
// ---------------------------------------------------------------------------------------
export function retailWelcomeEmailsEnabled(): boolean {
  return process.env.RETAIL_WELCOME_EMAILS === 'true';
}

// Migration email for the handful of subscribers carried over from Shopify: their
// subscription moved, but the card could not — this asks for it, with their real
// cadence, items, and first-charge deadline. Same prod-only gate as the welcome.
export async function sendSubscriberMigrationEmail(params: { to: string; name: string; setPasswordUrl: string; cadence: string; items: string; deadline: string }): Promise<void> {
  const transporter = createTransporter();
  if (!retailWelcomeEmailsEnabled() || !transporter) {
    console.log(`[EMAIL] (not sent — ${!retailWelcomeEmailsEnabled() ? 'RETAIL_WELCOME_EMAILS is not true' : 'mail not configured'}) subscriber migration to ${params.to}`);
    return;
  }
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.to,
    subject: 'Your kombucha subscription moved — one quick step',
    text: `Hi ${params.name},

We've moved off Shopify onto our own ordering site, and your ${params.cadence.toLowerCase()} subscription (${params.items}) came with us — same price, same cadence, same pickup.

One thing needs redoing: your card. Shopify couldn't hand it over, so —

1. Set your password (link good for 7 days):
${params.setPasswordUrl}

2. In My Account, tap "Manage Payment Method" and add your card.

Please do this before ${params.deadline} so your next case isn't interrupted. Your old Shopify subscription is cancelled — you won't be charged twice.

Thank you for sticking with us,
Puget Sound Kombucha Co.`,
    html: `
<!DOCTYPE html>
<html><body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:${BRAND_COLORS.backgroundGrey};">
  <div style="max-width:600px; margin:0 auto; background:${BRAND_COLORS.white};">
    ${getEmailHeader('Your subscription moved with us')}
    <div style="padding: 32px 24px;">
      <p style="margin: 0 0 16px; color: ${BRAND_COLORS.darkGrey}; font-size: 16px;">Hi ${params.name},</p>
      <p style="margin: 0 0 16px; color: ${BRAND_COLORS.darkGrey};">We've moved off Shopify onto our own ordering site, and your ${params.cadence.toLowerCase()} subscription (${params.items}) came with us — same price, same cadence, same pickup.</p>
      <p style="margin: 0 0 16px; color: ${BRAND_COLORS.darkGrey};">One thing needs redoing: your card. Shopify couldn't hand it over, so —</p>
      <p style="margin: 0 0 8px; color: ${BRAND_COLORS.darkGrey};"><strong>1.</strong> Set your password (link good for 7 days):</p>
      <p style="margin: 0 0 16px;"><a href="${params.setPasswordUrl}" style="display:inline-block; background:${BRAND_COLORS.black}; color:${BRAND_COLORS.white}; text-decoration:none; padding: 12px 22px; border-radius: 6px; font-weight: 600;">Set your password</a></p>
      <p style="margin: 0 0 16px; color: ${BRAND_COLORS.darkGrey};"><strong>2.</strong> In My Account, tap <strong>Manage Payment Method</strong> and add your card.</p>
      <p style="margin: 0 0 16px; color: ${BRAND_COLORS.darkGrey};">Please do this <strong>before ${params.deadline}</strong> so your next case isn't interrupted. Your old Shopify subscription is cancelled — you won't be charged twice.</p>
      <p style="margin: 0 0 8px; color: ${BRAND_COLORS.darkGrey};">Thank you for sticking with us,</p>
      ${getEmailFooter()}
    </div>
  </div>
</body></html>`,
    attachments: getLogoAttachment(),
  };
  await transporter.sendMail(mailOptions);
}

// Staff invite: same 7-day set-password link as the retail welcome, staff wording.
// Gated by the same prod-only flag so dev/test never email real addresses.
export async function sendStaffInviteEmail(params: { to: string; name: string; setPasswordUrl: string; role: string }): Promise<void> {
  const transporter = createTransporter();
  if (!retailWelcomeEmailsEnabled() || !transporter) {
    console.log(`[EMAIL] (not sent — ${!retailWelcomeEmailsEnabled() ? 'RETAIL_WELCOME_EMAILS is not true' : 'mail not configured'}) staff invite to ${params.to}`);
    return;
  }
  const roleLabel = params.role === 'admin' ? 'an admin' : 'a staff';
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.to,
    subject: "You're on the Puget Sound Kombucha staff portal",
    text: `Hi ${params.name},

You've been added as ${roleLabel} user on the Puget Sound Kombucha portal. Set a password here (link is good for 7 days):
${params.setPasswordUrl}

Then sign in at ${process.env.APP_URL || ''}/staff/login for orders, deliveries, the weekly checklist, and the rest of the portal.

Thank you,
Puget Sound Kombucha Co.`,
    html: `
<!DOCTYPE html>
<html><body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:${BRAND_COLORS.backgroundGrey};">
  <div style="max-width:600px; margin:0 auto; background:${BRAND_COLORS.white};">
    ${getEmailHeader('Welcome to the team portal')}
    <div style="padding: 32px 24px;">
      <p style="margin: 0 0 16px; color: ${BRAND_COLORS.darkGrey}; font-size: 16px;">Hi ${params.name},</p>
      <p style="margin: 0 0 16px; color: ${BRAND_COLORS.darkGrey};">You've been added as ${roleLabel} user on the Puget Sound Kombucha portal. Set a password to get started — the link is good for 7 days.</p>
      <p style="margin: 0 0 24px;"><a href="${params.setPasswordUrl}" style="display:inline-block; background:${BRAND_COLORS.black}; color:${BRAND_COLORS.white}; text-decoration:none; padding: 12px 22px; border-radius: 6px; font-weight: 600;">Set your password</a></p>
      <p style="margin: 0 0 8px; color: ${BRAND_COLORS.darkGrey};">Then sign in at the staff portal for orders, deliveries, and the weekly checklist.</p>
      ${getEmailFooter()}
    </div>
  </div>
</body></html>`,
    attachments: getLogoAttachment(),
  };
  await transporter.sendMail(mailOptions);
}

export async function sendRetailWelcomeEmail(params: { to: string; name: string; setPasswordUrl: string }): Promise<void> {
  const transporter = createTransporter();
  if (!retailWelcomeEmailsEnabled() || !transporter) {
    console.log(`[EMAIL] (not sent — ${!retailWelcomeEmailsEnabled() ? 'RETAIL_WELCOME_EMAILS is not true' : 'mail not configured'}) retail welcome to ${params.to}`);
    return;
  }
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: params.to,
    subject: 'Kombucha ordering has a new home',
    text: `Hi ${params.name},

We've moved our online ordering off Shopify and onto our own site. Your account came along — same email, and your order history with us starts fresh.

Set your password here (the link is good for 7 days):
${params.setPasswordUrl}

Then order 12-packs and kegs for pickup at the brewery in Ballard, or set up Subscribe & Save and skip the reordering entirely.

Nothing else changes — same kombucha, same people, same place.

Thank you,
Puget Sound Kombucha Co.`,
    html: `
<!DOCTYPE html>
<html><body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:${BRAND_COLORS.backgroundGrey};">
  <div style="max-width:600px; margin:0 auto; background:${BRAND_COLORS.white};">
    ${getEmailHeader('Your account is ready')}
    <div style="padding: 32px 24px;">
      <p style="margin: 0 0 16px; color: ${BRAND_COLORS.darkGrey}; font-size: 16px;">Hi ${params.name},</p>
      <p style="margin: 0 0 16px; color: ${BRAND_COLORS.darkGrey};">We've moved our online ordering off Shopify and onto our own site. Your account came along — same email, and your order history with us starts fresh. Set a password to get started — the link is good for 7 days.</p>
      <p style="margin: 0 0 24px;"><a href="${params.setPasswordUrl}" style="display:inline-block; background:${BRAND_COLORS.black}; color:${BRAND_COLORS.white}; text-decoration:none; padding: 12px 22px; border-radius: 6px; font-weight: 600;">Set your password</a></p>
      <p style="margin: 0 0 8px; color: ${BRAND_COLORS.darkGrey};">Then order 12-packs and kegs for pickup at the brewery in Ballard, or set up Subscribe &amp; Save and skip the reordering entirely.</p>
      <p style="margin: 0 0 8px; color: ${BRAND_COLORS.darkGrey};">Nothing else changes — same kombucha, same people, same place.</p>
      ${getEmailFooter()}
    </div>
  </div>
</body></html>`,
    attachments: getLogoAttachment(),
  };
  await transporter.sendMail(mailOptions);
  console.log(`[EMAIL] Retail welcome sent to ${params.to}`);
}
