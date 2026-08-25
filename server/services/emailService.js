// services/emailService.js
//
// Nodemailer transport for transactional email — currently only the
// forgot-password reset link (authController.js's forgotPassword). Gmail
// SMTP specifically: smtp.gmail.com:587, and the SMTP_PASS must be a Gmail
// "App Password" (myaccount.google.com/apppasswords, requires 2-Step
// Verification on the account) — a regular Gmail login password will NOT
// work here, Google blocks plain-password SMTP auth entirely.
const nodemailer = require("nodemailer");
const { dbLogger } = require("../config/logger");

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        return null;
    }
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465, // 465 = implicit TLS, 587 = STARTTLS
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    return transporter;
}

async function sendPasswordResetEmail(toEmail, resetLink) {
    const t = getTransporter();
    if (!t) {
        // No SMTP configured — surfaced as a real error rather than
        // silently pretending the email went out (same "gap, not a guess"
        // convention this codebase uses elsewhere for missing data).
        throw new Error("Email sending isn't configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing in .env)");
    }
    await t.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: toEmail,
        subject: "Reset your Bazaar Sync password",
        text: `Reset your password: ${resetLink}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
        html: `
            <p>Someone requested a password reset for your Bazaar Sync account.</p>
            <p><a href="${resetLink}">Click here to reset your password</a></p>
            <p style="color:#888;font-size:12px">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        `,
    });
    dbLogger.info(`[email] password reset link sent to ${toEmail}`);
}

module.exports = { sendPasswordResetEmail };
