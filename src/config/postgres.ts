import { Pool } from 'pg';
import logger from './logger';
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

// Parse connection string to extract components for logging
const parseConnectionString = (uri: string) => {
  try {
    const url = new URL(uri);
    return {
      user: url.username,
      host: url.hostname,
      port: url.port,
      database: url.pathname.slice(1),
    };
  } catch (error) {
    logger.error('Invalid PostgreSQL connection string format');
    throw new Error('Invalid PostgreSQL connection string format');
  }
};

const connectionInfo = parseConnectionString("postgresql://admin:secret@localhost:5432/mydb");
logger.info(`Attempting to connect to PostgreSQL at ${connectionInfo.host}:${connectionInfo.port} as user ${connectionInfo.user}`);

const pool = new Pool({
  connectionString: "postgresql://admin:secret@localhost:5432/mydb",
  // Add connection timeout
  connectionTimeoutMillis: 5000,
  // Add SSL configuration if needed
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Test connection and log detailed error information
pool.on('error', (err) => {
  logger.error('Unexpected error on idle PostgreSQL client', err);
});

// Test connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    // Type assertion for PostgreSQL error
    const pgError = err as Error & {
      code?: string;
      detail?: string;
      hint?: string;
      position?: string;
      where?: string;
      schema?: string;
      table?: string;
      column?: string;
      dataType?: string;
      constraint?: string;
    };

    logger.error('Error connecting to PostgreSQL:', {
      error: pgError.message,
      code: pgError.code,
      detail: pgError.detail,
      hint: pgError.hint,
      position: pgError.position,
      where: pgError.where,
      schema: pgError.schema,
      table: pgError.table,
      column: pgError.column,
      dataType: pgError.dataType,
      constraint: pgError.constraint,
    });
    
    // Provide helpful error messages for common issues
    if (pgError.code === '28000') {
      logger.error('Authentication failed. Please check your username and password in POSTGRES_URI');
    } else if (pgError.code === '3D000') {
      logger.error('Database does not exist. Please create the database first');
    } else if (pgError.code === 'ECONNREFUSED') {
      logger.error('Could not connect to PostgreSQL server. Please ensure PostgreSQL is running');
    }
    
    throw err;
  }
  logger.info('Successfully connected to PostgreSQL');
});

export default pool; 