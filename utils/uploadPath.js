const path = require("path");

function getUploadDir() {
  const configuredDir = String(process.env.UPLOAD_DIR || "").trim();
  if (configuredDir) {
    return path.resolve(configuredDir);
  }
  return path.join(__dirname, "..", "public", "uploads");
}

module.exports = {
  getUploadDir,
};
