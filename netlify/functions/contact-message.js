const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowedTopics = new Set([
  "Free Job Cost Tracker",
  "Cash Flow Office Bundle",
  "Download issue",
  "Other question"
]);
const sourceValue = "cashflowoffice-homepage-contact";
const resendEndpoint = "https://api.resend.com/emails";
const sender = "Cash Flow Office <downloads@cashflowoffice.com>";
const contactRecipient = "darlene@cashflowoffice.com";
const contactEmailSubject = "New Cash Flow Office contact message";

const jsonResponse = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    ...headers
  },
  body: JSON.stringify(body)
});

const createRequestId = () => {
  return `contact_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

const logEvent = (level, event, details = {}) => {
  const logger = console[level] || console.log;
  logger(`[contact-message] ${event}`, details);
};

const safeError = (error) => ({
  name: error?.name,
  message: error?.message,
  code: error?.code,
  details: error?.details,
  hint: error?.hint
});

const escapeHtml = (value) => {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

const buildContactEmail = ({ name, email, topic, message, source, timestamp }) => {
  const rows = [
    ["Name", name],
    ["Email", email],
    ["Topic", topic],
    ["Message", message],
    ["Source", source],
    ["Timestamp", timestamp]
  ];

  const htmlRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #d1fae5;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#065f46;vertical-align:top;width:120px;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #d1fae5;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#0f172a;white-space:pre-wrap;">
        ${escapeHtml(value)}
      </td>
    </tr>
  `).join("");

  return {
    html: `
      <!doctype html>
      <html>
        <body style="margin:0;padding:0;background-color:#ecfdf5;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#ecfdf5;border-collapse:collapse;">
            <tr>
              <td align="center" style="padding:32px 16px;">
                <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background-color:#ffffff;border:1px solid #a7f3d0;border-radius:22px;border-collapse:separate;overflow:hidden;">
                  <tr>
                    <td style="padding:28px 28px 20px;background-color:#d1fae5;border-bottom:1px solid #a7f3d0;">
                      <div style="display:inline-block;border:1px solid #10b981;border-radius:999px;background-color:#f0fdf4;padding:8px 12px;font-size:11px;line-height:13px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:#065f46;">
                        Cash Flow Office
                      </div>
                      <h1 style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:34px;font-weight:500;color:#020617;">
                        New contact message
                      </h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:22px 28px 30px;background-color:#ffffff;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
                        ${htmlRows}
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
    text: `New Cash Flow Office contact message

Name: ${name}
Email: ${email}
Topic: ${topic}
Message: ${message}
Source: ${source}
Timestamp: ${timestamp}`
  };
};

const sendContactEmail = async ({ name, email, topic, message, source, timestamp, requestId }) => {
  const resendApiKey = process.env.RESEND_API_KEY;

  logEvent("info", "resend_config_check", {
    requestId,
    hasResendApiKey: Boolean(resendApiKey)
  });

  if (!resendApiKey) {
    return {
      sent: false,
      sender,
      warning: "RESEND_API_KEY is not configured."
    };
  }

  const emailContent = buildContactEmail({
    name,
    email,
    topic,
    message,
    source,
    timestamp
  });

  const resendPayload = {
    from: sender,
    to: contactRecipient,
    reply_to: email,
    subject: contactEmailSubject,
    html: emailContent.html,
    text: emailContent.text
  };

  logEvent("info", "resend_request_payload", {
    requestId,
    payload: {
      from: resendPayload.from,
      to: resendPayload.to,
      replyToDomain: email.split("@")[1],
      subject: resendPayload.subject,
      hasHtml: Boolean(resendPayload.html),
      hasText: Boolean(resendPayload.text)
    }
  });

  const response = await fetch(resendEndpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(resendPayload)
  });

  const body = await parseResendResponse(response);

  logEvent("info", "resend_api_response", {
    requestId,
    sender,
    status: response.status,
    ok: response.ok,
    body
  });

  if (!response.ok) {
    return {
      sent: false,
      sender,
      status: response.status,
      body,
      warning: body?.message || body?.error || "Email delivery failed."
    };
  }

  return {
    sent: true,
    sender,
    id: body.id
  };
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

    return jsonResponse(405, {
      success: false,
      error: "Method not allowed"
    }, {
      "Allow": "POST"
    });
  }

  let payload;

  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    logEvent("warn", "payload_json_parse_failed", {
      requestId,
      error: safeError(error)
    });

    return jsonResponse(400, {
      success: false,
      error: "Invalid JSON"
    });
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const topic = typeof payload.topic === "string" ? payload.topic.trim() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const source = typeof payload.source === "string" && payload.source.trim()
    ? payload.source.trim()
    : sourceValue;

  const fieldErrors = {};

  if (!name) {
    fieldErrors.name = "Full Name is required.";
  }

  if (!email || !emailPattern.test(email)) {
    fieldErrors.email = "A valid Email Address is required.";
  }

  if (!topic || !allowedTopics.has(topic)) {
    fieldErrors.topic = "A valid topic is required.";
  }

  if (!message) {
    fieldErrors.message = "Message is required.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    logEvent("warn", "validation_failed", {
      requestId,
      fields: Object.keys(fieldErrors)
    });

    return jsonResponse(400, {
      success: false,
      error: "Missing or invalid contact fields",
      fields: fieldErrors
    });
  }

  const supabase = getSupabaseClient(requestId);

  if (!supabase) {
    return jsonResponse(500, {
      success: false,
      error: "Contact message storage is not configured"
    });
  }

  try {
    const { error } = await supabase
      .from("contact_messages")
      .insert({
        name,
        email,
        topic,
        message,
        source
      });

    if (error) {
      logEvent("error", "supabase_insert_failed", {
        requestId,
        error: safeError(error)
      });

      return jsonResponse(500, {
        success: false,
        error: "Could not save contact message"
      });
    }

    logEvent("info", "contact_message_saved", {
      requestId,
      topic,
      source,
      recipientDomain: email.split("@")[1]
    });

    const timestamp = new Date().toISOString();
    let emailResult;

    try {
      emailResult = await sendContactEmail({
        name,
        email,
        topic,
        message,
        source,
        timestamp,
        requestId
      });
    } catch (error) {
      emailResult = {
        sent: false,
        sender,
        warning: "Email delivery request failed before Resend returned a response."
      };

      logEvent("error", "resend_request_threw", {
        requestId,
        sender,
        recipient: contactRecipient,
        error: safeError(error)
      });
    }

    if (emailResult.sent) {
      logEvent("info", "contact_email_sent", {
        requestId,
        sender: emailResult.sender,
        recipient: contactRecipient,
        resendId: emailResult.id
      });
    } else {
      logEvent("warn", "contact_email_not_sent", {
        requestId,
        sender: emailResult.sender,
        recipient: contactRecipient,
        status: emailResult.status,
        warning: emailResult.warning,
        body: emailResult.body
      });
    }

    return jsonResponse(200, {
      success: true,
      email: {
        sent: emailResult.sent,
        sender: emailResult.sender
      }
    });
  } catch (error) {
    logEvent("error", "function_unexpected_error", {
      requestId,
      error: safeError(error)
    });

    return jsonResponse(500, {
      success: false,
      error: "Something went wrong. Please try again."
    });
  }
};
