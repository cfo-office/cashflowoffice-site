const { createClient } = require("@supabase/supabase-js");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const bucketName = "cashflowoffice-downloads";
const defaultDownloadPath = "CashFlowOffice_JobCostTracker_Final.xlsx";
const downloadPathPrefix = "CashFlowOffice_JobCostTr";
const signedUrlExpiresInSeconds = 10 * 60;

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const getSupabaseClient = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error("Missing Supabase environment variables for free download lead function", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseSecretKey: Boolean(supabaseSecretKey)
    });
    return null;
  }

  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
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

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
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
    console.warn("Invalid JSON submitted to free download lead function");
    return jsonResponse(400, { error: "Invalid JSON" });
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const product = typeof payload.product === "string" ? payload.product.trim() : "";

  if (!name || !emailPattern.test(email) || product !== "free-job-cost-tracker") {
    console.warn("Invalid free download lead fields", {
      hasName: Boolean(name),
      hasValidEmail: emailPattern.test(email),
      product
    });
    return jsonResponse(400, { error: "Missing or invalid lead fields" });
  }

  // TODO: Store the lead in the CRM, database, or email marketing platform.
  // TODO: Send the Resend email with the secure free Job Cost Tracker link.

  const supabase = getSupabaseClient();

  if (!supabase) {
    return jsonResponse(500, { error: "Download service is not configured" });
  }

  try {
    const downloadPath = await resolveDownloadPath(supabase);

    // TODO: Persist this signed URL/token request if download auditing is needed.
    const { data, error } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(downloadPath, signedUrlExpiresInSeconds);

    if (error || !data?.signedUrl) {
      console.error("Could not create Supabase signed URL for free download", {
        bucketName,
        downloadPath,
        error: error?.message
      });
      return jsonResponse(500, { error: "Could not create download link" });
    }

    console.info("Created signed Job Cost Tracker download URL", {
      bucketName,
      downloadPath,
      product,
      expiresInSeconds: signedUrlExpiresInSeconds
    });

    return jsonResponse(200, {
      success: true,
      downloadUrl: data.signedUrl,
      message: "Your free Job Cost Tracker download is ready."
    });
  } catch (error) {
    console.error("Unexpected free download lead function error", {
      message: error.message
    });

    return jsonResponse(500, { error: "Something went wrong. Please try again." });
  }
};
