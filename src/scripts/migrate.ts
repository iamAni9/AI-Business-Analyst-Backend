import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import logger from '../config/logger';
import dotenv from 'dotenv';

dotenv.config();

// Validate environment variables
const requiredEnvVars = ['POSTGRES_URI'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Validate PostgreSQL connection string format
const postgresUri = process.env.POSTGRES_URI!;
if (!postgresUri.startsWith('postgres://') && !postgresUri.startsWith('postgresql://')) {
  throw new Error('POSTGRES_URI must start with postgres:// or postgresql://');
}

const pool = new Pool({
  connectionString: postgresUri,
  // Add connection timeout
  connectionTimeoutMillis: 5000,
});

// Test database connection
async function testConnection() {
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    logger.info('Successfully connected to PostgreSQL');
  } catch (error) {
    logger.error('Failed to connect to PostgreSQL:', error);
    throw new Error('Database connection failed. Please check your POSTGRES_URI and ensure the database is running.');
  }
}

async function runMigrations() {
  const client = await pool.connect();
  
  try {
    // Create migrations table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Get all migration files
    const migrationsDir = path.join(__dirname, '../config/migrations');
    
    // Check if migrations directory exists
    if (!fs.existsSync(migrationsDir)) {
      logger.warn(`Migrations directory not found at ${migrationsDir}`);
      return;
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (migrationFiles.length === 0) {
      logger.warn('No migration files found');
      return;
    }

    logger.info(`Found ${migrationFiles.length} migration files`);

    // Run each migration
    for (const file of migrationFiles) {
      const migrationName = path.basename(file, '.sql');
      
      // Check if migration has been executed
      const { rows } = await client.query(
        'SELECT id FROM migrations WHERE name = $1',
        [migrationName]
      );

      if (rows.length === 0) {
        logger.info(`Running migration: ${migrationName}`);
        
        // Read and execute migration
        const migration = fs.readFileSync(
          path.join(migrationsDir, file),
          'utf8'
        );
        
        await client.query('BEGIN');
        try {
          await client.query(migration);
          await client.query(
            'INSERT INTO migrations (name) VALUES ($1)',
            [migrationName]
          );
          await client.query('COMMIT');
          logger.info(`Completed migration: ${migrationName}`);
        } catch (error) {
          await client.query('ROLLBACK');
          logger.error(`Failed to execute migration ${migrationName}:`, error);
          throw error;
        }
      } else {
        logger.info(`Skipping already executed migration: ${migrationName}`);
      }
    }
  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migrations
async function main() {
  try {
    await testConnection();
    await runMigrations();
    logger.info('All migrations completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

main(); 