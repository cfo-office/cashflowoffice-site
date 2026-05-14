const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON" })
    };
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const product = typeof payload.product === "string" ? payload.product.trim() : "";

  if (!name || !emailPattern.test(email) || product !== "free-job-cost-tracker") {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing or invalid lead fields" })
    };
  }

  // TODO: Store the lead in the CRM, database, or email marketing platform.
  // TODO: Create an expiring download token for CashFlowOffice_JobCostTracker_Final.xlsx.
  // TODO: Send the Resend email with the secure free Job Cost Tracker link.

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true })
  };
};
