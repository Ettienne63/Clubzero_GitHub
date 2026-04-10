const https = require("https");

const PAYSTACK_HOST = "api.paystack.co";

const requestPaystack = ({ path, method = "GET", secretKey, payload }) =>
  new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : "";
    const headers = {
      Authorization: `Bearer ${secretKey}`,
    };

    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }

    const req = https.request(
      {
        hostname: PAYSTACK_HOST,
        path,
        method,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch (error) {
            return reject(
              new Error(`Paystack response parse failed: ${error.message}`),
            );
          }

          if (!res.statusCode || res.statusCode >= 400) {
            const message =
              parsed?.message ||
              `Paystack request failed with status ${res.statusCode}`;
            const err = new Error(message);
            err.statusCode = res.statusCode;
            err.payload = parsed;
            return reject(err);
          }

          return resolve(parsed);
        });
      },
    );

    req.on("error", (error) => reject(error));

    if (payload) {
      req.write(body);
    }

    req.end();
  });

const initializeTransaction = async ({
  secretKey,
  email,
  amount,
  currency,
  callbackUrl,
  metadata,
}) =>
  requestPaystack({
    path: "/transaction/initialize",
    method: "POST",
    secretKey,
    payload: {
      email,
      amount,
      currency,
      callback_url: callbackUrl,
      metadata,
    },
  });

const verifyTransaction = async ({ secretKey, reference }) =>
  requestPaystack({
    path: `/transaction/verify/${encodeURIComponent(reference)}`,
    method: "GET",
    secretKey,
  });

module.exports = {
  initializeTransaction,
  verifyTransaction,
};
