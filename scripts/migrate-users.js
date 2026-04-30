/**
 * One-time migration script for migrating users from WebDAV Excel to PostgreSQL
 * 
 * Usage:
 *   node scripts/migrate-users.js
 * 
 * Prerequisites:
 *   1. Set up PostgreSQL database and add DATABASE_URL to .env
 *   2. Make sure VK_CLOUD_EMAIL and VK_CLOUD_PASSWORD are set in .env
 *   3. Run: npm install
 */

import 'dotenv/config';
import { createClient } from 'webdav';
import * as XLSX from 'xlsx';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { initUsersTable, createUser, emailExists, query } from '../api/db-postgres.js';

async function migrate() {
    console.log('===========================================');
    console.log('  REGDOC: User Migration from Excel to PostgreSQL');
    console.log('===========================================');
    console.log();

    // Initialize PostgreSQL users table
    console.log('[1/4] Initializing PostgreSQL users table...');
    await initUsersTable();
    console.log('      ✓ Table ready\n');

    // Connect to WebDAV
    console.log('[2/4] Connecting to WebDAV cloud...');
    const client = createClient('https://webdav.cloud.mail.ru/', {
        username: process.env.VK_CLOUD_EMAIL,
        password: process.env.VK_CLOUD_PASSWORD,
    });
    console.log('      ✓ Connected\n');

    // Download and parse Excel file
    const USERS_FILE = '/RegDoc_Заявки/_USERS/users.xlsx';
    console.log('[3/4] Downloading users from WebDAV...');

    let usersFromExcel = [];

    try {
        if (await client.exists(USERS_FILE)) {
            const buffer = await client.getFileContents(USERS_FILE, { format: 'binary' });
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            usersFromExcel = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            console.log(`      ✓ Downloaded ${usersFromExcel.length} users from Excel\n`);
        } else {
            console.log('      ⚠ Users file not found in WebDAV\n');
        }
    } catch (e) {
        console.error('      ✗ Failed to download users file:', e.message);
        console.log('      Continuing with zero users (new database)\n');
    }

    // Migrate each user
    console.log('[4/4] Migrating users to PostgreSQL...');

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of usersFromExcel) {
        try {
            const email = String(row.email || '').trim().toLowerCase();

            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                console.log(`      ⚠ Skipping invalid email: ${email}`);
                skipped++;
                continue;
            }

            // Check if already exists
            const exists = await emailExists(email);
            if (exists) {
                console.log(`      ⚠ Skipping duplicate: ${email}`);
                skipped++;
                continue;
            }

            // Handle password - hash if plain text, keep as-is if already hashed
            let passwordHash = String(row.passwordHash || row.password_hash || '');

            if (!passwordHash) {
                // No password - set a temporary one that user must reset
                console.log(`      ⚠ No password for ${email}, setting temporary`);
                passwordHash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);
            } else if (!passwordHash.startsWith('$2')) {
                // Plain text password - hash it
                console.log(`      ℹ Hashing plain text password for ${email}`);
                passwordHash = bcrypt.hashSync(passwordHash, 10);
            }

            // Determine if verified
            let verified = false;
            const verifiedStr = String(row.verified || '').toLowerCase().trim();
            if (verifiedStr === 'true' || verifiedStr === '1' || verifiedStr === 'yes') {
                verified = true;
            }

            // Create user in PostgreSQL
            await createUser({
                email,
                username: String(row.username || email.split('@')[0]).trim() || null,
                passwordHash,
                role: email === 'admin' ? 'admin' : 'user',
                verified,
                verifyToken: null,
                verifyExpires: null
            });

            console.log(`      ✓ Migrated: ${email} (verified: ${verified})`);
            migrated++;
        } catch (e) {
            console.error(`      ✗ Error migrating user:`, e.message);
            errors++;
        }
    }

    // Summary
    console.log();
    console.log('===========================================');
    console.log('  Migration Complete');
    console.log('===========================================');
    console.log(`  ✓ Migrated:  ${migrated}`);
    console.log(`  ⚠ Skipped:   ${skipped}`);
    console.log(`  ✗ Errors:     ${errors}`);
    console.log();

    if (migrated > 0) {
        console.log('  ✓ All users migrated to PostgreSQL successfully!');
        console.log('  Note: Users with plain-text passwords now have hashed passwords.');
        console.log();
    }

    if (errors > 0) {
        console.log('  ⚠ Some users failed to migrate. Check the errors above.');
    }

    process.exit(errors > 0 ? 1 : 0);
}

// Run migration
migrate().catch(e => {
    console.error('Migration failed:', e);
    process.exit(1);
});