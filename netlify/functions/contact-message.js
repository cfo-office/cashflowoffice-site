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
  code: error?.code
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
        source: sourceValue
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
      source: sourceValue,
      recipientDomain: email.split("@")[1]
    });

    return jsonResponse(200, {
      success: true
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
