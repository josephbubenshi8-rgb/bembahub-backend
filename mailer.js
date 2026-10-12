import "dotenv/config";
import nodemailer from "nodemailer";

let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export async function sendPasswordResetEmail(toEmail, resetUrl) {
  if (!transporter) {
    // Never expose or log a reset token just because SMTP is missing.
    // A developer must explicitly opt in to local-only reset-link output.
    const allowDevResetLink =
      process.env.NODE_ENV !== "production" &&
      process.env.ALLOW_DEV_RESET_LINK === "true";
    if (allowDevResetLink) {
      console.log(`[password-reset] Development reset link for ${toEmail}: ${resetUrl}`);
      return { delivered: false, devLink: resetUrl };
    }
    console.warn("[password-reset] SMTP is not configured; reset email was not delivered.");
    return { delivered: false };
  }
  await transporter.sendMail({
    from: process.env.SMTP_FROM || `"BembaHub" <no-reply@bembahub.com>`,
    to: toEmail,
    subject: "Reset your BembaHub password",
    html: `<p>You requested a password reset.</p><p><a href="${resetUrl}">Click here to reset your password</a> (expires in 30 minutes).</p><p>If you didn't request this, you can ignore this email.</p>`,
  });
  return { delivered: true };
}
