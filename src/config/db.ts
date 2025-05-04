import { Pool } from "pg";
import dotenv from "dotenv";
import { readFileSync } from 'fs';
import { join } from 'path';

dotenv.config();

const pool = new Pool({
    user: process.env.POSTGRES_USER,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT || "5432"),
});

pool.connect()
  .then(() => console.log('Connected to PostgreSQL'))
  .catch((err: any) => console.error('Connection error', err));

export const query = (text: string, params?: any[]) => pool.query(text, params);

export const initializeDatabase = async () => {
    try {
        console.log('🔄 Initializing database schema...');
        
        // Read and execute schema.sql
        const schemaPath = join(__dirname, 'schema.sql');
        const schemaSQL = readFileSync(schemaPath, 'utf8');
        
        // Split the SQL file into individual statements
        const statements = schemaSQL
            .split(';')
            .map(statement => statement.trim())
            .filter(statement => statement.length > 0);
        
        // Execute each statement
        for (const statement of statements) {
            await query(statement);
        }
        
        console.log('✅ Database schema initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing database schema:', error);
        throw error;
    }
};

// Initialize schema when this module is imported
initializeDatabase().catch(console.error);

export { pool };  