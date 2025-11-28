const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");

function resolveCvPath(cvPath) {
  if (!cvPath) {
    throw new Error("No CV path provided");
  }

  // Normalize cvPath (remove leading / if it's like "/uploads/...")
  let normalized = cvPath.trim();
  if (normalized.startsWith("/")) {
    normalized = normalized.substring(1);
  }

  // Base dir is project src root (one level up from utils/)
  const baseDir = path.join(__dirname, "..");

  // Try a few common locations:
  // 1) as-is relative to baseDir (e.g. "uploads/cv/..." )
  let candidatePaths = [
    path.join(baseDir, normalized),
    path.join(baseDir, "public", normalized) // e.g. "public/uploads/cv/..."
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // If still not found, log and throw with full paths we checked
  console.error("CV file not found. Tried paths:", candidatePaths);
  throw new Error("CV file not found at " + candidatePaths.join(" OR "));
}

async function extractTextFromPdf(cvPath) {
  const absolutePath = resolveCvPath(cvPath);

  try {
    const buffer = fs.readFileSync(absolutePath);
    const result = await pdfParse(buffer);
    return result.text || "";
  } catch (err) {
    console.error("PDF parsing failed at", absolutePath, err);
    throw err;
  }
}

module.exports = { extractTextFromPdf };
