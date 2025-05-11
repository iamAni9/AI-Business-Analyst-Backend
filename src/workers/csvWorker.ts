import fs from 'fs';
import pool from '../config/postgres';
import logger from '../config/logger';
import { v4 as uuidv4 } from 'uuid';
import { queueManager } from './queueManager';
import { parse } from 'csv-parse';

export interface CSVJobData {
  filePath: string;
  tableName: string;
  email: string;
  uploadId: string;
}

const updateProgress = (uploadId: string, progress: number) => {
  const currentStatus = queueManager.getJobStatus(uploadId);
  if (currentStatus) {
    queueManager.updateJobStatus(uploadId, {
      ...currentStatus,
      progress
    });
  }
};

const createTableFromCSV = async (filePath: string, tableName: string) => {
  return new Promise((resolve, reject) => {
    const columns: { name: string; type: string }[] = [];
    const parser = fs.createReadStream(filePath).pipe(parse({
      columns: true,
      skip_empty_lines: true,
      trim: true
    }));

    parser.on('readable', () => {
      let record;
      while ((record = parser.read()) !== null) {
        // Infer column types from the first row
        if (columns.length === 0) {
          Object.entries(record).forEach(([key, value]) => {
            let type = 'TEXT';
            if (typeof value === 'number') {
              type = 'NUMERIC';
            } else if (value instanceof Date) {
              type = 'TIMESTAMP';
            }
            columns.push({ name: key, type });
          });
        }
      }
    });

    parser.on('end', async () => {
      try {
        // Create table
        const createTableQuery = `
          CREATE TABLE IF NOT EXISTS ${tableName} (
            ${columns.map(col => `"${col.name}" ${col.type}`).join(',\n')}
          );
        `;
        await pool.query(createTableQuery);
        resolve(columns);
      } catch (error) {
        reject(error);
      }
    });

    parser.on('error', reject);
  });
};

const importCSVData = async (filePath: string, tableName: string) => {
  return new Promise((resolve, reject) => {
    const parser = fs.createReadStream(filePath).pipe(parse({
      columns: true,
      skip_empty_lines: true,
      trim: true
    }));

    let batch: any[] = [];
    const batchSize = 1000;

    parser.on('readable', async () => {
      let record;
      while ((record = parser.read()) !== null) {
        batch.push(record);
        if (batch.length >= batchSize) {
          await insertBatch(batch, tableName);
          batch = [];
        }
      }
    });

    parser.on('end', async () => {
      try {
        if (batch.length > 0) {
          await insertBatch(batch, tableName);
        }
        resolve(true);
      } catch (error) {
        reject(error);
      }
    });

    parser.on('error', reject);
  });
};

const insertBatch = async (batch: any[], tableName: string) => {
  if (batch.length === 0) return;

  const columns = Object.keys(batch[0]);
  const values = batch.map(row => 
    columns.map(col => row[col])
  );

  const placeholders = batch.map((_, i) => 
    `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`
  ).join(', ');

  const query = `
    INSERT INTO ${tableName} (${columns.map(c => `"${c}"`).join(', ')})
    VALUES ${placeholders}
  `;

  await pool.query(query, values.flat());
};

export const processCSV = async (jobData: CSVJobData): Promise<void> => {
  const { filePath, tableName, email, uploadId } = jobData;
  
  try {
    // Update progress to 10% - Starting CSV processing
    updateProgress(uploadId, 10);
    logger.info('Starting CSV processing:', { filePath, tableName, uploadId });

    // Create table from CSV structure
    await createTableFromCSV(filePath, tableName);
    updateProgress(uploadId, 30);

    // Import CSV data
    await importCSVData(filePath, tableName);
    updateProgress(uploadId, 60);

    // Insert user data
    const id = uuidv4();
    const created_at = new Date();
    const updated_at = created_at;
    
    const userDataQuery = `
      INSERT INTO users_data (id, email, table_name, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;

    // Update progress to 80% - Starting user data insertion
    updateProgress(uploadId, 80);

    const { rows } = await pool.query(userDataQuery, [id, email, tableName, created_at, updated_at]);
    logger.info('User data inserted:', { id: rows[0].id });

    // Update progress to 90% - Starting file cleanup
    updateProgress(uploadId, 90);

    // Delete the file after successful upload
    try {
      fs.unlinkSync(filePath);
      logger.info('File deleted successfully:', { filePath });
    } catch (deleteError) {
      logger.error('Error deleting file:', { 
        error: deleteError instanceof Error ? deleteError.message : 'Unknown error',
        stack: deleteError instanceof Error ? deleteError.stack : undefined,
        filePath
      });
    }

    // Update progress to 100% - All operations completed
    updateProgress(uploadId, 100);
    logger.info('CSV processing completed successfully:', { uploadId });

  } catch (error) {
    logger.error('Error processing CSV:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      jobData: {
        filePath,
        tableName,
        email,
        uploadId
      }
    });

    // Update job status to failed
    const currentStatus = queueManager.getJobStatus(uploadId);
    if (currentStatus) {
      queueManager.updateJobStatus(uploadId, {
        ...currentStatus,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    throw error;
  }
}; 