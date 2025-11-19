import nodemailer from 'nodemailer';

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
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2>Payment Issue with Your Kombucha Subscription</h2>
  
  <p>Hi ${params.customerName},</p>
  
  <p>We were unable to process your subscription payment for the following items:</p>
  
  <ul style="margin: 20px 0;">
    ${params.subscriptionItems.map(item => 
      `<li>${item.productName} (${item.quantity} case${item.quantity > 1 ? 's' : ''})</li>`
    ).join('')}
  </ul>
  
  <p><strong>Amount:</strong> $${params.amount.toFixed(2)}</p>
  <p><strong>Reason:</strong> ${params.errorMessage}</p>
  
  <p>Please update your payment method or contact us at your earliest convenience to ensure uninterrupted service.</p>
  
  <p>Thank you,<br>Puget Sound Kombucha Co.</p>
</div>
    `.trim(),
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
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #dc2626;">Subscription Payment Failure</h2>
  
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>Customer:</strong></td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${params.customerName}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>Email:</strong></td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${params.customerEmail}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>Amount:</strong></td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">$${params.amount.toFixed(2)}</td>
    </tr>
  </table>
  
  <h3>Items:</h3>
  <ul>
    ${params.subscriptionItems.map(item => 
      `<li>${item.productName} (${item.quantity} case${item.quantity > 1 ? 's' : ''})</li>`
    ).join('')}
  </ul>
  
  <p><strong>Error:</strong> ${params.errorMessage}</p>
  
  <p style="background: #fef2f2; padding: 12px; border-left: 4px solid #dc2626; margin-top: 20px;">
    <strong>Action Required:</strong> Follow up with customer regarding payment issue.
  </p>
</div>
    `.trim(),
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
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2>Your Verification Code</h2>
  
  <div style="text-align: center; margin: 30px 0;">
    <div style="background-color: #f3f4f6; 
                padding: 20px; 
                border-radius: 8px; 
                font-size: 32px; 
                font-weight: bold; 
                letter-spacing: 8px; 
                color: #16a34a;">
      ${params.code}
    </div>
  </div>
  
  <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
    This code will expire in 5 minutes.
  </p>
  
  <p style="color: #6b7280; font-size: 14px;">
    If you didn't request this code, you can safely ignore this email.
  </p>
  
  <p style="margin-top: 30px;">Thank you,<br>Puget Sound Kombucha Co.</p>
</div>
    `.trim(),
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
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2>Reset Your Password</h2>
  
  <p>Hi ${params.name},</p>
  
  <p>We received a request to reset your password. Click the button below to set a new password:</p>
  
  <div style="text-align: center; margin: 30px 0;">
    <a href="${params.resetUrl}" 
       style="background-color: #16a34a; 
              color: white; 
              padding: 12px 24px; 
              text-decoration: none; 
              border-radius: 6px; 
              display: inline-block;
              font-weight: 500;">
      Reset Password
    </a>
  </div>
  
  <p style="color: #6b7280; font-size: 14px;">
    Or copy and paste this link into your browser:<br>
    <a href="${params.resetUrl}" style="color: #16a34a;">${params.resetUrl}</a>
  </p>
  
  <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
    This link will expire in 1 hour.
  </p>
  
  <p style="color: #6b7280; font-size: 14px;">
    If you didn't request a password reset, you can safely ignore this email.
  </p>
  
  <p style="margin-top: 30px;">Thank you,<br>Puget Sound Kombucha Co.</p>
</div>
    `.trim(),
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
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background-color: #16a34a; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 24px;">Order Confirmation</h1>
  </div>
  
  <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
    <p>Hi ${params.customerName},</p>
    
    <p>Thank you for your ${params.orderType === 'subscription' ? 'subscription' : 'order'}! Here's your receipt:</p>
    
    <div style="background-color: #f9fafb; padding: 16px; border-radius: 6px; margin: 20px 0;">
      <p style="margin: 0; font-weight: bold;">Order Number: ${params.orderNumber}</p>
    </div>
    
    <h2 style="font-size: 18px; margin-top: 24px;">Order Items</h2>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      ${params.orderItems.map(item => `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${item.productName}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity} case${item.quantity > 1 ? 's' : ''}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${item.unitPrice}</td>
        </tr>
      `).join('')}
    </table>
    
    <div style="text-align: right; margin-top: 20px;">
      <p style="margin: 4px 0;">Subtotal: <strong>$${params.subtotal.toFixed(2)}</strong></p>
      ${params.taxAmount ? `<p style="margin: 4px 0;">Sales Tax: <strong>$${params.taxAmount.toFixed(2)}</strong></p>` : ''}
      <p style="margin: 4px 0; font-size: 18px; color: #16a34a;">Total: <strong>$${params.total.toFixed(2)}</strong></p>
    </div>
    
    <div style="background-color: #ecfdf5; padding: 16px; border-left: 4px solid #16a34a; margin-top: 24px; border-radius: 4px;">
      <p style="margin: 0;">
        ${params.orderType === 'subscription' 
          ? 'Your subscription is now active. You will receive your first pickup notification soon.'
          : 'Your order will be ready for pickup soon. We will notify you when it\'s ready.'}
      </p>
    </div>
    
    <p style="margin-top: 32px;">Thank you for choosing Puget Sound Kombucha Co.!</p>
    <p>Best regards,<br>Puget Sound Kombucha Co.</p>
  </div>
</div>
    `.trim(),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] ✅ Sent order receipt to ${params.customerEmail} for order ${params.orderNumber}`);
  } catch (error) {
    console.error('[EMAIL] Failed to send order receipt email:', error);
    throw error;
  }
}
