const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

const bucketName = "cashflowoffice-downloads";
const bundleProductKey = "cashflowoffice-weekly-finance-bundle";
const signedUrlExpiresInSeconds = 24 * 60 * 60;
const resendEndpoint = "https://api.resend.com/emails";
const sender = "Cash Flow Office <downloads@cashflowoffice.com>";
const emailSubject = "Your Cash Flow Office Weekly Finance Bundle Is Ready";

const paidBundleFiles = [
  {
    label: "Weekly Cash Flow Planner",
    path: "CashFlowOffice_WeeklyCashFlowPlanner.xlsx"
  },
  {
    label: "Payment Scheduler",
    path: "CashFlowOffice_PaymentScheduler.xlsx"
  },
  {
    label: "Vendor + Subcontractor Manager",
    path: "CashFlowOffice_VendorSubcontractorManager.xlsx"
  },
  {
    label: "Job Cost Tracker",
    path: "CashFlowOffice_JobCostTracker_Final.xlsx"
  }
];

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const createRequestId = () => {
  return `stripe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

const logEvent = (level, event, details = {}) => {
  const logger = console[level] || console.log;
  logger(`[stripe-webhook] ${event}`, details);
};

const safeError = (error) => ({
  name: error?.name,
  message: error?.message,
  type: error?.type,
  code: error?.code
});

const escapeHtml = (value) => {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const getRawBody = (event) => {
  if (!event.body) {
    return Buffer.from("");
  }

  return Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");
};

const getSupabaseClient = (requestId) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    logEvent("error", "supabase_env_missing", {
      requestId,
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseSecretKey: Boolean(supabaseSecretKey)
    });
    return null;
  }

  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    realtime: {
      transport: WebSocket
    }
  });
};

const createSignedDownloads = async ({ supabase, requestId }) => {
  const downloads = [];

  for (const file of paidBundleFiles) {
    const { data, error } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(file.path, signedUrlExpiresInSeconds);

    if (error || !data?.signedUrl) {
      throw new Error(`Could not create signed URL for ${file.path}: ${error?.message || "missing signed URL"}`);
    }

    downloads.push({
      ...file,
      url: data.signedUrl
    });
  }

  logEvent("info", "paid_bundle_signed_urls_created", {
    requestId,
    bucketName,
    fileCount: downloads.length,
    expiresInSeconds: signedUrlExpiresInSeconds,
    filePaths: downloads.map((download) => download.path)
  });

  return downloads;
};

const buildButtonRows = (downloads) => {
  return downloads.map((download) => {
    const safeLabel = escapeHtml(download.label);
    const safeUrl = escapeHtml(download.url);

    return `
      <tr>
        <td style="padding:0 0 12px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;">
            <tr>
              <td align="center" bgcolor="#064e3b" style="background-color:#064e3b;border:1px solid #047857;border-radius:999px;">
                <a href="${safeUrl}" style="display:inline-block;padding:14px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;font-weight:800;color:#f8fffc !important;-webkit-text-fill-color:#f8fffc !important;text-decoration:none !important;mso-style-priority:100 !important;border-radius:999px;">
                  Download ${safeLabel}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;
  }).join("");
};

const buildFallbackLinks = (downloads) => {
  return downloads.map((download) => {
    const safeLabel = escapeHtml(download.label);
    const safeUrl = escapeHtml(download.url);

    return `
      <tr>
        <td style="padding:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#64748b;">
          <strong style="color:#334155;">${safeLabel}:</strong><br>
          <a href="${safeUrl}" style="color:#047857;text-decoration:underline;word-break:break-all;">${safeUrl}</a>
        </td>
      </tr>
    `;
  }).join("");
};

const buildFulfillmentEmail = ({ name, downloads }) => {
  const safeName = escapeHtml(name || "there");

  return {
    html: `
      <!doctype html>
      <html>
        <body style="margin:0;padding:0;background-color:#ecfdf5;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#ecfdf5;border-collapse:collapse;">
            <tr>
              <td align="center" style="padding:32px 16px;">
                <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background-color:#ffffff;border:1px solid #a7f3d0;border-radius:22px;border-collapse:separate;overflow:hidden;">
                  <tr>
                    <td style="padding:28px 28px 20px;background-color:#d1fae5;border-bottom:1px solid #a7f3d0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;">
                        <tr>
                          <td style="border:1px solid #10b981;border-radius:999px;background-color:#f0fdf4;padding:8px 12px;font-size:11px;line-height:13px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:#065f46;">
                            Cash Flow Office
                          </td>
                        </tr>
                      </table>
                      <h1 style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:34px;font-weight:500;color:#020617;">
                        Your Weekly Finance Bundle is ready.
                      </h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:26px 28px 30px;background-color:#ffffff;">
                      <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:27px;color:#334155;">
                        Hi ${safeName},
                      </p>
                      <p style="margin:0 0 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:27px;color:#334155;">
                        Thanks for purchasing the Cash Flow Office Weekly Finance Bundle. Your secure download links are below.
                      </p>
                      <p style="margin:0 0 26px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#065f46;">
                        These secure download links expire in 24 hours.
                      </p>
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                        ${buildButtonRows(downloads)}
                      </table>
                      <p style="margin:18px 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#64748b;">
                        If a button does not work, copy and paste the matching link into your browser:
                      </p>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
                        ${buildFallbackLinks(downloads)}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
    text: `Hi ${name || "there"},\n\nThanks for purchasing the Cash Flow Office Weekly Finance Bundle. Your secure download links are below.\n\nThese links expire in 24 hours.\n\n${downloads.map((download) => `${download.label}: ${download.url}`).join("\n")}\n\nCash Flow Office`
  };
};

const parseResendResponse = async (response) => {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw: text };
  }
};

const sendFulfillmentEmail = async ({ email, name, downloads, requestId }) => {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const emailContent = buildFulfillmentEmail({ name, downloads });
  const payload = {
    from: sender,
    to: email,
    subject: emailSubject,
    html: emailContent.html,
    text: emailContent.text
  };

  const response = await fetch(resendEndpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await parseResendResponse(response);

  if (!response.ok) {
    throw new Error(body?.message || body?.error || `Resend returned ${response.status}`);
  }

  logEvent("info", "paid_bundle_email_sent", {
    requestId,
    resendId: body.id,
    sender,
    recipientDomain: email.split("@")[1],
    downloadCount: downloads.length
  });

  return body;
};

const handleCheckoutSessionCompleted = async ({ session, requestId }) => {
  logEvent("info", "checkout_session_completed", {
    requestId,
    sessionId: session.id,
    paymentStatus: session.payment_status,
    product: session.metadata?.product,
    hasCustomerEmail: Boolean(session.customer_details?.email || session.customer_email)
  });

  if (session.metadata?.product !== bundleProductKey) {
    logEvent("info", "webhook_unrelated_product_ignored", {
      requestId,
      sessionId: session.id,
      product: session.metadata?.product
    });
    return;
  }

  if (session.payment_status !== "paid") {
    logEvent("warn", "checkout_session_not_paid", {
      requestId,
      sessionId: session.id,
      paymentStatus: session.payment_status
    });
    return;
  }

  const email = session.customer_details?.email || session.customer_email;
  const name = session.customer_details?.name || "there";

  if (!email) {
    throw new Error(`Checkout session ${session.id} is missing customer email.`);
  }

  const supabase = getSupabaseClient(requestId);

  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const downloads = await createSignedDownloads({ supabase, requestId });
  await sendFulfillmentEmail({
    email,
    name,
    downloads,
    requestId
  });
};

exports.handler = async (event) => {
  const requestId = createRequestId();

  logEvent("info", "webhook_received", {
    requestId,
    httpMethod: event.httpMethod,
    isBase64Encoded: Boolean(event.isBase64Encoded)
  });

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, {
      success: false,
      message: "Method not allowed."
    });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecretKey || !webhookSecret) {
    logEvent("error", "webhook_config_missing", {
      requestId,
      hasStripeSecretKey: Boolean(stripeSecretKey),
      hasWebhookSecret: Boolean(webhookSecret)
    });

    return jsonResponse(500, {
      success: false,
      message: "Webhook is not configured."
    });
  }

  const stripe = new Stripe(stripeSecretKey);
  const signature = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(getRawBody(event), signature, webhookSecret);
  } catch (error) {
    logEvent("error", "webhook_error", {
      requestId,
      step: "signature_verification",
      error: safeError(error)
    });

    return jsonResponse(400, {
      success: false,
      message: "Invalid webhook signature."
    });
  }

  logEvent("info", "webhook_signature_verified", {
    requestId,
    eventId: stripeEvent.id,
    eventType: stripeEvent.type
  });

  try {
    if (stripeEvent.type === "checkout.session.completed") {
      await handleCheckoutSessionCompleted({
        session: stripeEvent.data.object,
        requestId
      });
    } else {
      logEvent("info", "webhook_event_ignored", {
        requestId,
        eventId: stripeEvent.id,
        eventType: stripeEvent.type
      });
    }

    return jsonResponse(200, {
      received: true
    });
  } catch (error) {
    logEvent("error", "webhook_error", {
      requestId,
      eventId: stripeEvent.id,
      eventType: stripeEvent.type,
      error: safeError(error)
    });

    return jsonResponse(500, {
      success: false,
      message: "Webhook fulfillment failed."
    });
  }
};
