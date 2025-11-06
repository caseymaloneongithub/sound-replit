import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";
import { users } from "../shared/schema.js";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function seedSuperAdmin() {
  const email = "casey@soundkombucha.com";
  const username = "casey";
  const password = "kombucha2025"; // Change this to a secure password
  
  console.log("Checking for existing super admin...");
  
  const existing = await db.select().from(users).where(eq(users.email, email));
  
  if (existing.length > 0) {
    console.log(`User ${email} already exists. Updating to super_admin role and password...`);
    const hashedPassword = await hashPassword(password);
    await db
      .update(users)
      .set({ 
        role: "super_admin", 
        isAdmin: true,
        password: hashedPassword,
        username 
      })
      .where(eq(users.email, email));
    console.log("✓ Updated existing user to super_admin");
    console.log(`  Username: ${username}`);
    console.log(`  Password: ${password}`);
  } else {
    console.log("Creating new super admin user...");
    const hashedPassword = await hashPassword(password);
    
    await db.insert(users).values({
      username,
      password: hashedPassword,
      email,
      firstName: "Casey",
      lastName: "Malone",
      role: "super_admin",
      isAdmin: true,
    });
    
    console.log("✓ Created super admin:");
    console.log(`  Username: ${username}`);
    console.log(`  Email: ${email}`);
    console.log(`  Password: ${password}`);
    console.log("\n⚠️  IMPORTANT: Change this password after first login!");
  }
  
  process.exit(0);
}

seedSuperAdmin().catch((error) => {
  console.error("Error seeding super admin:", error);
  process.exit(1);
});
