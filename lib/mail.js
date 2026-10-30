const nodemailer = require("nodemailer");
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
function createMailer(env = process.env) {
  const transport = env.SMTP_URL
    ? nodemailer.createTransport(env.SMTP_URL)
    : env.SMTP_HOST
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || 587),
        secure: env.SMTP_SECURE === "true",
        ...(env.SMTP_USER
          ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
          : {}),
      })
    : env.CLOUDFLARE_EMAIL_API_TOKEN
    ? nodemailer.createTransport({
        host: "smtp.mx.cloudflare.net",
        port: 465,
        secure: true,
        auth: { user: "api_token", pass: env.CLOUDFLARE_EMAIL_API_TOKEN },
      })
    : null;
  return {
    configured: !!(transport || env.RESEND_API_KEY),
    async send(to, subject, message, url, options = {}) {
      const text = message + (url ? `\n\n${url}` : "");
      const html =
        options.html ||
        `<p>${escape(message)}</p>${
          url ? `<p><a href="${escape(url)}">${escape(url)}</a></p>` : ""
        }`;
      const mail = {
        from: env.MAIL_FROM || "MetriBee <noreply@localhost>",
        to,
        subject,
        text,
        html,
      };
      if (transport) return transport.sendMail(mail);
      if (env.RESEND_API_KEY) {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(mail),
        });
        if (!response.ok)
          throw new Error(
            "Email delivery failed. Check the mail provider configuration."
          );
        return;
      }
      throw new Error(
        "Configure SMTP_URL, CLOUDFLARE_EMAIL_API_TOKEN or RESEND_API_KEY and MAIL_FROM to send account emails."
      );
    },
  };
}
module.exports = { createMailer };
