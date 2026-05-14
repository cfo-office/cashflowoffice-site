const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const bucketName = "cashflowoffice-downloads";
const defaultDownloadPath = "CashFlowOffice_JobCostTracker_Final.xlsx";
const downloadPathPrefix = "CashFlowOffice_JobCostTr";
const signedUrlExpiresInSeconds = 10 * 60;
const resendEndpoint = "https://api.resend.com/emails";
const primarySender = "Cash Flow Office <downloads@cashflowoffice.com>";
const fallbackSender = "Cash Flow Office <onboarding@resend.dev>";
const emailSubject = "Your Free Job Cost Tracker Is Ready";

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const createRequestId = () => {
  return `lead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

const logEvent = (level, event, details = {}) => {
  const logger = console[level] || console.log;
  logger(`[free-download-lead] ${event}`, details);
};

const safeError = (error) => ({
  name: error?.name,
  message: error?.message,
  stack: error?.stack
});

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

const resolveDownloadPath = async (supabase) => {
  const configuredPath = process.env.FREE_JOB_COST_TRACKER_PATH;

  if (configuredPath) {
    return configuredPath;
  }

  const { data, error } = await supabase.storage
    .from(bucketName)
    .list("", {
      limit: 100,
      search: downloadPathPrefix
    });

  if (error) {
    console.warn("Could not list Supabase download bucket; using default file path", {
      bucketName,
      error: error.message
    });
    return defaultDownloadPath;
  }

  const matchedFile = (data || []).find((file) => {
    return file.name.startsWith(downloadPathPrefix) && file.name.toLowerCase().endsWith(".xlsx");
  });

  return matchedFile ? matchedFile.name : defaultDownloadPath;
};

const escapeHtml = (value) => {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const buildDownloadEmail = ({ name, downloadUrl }) => {
  const safeName = escapeHtml(name);
  const safeDownloadUrl = escapeHtml(downloadUrl);

  return {
    html: `
      <!doctype html>
      <html>
        <body style="margin:0;background:#ecfdf5;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #a7f3d0;border-radius:24px;overflow:hidden;box-shadow:0 24px 60px rgba(6,95,70,.16);">
            <tr>
              <td style="padding:28px 28px 18px;background:linear-gradient(135deg,#f8fffc,#d1fae5);">
                <div style="display:inline-block;border:1px solid rgba(16,185,129,.55);border-radius:999px;padding:8px 12px;color:#065f46;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">
                  Cash Flow Office
                </div>
                <h1 style="margin:18px 0 0;font-size:30px;line-height:1.1;font-weight:500;letter-spacing:-.03em;color:#020617;">
                  Your Job Cost Tracker is ready.
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px 30px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#334155;">
                  Hi ${safeName},
                </p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#334155;">
                  Thanks for requesting the free Cash Flow Office Job Cost Tracker. Use the secure button below to download the spreadsheet.
                </p>
                <p style="margin:0 0 26px;font-size:14px;line-height:1.6;color:#065f46;">
                  This secure download link expires in 10 minutes.
                </p>
                <a href="${safeDownloadUrl}" style="display:inline-block;border-radius:999px;background:linear-gradient(135deg,#7dffd8 0%,#34F5A1 48%,#10B981 100%);padding:15px 22px;color: #061218 !important;-webkit-text-fill-color: #061218 !important;text-decoration:none;font-size:15px;font-weight:800;box-shadow:0 18px 34px rgba(52,245,161,.32);">
                  Download the Job Cost Tracker
                </a>
                <p style="margin:26px 0 0;font-size:13px;line-height:1.6;color:#64748b;">
                  If the button does not work, copy and paste this link into your browser:<br>
                  <a href="${safeDownloadUrl}" style="color:#047857;word-break:break-all;">${safeDownloadUrl}</a>
                </p>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
    text: `Hi ${name},\n\nThanks for requesting the free Cash Flow Office Job Cost Tracker.\n\nYour secure download link expires in 10 minutes:\n${downloadUrl}\n\nCash Flow Office`
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

const isDomainVerificationError = ({ status, body }) => {
  const message = JSON.stringify(body || {}).toLowerCase();
  return status === 403 || message.includes("domain") || message.includes("verify") || message.includes("verified");
};

const sendResendEmail = async ({ from, to, name, downloadUrl, requestId }) => {
  const resendApiKey = process.env.RESEND_API_KEY;

  logEvent("info", "resend_config_check", {
    requestId,
    hasResendApiKey: Boolean(resendApiKey)
  });

  if (!resendApiKey) {
    logEvent("warn", "resend_missing_api_key", { requestId });
    return {
      sent: false,
      sender: null,
      warning: "Email delivery is not configured."
    };
  }

  const email = buildDownloadEmail({ name, downloadUrl });
  const resendPayload = {
    from,
    to,
    subject: emailSubject,
    html: email.html,
    text: email.text
  };

  logEvent("info", "resend_sender_selected", {
    requestId,
    sender: from,
    recipient: to
  });

  logEvent("info", "resend_request_payload", {
    requestId,
    payload: {
      from: resendPayload.from,
      to: resendPayload.to,
      subject: resendPayload.subject,
      hasHtml: Boolean(resendPayload.html),
      hasText: Boolean(resendPayload.text),
      htmlLength: resendPayload.html.length,
      textLength: resendPayload.text.length,
      downloadUrlIncludedInEmail: Boolean(downloadUrl)
    }
  });

  let response;
  let body;

  try {
    response = await fetch(resendEndpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(resendPayload)
    });

    body = await parseResendResponse(response);
  } catch (error) {
    logEvent("error", "resend_request_threw", {
      requestId,
      sender: from,
      error: safeError(error)
    });

    return {
      sent: false,
      sender: from,
      warning: "Email delivery request failed before Resend returned a response."
    };
  }

  logEvent("info", "resend_api_response", {
    requestId,
    sender: from,
    status: response.status,
    ok: response.ok,
    body
  });

  if (!response.ok) {
    return {
      sent: false,
      sender: from,
      status: response.status,
      body,
      warning: body?.message || body?.error || "Email delivery failed."
    };
  }

  return {
    sent: true,
    sender: from,
    id: body.id
  };
};

const sendDownloadEmail = async ({ name, email, downloadUrl, requestId }) => {
  const primaryResult = await sendResendEmail({
    from: primarySender,
    to: email,
    name,
    downloadUrl,
    requestId
  });

  if (primaryResult.sent) {
    logEvent("info", "resend_email_sent", {
      requestId,
      sender: primaryResult.sender,
      resendId: primaryResult.id,
      recipientDomain: email.split("@")[1]
    });
    return primaryResult;
  }

  logEvent("warn", "resend_primary_sender_failed", {
    requestId,
    sender: primaryResult.sender,
    status: primaryResult.status,
    warning: primaryResult.warning,
    recipientDomain: email.split("@")[1]
  });

  if (!isDomainVerificationError(primaryResult)) {
    return primaryResult;
  }

  const fallbackResult = await sendResendEmail({
    from: fallbackSender,
    to: email,
    name,
    downloadUrl,
    requestId
  });

  if (fallbackResult.sent) {
    logEvent("info", "resend_email_sent_with_fallback_sender", {
      requestId,
      sender: fallbackResult.sender,
      resendId: fallbackResult.id,
      recipientDomain: email.split("@")[1]
    });
    return {
      ...fallbackResult,
      warning: "Primary sender was unavailable; email sent with fallback sender."
    };
  }

  logEvent("error", "resend_fallback_sender_failed", {
    requestId,
    sender: fallbackResult.sender,
    status: fallbackResult.status,
    warning: fallbackResult.warning,
    recipientDomain: email.split("@")[1]
  });

  return fallbackResult;
};

exports.handler = async (event) => {
  const requestId = createRequestId();

  logEvent("info", "function_start", {
    requestId,
    httpMethod: event.httpMethod
  });

  if (event.httpMethod !== "POST") {
    logEvent("warn", "method_not_allowed", {
      requestId,
      httpMethod: event.httpMethod
    });

    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json",
        "Allow": "POST"
      },
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  let payload;

  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    logEvent("warn", "payload_json_parse_failed", {
      requestId,
      error: safeError(error)
    });
    return jsonResponse(400, { error: "Invalid JSON" });
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const product = typeof payload.product === "string" ? payload.product.trim() : "";

  logEvent("info", "incoming_payload", {
    requestId,
    payload: {
      name,
      email,
      product
    }
  });

  if (!name || !emailPattern.test(email) || product !== "free-job-cost-tracker") {
    logEvent("warn", "validation_failed", {
      requestId,
      hasName: Boolean(name),
      hasValidEmail: emailPattern.test(email),
      product
    });
    return jsonResponse(400, { error: "Missing or invalid lead fields" });
  }

  logEvent("info", "validation_passed", {
    requestId,
    product,
    recipientDomain: email.split("@")[1]
  });

  // TODO: Store the lead in the CRM, database, or email marketing platform.

  const supabase = getSupabaseClient(requestId);

  if (!supabase) {
    logEvent("error", "supabase_client_unavailable", { requestId });
    return jsonResponse(500, { error: "Download service is not configured" });
  }

  try {
    const downloadPath = await resolveDownloadPath(supabase);

    logEvent("info", "supabase_download_path_resolved", {
      requestId,
      bucketName,
      downloadPath
    });

    // TODO: Persist this signed URL/token request if download auditing is needed.
    const { data, error } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(downloadPath, signedUrlExpiresInSeconds);

    if (error || !data?.signedUrl) {
      logEvent("error", "supabase_signed_url_failed", {
        requestId,
        bucketName,
        downloadPath,
        error: error?.message
      });
      return jsonResponse(500, { error: "Could not create download link" });
    }

    logEvent("info", "supabase_signed_url_created", {
      requestId,
      bucketName,
      downloadPath,
      product,
      expiresInSeconds: signedUrlExpiresInSeconds,
      hasSignedUrl: Boolean(data.signedUrl)
    });

    let emailResult;

    try {
      emailResult = await sendDownloadEmail({
        name,
        email,
        downloadUrl: data.signedUrl,
        requestId
      });
    } catch (error) {
      logEvent("error", "email_delivery_threw", {
        requestId,
        error: safeError(error)
      });

      emailResult = {
        sent: false,
        sender: null,
        warning: "Email delivery failed, but your download link is ready."
      };
    }

    logEvent("info", "email_delivery_result", {
      requestId,
      sent: emailResult.sent,
      sender: emailResult.sender,
      warning: emailResult.warning
    });

    const responseBody = {
      success: true,
      downloadUrl: data.signedUrl,
      message: emailResult.sent
        ? "Your free Job Cost Tracker download is ready. We also emailed you the secure link."
        : "Your free Job Cost Tracker download is ready."
    };

    if (emailResult.sent) {
      responseBody.email = {
        sent: true,
        sender: emailResult.sender
      };

      if (emailResult.warning) {
        responseBody.warning = emailResult.warning;
      }
    } else {
      responseBody.email = {
        sent: false,
        sender: emailResult.sender
      };
      responseBody.warning = emailResult.warning || "Email delivery failed, but your download link is ready.";
    }

    logEvent("info", "function_success_response", {
      requestId,
      success: true,
      hasDownloadUrl: Boolean(responseBody.downloadUrl),
      emailSent: responseBody.email.sent,
      warning: responseBody.warning
    });

    return jsonResponse(200, {
      ...responseBody
    });
  } catch (error) {
    logEvent("error", "function_unexpected_error", {
      requestId,
      error: safeError(error)
    });

    return jsonResponse(500, { error: "Something went wrong. Please try again." });
  }
};
