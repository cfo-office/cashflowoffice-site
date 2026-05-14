const Stripe = require("stripe");

const bundleProductKey = "cashflowoffice-weekly-finance-bundle";
const sourceKey = "cashflowoffice-site";
const successUrl = "https://cashflowoffice.com/?purchase=success&session_id={CHECKOUT_SESSION_ID}";
const cancelUrl = "https://cashflowoffice.com/?purchase=cancelled";

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const createRequestId = () => {
  return `checkout_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

const logEvent = (level, event, details = {}) => {
  const logger = console[level] || console.log;
  logger(`[create-checkout-session] ${event}`, details);
};

const safeError = (error) => ({
  name: error?.name,
  message: error?.message,
  type: error?.type,
  code: error?.code
});

exports.handler = async (event) => {
  const requestId = createRequestId();

  logEvent("info", "checkout_session_request_started", {
    requestId,
    httpMethod: event.httpMethod
  });

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, {
      success: false,
      message: "Method not allowed."
    });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID_CFO_BUNDLE;

  if (!stripeSecretKey || !priceId) {
    logEvent("error", "checkout_session_config_missing", {
      requestId,
      hasStripeSecretKey: Boolean(stripeSecretKey),
      hasPriceId: Boolean(priceId)
    });

    return jsonResponse(500, {
      success: false,
      message: "Checkout is not configured."
    });
  }

  try {
    const stripe = new Stripe(stripeSecretKey);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        product: bundleProductKey,
        source: sourceKey
      }
    });

    if (!session.url) {
      throw new Error(`Stripe Checkout session ${session.id} did not include a URL.`);
    }

    logEvent("info", "checkout_session_created", {
      requestId,
      sessionId: session.id,
      mode: session.mode,
      priceId,
      hasUrl: Boolean(session.url)
    });

    return jsonResponse(200, {
      success: true,
      checkoutUrl: session.url
    });
  } catch (error) {
    logEvent("error", "checkout_session_error", {
      requestId,
      error: safeError(error)
    });

    return jsonResponse(500, {
      success: false,
      message: "Unable to start checkout."
    });
  }
};
