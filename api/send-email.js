/**
 * api/send-email.js  (Vercel Serverless Function)
 * ──────────────────────────────────────────────────────────────────────────────
 * Sends email notifications for user events (welcome, alerts, etc.)
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';

export async function sendEmail({ to, subject, html, text, provider: providerOverride, from: fromOverride }) {
  const provider = providerOverride || process.env.EMAIL_PROVIDER || 'ses';
  const from = fromOverride || process.env.EMAIL_FROM || 'noreply@yourcompany.com';

  let result;
  switch (provider.toLowerCase()) {
    case 'resend':
      result = await sendViaResend({ to, from, subject, html, text });
      break;
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
  return result;
}

async function sendViaResend({ to, from, subject, html, text }) {
  let apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    try {
      const { getSupabaseClient, decryptPayload } = await import("./supabaseClient.js");
      const supabase = getSupabaseClient();
      const { data } = await supabase.from("dashboard_settings").select("value_encrypted").eq("key", "resend_api_key").single();
      if (data?.value_encrypted) {
        apiKey = decryptPayload(data.value_encrypted);
      }
    } catch (e) {
      console.warn("[api/send-email] Failed to load Resend API key from Supabase:", e.message);
    }
  }

  if (!apiKey) throw new Error("Resend API Key is not configured in environment or Supabase.");

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to, subject, html, text })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return { messageId: data.id };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, html, text, provider, from } = req.body;
  if (!to || !subject || (!html && !text)) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, html/text' });
  }

  try {
    const result = await sendEmail({ to, subject, html, text, provider, from });
    console.log(`Email sent successfully to ${to} via ${provider || 'default'}: ${subject}`);
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
  const msg = { to, from, subject, ...(html && { html }), ...(text && { text }) };
  const result = await sgMail.send(msg);
  return { messageId: result[0]?.headers?.['x-message-id'] };
}

async function sendViaGmail({ to, from, subject, html, text }) {
  let pass = process.env.GMAIL_PASS;

  if (!pass) {
    try {
      const { getSupabaseClient, decryptPayload } = await import("./supabaseClient.js");
      const supabase = getSupabaseClient();
      const { data } = await supabase.from("dashboard_settings").select("value_encrypted").eq("key", "gmail_pass").single();
      if (data?.value_encrypted) {
        pass = decryptPayload(data.value_encrypted);
      }
    } catch (e) {
      console.warn("[api/send-email] Failed to load Gmail pass from Supabase:", e.message);
    }
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass }
  });
  const result = await transporter.sendMail({ from, to, subject, ...(html && { html }), ...(text && { text }) });
  return { messageId: result.messageId };
}

async function sendViaSMTP({ to, from, subject, html, text }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  const result = await transporter.sendMail({ from, to, subject, ...(html && { html }), ...(text && { text }) });
  return { messageId: result.messageId };
}
