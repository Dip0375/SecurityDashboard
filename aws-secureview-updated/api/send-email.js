/**
 * api/send-email.js  (Vercel Serverless Function)
 * ──────────────────────────────────────────────────────────────────────────────
 * Sends email notifications for user events (welcome, alerts, etc.)
 *
 * SUPPORTED EMAIL PROVIDERS:
 * - AWS SES (recommended for production)
 * - SendGrid
 * - Gmail SMTP
 * - Generic SMTP
 *
 * Set environment variables in Vercel:
 *   EMAIL_PROVIDER=ses|sendgrid|gmail|smtp
 *   EMAIL_FROM=noreply@yourdomain.com
 *
 * For AWS SES:
 *   AWS_SES_REGION=us-east-1
 *
 * For SendGrid:
 *   SENDGRID_API_KEY=SG.xxxx
 *
 * For Gmail:
 *   GMAIL_USER=your@gmail.com
 *   GMAIL_PASS=app-password
 *
 * For SMTP:
 *   SMTP_HOST=smtp.yourprovider.com
 *   SMTP_PORT=587
 *   SMTP_USER=youruser
 *   SMTP_PASS=yourpass
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, html, text } = req.body;

  if (!to || !subject || (!html && !text)) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, html/text' });
  }

  const provider = process.env.EMAIL_PROVIDER || 'ses';
  const from = process.env.EMAIL_FROM || 'noreply@yourcompany.com';

  try {
    let result;

    switch (provider.toLowerCase()) {
      case 'ses':
        result = await sendViaSES({ to, from, subject, html, text });
        break;
      case 'sendgrid':
        result = await sendViaSendGrid({ to, from, subject, html, text });
        break;
      case 'gmail':
        result = await sendViaGmail({ to, from, subject, html, text });
        break;
      case 'smtp':
        result = await sendViaSMTP({ to, from, subject, html, text });
        break;
      default:
        throw new Error(`Unsupported email provider: ${provider}`);
    }

    console.log(`Email sent successfully to ${to}: ${subject}`);
    res.status(200).json({ success: true, messageId: result?.messageId });

  } catch (error) {
    console.error('Email sending failed:', error);
    res.status(500).json({ error: 'Failed to send email', details: error.message });
  }
}

async function sendViaSES({ to, from, subject, html, text }) {
  const ses = new SESClient({ region: process.env.AWS_SES_REGION || 'us-east-1' });

  const command = new SendEmailCommand({
    Source: from,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject },
      Body: {
        ...(html && { Html: { Data: html } }),
        ...(text && { Text: { Data: text } })
      }
    }
  });

  const result = await ses.send(command);
  return { messageId: result.MessageId };
}

async function sendViaSendGrid({ to, from, subject, html, text }) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  const msg = {
    to,
    from,
    subject,
    ...(html && { html }),
    ...(text && { text })
  };

  const result = await sgMail.send(msg);
  return { messageId: result[0]?.headers?.['x-message-id'] };
}

async function sendViaGmail({ to, from, subject, html, text }) {
  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS // App password, not regular password
    }
  });

  const result = await transporter.sendMail({
    from,
    to,
    subject,
    ...(html && { html }),
    ...(text && { text })
  });

  return { messageId: result.messageId };
}

async function sendViaSMTP({ to, from, subject, html, text }) {
  const transporter = nodemailer.createTransporter({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const result = await transporter.sendMail({
    from,
    to,
    subject,
    ...(html && { html }),
    ...(text && { text })
  });

  return { messageId: result.messageId };
}