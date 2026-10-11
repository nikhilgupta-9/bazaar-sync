// server/scripts/resetAdminPassword.js
// Utility script to reset admin passwords or promote users to admin
// Usage: node server/scripts/resetAdminPassword.js <email> <newPassword>
// Example: node server/scripts/resetAdminPassword.js admin@bazaarsync.com Admin@123

require("dotenv").config({ path: __dirname + "/../.env" });
const bcrypt = require("bcrypt");
const { query, pool } = require("../config/db");

async function main() {
    const email = process.argv[2] || "admin@bazaarsync.com";
    const password = process.argv[3] || "Admin@123";

    console.log(`\n=== Resetting Admin Credentials ===`);
    console.log(`Target Email: ${email}`);
    console.log(`New Password: ${password}`);

    const hash = await bcrypt.hash(password, 12);

    const existing = await query("SELECT id, name, email, role FROM users WHERE email = ?", [email.trim().toLowerCase()]);
    if (existing.length === 0) {
        console.log(`User ${email} does not exist. Creating new admin user...`);
        await query(
            "INSERT INTO users (name, email, password_hash, role, tier) VALUES (?, ?, ?, 'admin', 'pro')",
            ["Administrator", email.trim().toLowerCase(), hash]
        );
        console.log(`✓ Admin user ${email} created successfully.`);
    } else {
        await query(
            "UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?",
            [hash, existing[0].id]
        );
        console.log(`✓ Updated ${email} password and confirmed role='admin'.`);
    }

    const admins = await query("SELECT id, name, email, role FROM users WHERE role = 'admin'");
    console.log(`\nActive Admins:`);
    admins.forEach(a => console.log(`  - ID: ${a.id} | Email: ${a.email} | Role: ${a.role}`));
    console.log(`===================================\n`);
    pool.end();
}

main().catch(err => {
    console.error("Error resetting admin password:", err);
    pool.end();
    process.exit(1);
});
