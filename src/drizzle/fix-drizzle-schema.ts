import fs from "fs";
import path from "path";

const filePath = path.resolve("./src/drizzle/schema.ts");

try {
  const content = fs.readFileSync(filePath, "utf8");

  // Match: mode: "bigint"  (preserve spacing and quotes around bigint)
  const updated = content.replace(/mode:\s*"bigint"/g, 'mode: "number"');

  if (content !== updated) {
    fs.writeFileSync(filePath, updated, "utf8");
    console.log(`✅ Replaced all occurrences of mode: "bigint" with mode: "number" in ${filePath}`);
  } else {
    console.log(`ℹ️ No occurrences of mode: "bigint" found in ${filePath}`);
  }
} catch (err) {
  console.error(`❌ Failed to patch ${filePath}:`, err);
  process.exit(1);
}