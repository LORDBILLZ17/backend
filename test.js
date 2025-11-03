import dotenv from "dotenv";
dotenv.config();

try {
  const obj = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT.replace(/\\n/g, '\n'));
  console.log("✅ Parsed OK:", obj.project_id);
} catch (err) {
  console.error("❌ JSON Parse Error:", err.message);
}
