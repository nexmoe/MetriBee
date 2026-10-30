const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const { createMailer } = require("../lib/mail");

describe("Mail providers", function () {
  let originalCreateTransport;
  let originalFetch;
  let transportOptions;
  let sentMail;

  beforeEach(function () {
    originalCreateTransport = nodemailer.createTransport;
    originalFetch = global.fetch;
    transportOptions = undefined;
    sentMail = undefined;
    nodemailer.createTransport = (options) => {
      transportOptions = options;
      return {
        sendMail: async (mail) => {
          sentMail = mail;
        },
      };
    };
  });

  afterEach(function () {
    nodemailer.createTransport = originalCreateTransport;
    global.fetch = originalFetch;
  });

  it("sends through Cloudflare with only a token and sender", async function () {
    const mailer = createMailer({
      CLOUDFLARE_EMAIL_API_TOKEN: "test-token",
      MAIL_FROM: "MetriBee <reports@example.com>",
    });
    assert.equal(mailer.configured, true);
    assert.deepEqual(transportOptions, {
      host: "smtp.mx.cloudflare.net",
      port: 465,
      secure: true,
      auth: { user: "api_token", pass: "test-token" },
    });
    await mailer.send("user@example.com", "Weekly report", "Summary", null, {
      html: "<p>Weekly report</p>",
    });
    assert.equal(sentMail.from, "MetriBee <reports@example.com>");
    assert.equal(sentMail.to, "user@example.com");
    assert.equal(sentMail.html, "<p>Weekly report</p>");
    assert.equal(sentMail.text, "Summary");
  });

  it("keeps explicit SMTP settings ahead of provider shortcuts", function () {
    for (const settings of [
      { SMTP_URL: "smtps://smtp.example.com:465" },
      { SMTP_HOST: "smtp.example.com" },
    ]) {
      createMailer({
        ...settings,
        CLOUDFLARE_EMAIL_API_TOKEN: "test-token",
        RESEND_API_KEY: "test-resend",
      });
      assert.equal(
        typeof transportOptions === "string"
          ? transportOptions
          : transportOptions.host,
        settings.SMTP_URL || settings.SMTP_HOST
      );
    }
  });

  it("keeps Resend available without SMTP or Cloudflare configuration", async function () {
    global.fetch = async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(options.headers.Authorization, "Bearer test-resend");
      sentMail = JSON.parse(options.body);
      return { ok: true };
    };
    const mailer = createMailer({ RESEND_API_KEY: "test-resend" });
    await mailer.send(
      "user@example.com",
      "Verify email",
      "Verify",
      "https://example.com"
    );
    assert.equal(transportOptions, undefined);
    assert.equal(sentMail.text, "Verify\n\nhttps://example.com");
  });

  it("reports missing provider configuration", async function () {
    const mailer = createMailer({});
    assert.equal(mailer.configured, false);
    await assert.rejects(
      mailer.send("user@example.com", "Test", "Test"),
      /CLOUDFLARE_EMAIL_API_TOKEN/
    );
  });
});
