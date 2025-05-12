import { Pool } from 'pg';
import logger from './logger';
import dotenv from 'dotenv';

dotenv.config();

// Validate environment variables





const pool = new Pool({
  user: process.env.POSTGRES_USER,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || "5432"),

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