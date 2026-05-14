const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

const bucketName = "cashflowoffice-downloads";
const bundleProductKey = "cashflowoffice-weekly-finance-bundle";
const paidBundlePath = "CFO BUNDLE.zip";
const signedUrlExpiresInSeconds = 24 * 60 * 60;

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const createRequestId = () => {
  return `paid_download_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

const logEvent = (level, event, details = {}) => {
  const logger = console[level] || console.log;
  logger(`[paid-download-session] ${event}`, details);
};

const safeError = (error) => ({
  name: error?.name,
  message: error?.message,
  type: error?.type,
  code: error?.code
});

const parseBody = (event) => {
  if (!event.body) {
    return {};
  }

  try {
    return JSON.parse(event.body);
  } catch (error) {
    return {};
  }
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

const createSignedDownload = async ({ supabase, requestId }) => {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(paidBundlePath, signedUrlExpiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(`Could not create signed URL for ${paidBundlePath}: ${error?.message || "missing signed URL"}`);
  }

  logEvent("info", "paid_download_signed_url_created", {
    requestId,
    bucketName,
    filePath: paidBundlePath,
    expiresInSeconds: signedUrlExpiresInSeconds
  });

  return data.signedUrl;
};

exports.handler = async (event) => {
  const requestId = createRequestId();

  logEvent("info", "paid_download_session_request_started", {
    requestId,
    httpMethod: event.httpMethod
  });

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      },
      body: ""
    };
  }

  if (!["GET", "POST"].includes(event.httpMethod)) {
    return jsonResponse(405, {
      success: false,
      message: "Method not allowed."
    });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeSecretKey) {
    logEvent("error", "stripe_env_missing", {
      requestId,
      hasStripeSecretKey: false
    });

    return jsonResponse(500, {
      success: false,
      message: "Paid download is not configured."
    });
  }

  const body = parseBody(event);
  const sessionId = body.session_id || event.queryStringParameters?.session_id;

  if (!sessionId || typeof sessionId !== "string") {
    logEvent("warn", "paid_download_session_missing", { requestId });

    return jsonResponse(400, {
      success: false,
      message: "Missing checkout session."
    });
  }

  try {
    const stripe = new Stripe(stripeSecretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    logEvent("info", "paid_download_session_retrieved", {
      requestId,
      sessionId: session.id,
      paymentStatus: session.payment_status,
      product: session.metadata?.product
    });

    if (session.payment_status !== "paid" || session.metadata?.product !== bundleProductKey) {
      logEvent("warn", "paid_download_session_rejected", {
        requestId,
        sessionId: session.id,
        paymentStatus: session.payment_status,
        product: session.metadata?.product
      });

      return jsonResponse(403, {
        success: false,
        message: "This checkout session is not eligible for download."
      });
    }

    const supabase = getSupabaseClient(requestId);

    if (!supabase) {
      return jsonResponse(500, {
        success: false,
        message: "Paid download storage is not configured."
      });
    }

    const downloadUrl = await createSignedDownload({ supabase, requestId });

    return jsonResponse(200, {
      success: true,
      downloadUrl,
      expiresInSeconds: signedUrlExpiresInSeconds
    });
  } catch (error) {
    logEvent("error", "paid_download_session_error", {
      requestId,
      sessionId,
      error: safeError(error)
    });

    return jsonResponse(500, {
      success: false,
      message: "Unable to create paid download link."
    });
  }
};
