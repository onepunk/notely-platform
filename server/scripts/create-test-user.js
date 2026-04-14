/**
 * Create Test User for V2 Auth Service
 *
 * Creates a test user in the notely_v3 database for authentication testing.
 *
 * Usage: node scripts/create-test-user.js
 */

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'notely_v3',
  user: process.env.DB_USER || 'notely_user',
  password: process.env.DB_PASSWORD || 'postgres'
});

async function createTestUser() {
  const email = 'test@example.com';
  const password = 'test123';
  const firstName = 'Test';
  const lastName = 'User';
  const role = 'user';

  try {
    // Hash password
    const passwordHash = bcrypt.hashSync(password, 10);

    // Check if user already exists
    const existing = await pool.query(
      'SELECT id FROM global_auth.user_credentials WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      console.log(`❌ User ${email} already exists`);
      console.log(`   User ID: ${existing.rows[0].id}`);
      await pool.end();
      return;
    }

    // Insert test user
    const externalUserId = uuidv4();

    const result = await pool.query(
      `INSERT INTO global_auth.user_credentials (user_id, email, password_hash, first_name, last_name, role, is_active, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, true, true)
       RETURNING id, email, first_name, last_name, role, created_at, user_id`,
      [externalUserId, email, passwordHash, firstName, lastName, role]
    );

    const user = result.rows[0];

    console.log('✅ Test user created successfully!');
    console.log('');
    console.log('User Details:');
    console.log(`  ID: ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Password: ${password}`);
    console.log(`  Name: ${user.first_name} ${user.last_name}`);
    console.log(`  Role: ${user.role}`);
    console.log(`  External User ID: ${user.user_id}`);
    console.log(`  Created: ${user.created_at}`);
    console.log('');
    console.log('Test Login:');
    console.log(`  curl -X POST http://localhost:3200/api/auth/login \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -d '{"email":"${email}","password":"${password}"}'`);

    await pool.end();
  } catch (error) {
    console.error('Error creating test user:', error.message);
    await pool.end();
    process.exit(1);
  }
}

createTestUser();
