import pool from '../config/postgres';
import logger from '../config/logger';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { DATA_TIME_FORMAT } from '../config/constants';
import { TableSchema } from '../interfaces/dbUtilsInterfaces';

dayjs.extend(customParseFormat);

export const createTableFromSchema = async (tableName: string, schema: any) => {
  try {
    // Creating table using the generated schema from analysis
    const columnDefinitions = schema.columns.map((col: any) => 
      // `"${col.column_name}" ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`
      `"${col.column_name}" ${col.data_type}`
    ).join(',\n');

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        ${columnDefinitions}
      );
    `;

    await pool.query(createTableQuery);
    logger.info(`Table ${tableName} created successfully`);
    return true;
  } catch (error) {
    logger.error('Error creating table from schema:', error);
    throw error;
  }
};

// Typecasting value during insertion
export const typecastValue = (value: string | null, type: string): any => {
  if (value === null) return null;

  switch (type.toLowerCase()) {
    case 'integer':
    case 'int':
    case 'smallint':
    case 'bigint':
      return parseInt(value, 10) || null;

    case 'real':
    case 'double precision':
    case 'float':
    case 'numeric':
    case 'decimal':
      return parseFloat(value) || null;

    case 'boolean':
      return ['true', '1', 'yes'].includes(value.toLowerCase()) ? true :
             ['false', '0', 'no'].includes(value.toLowerCase()) ? false :
             null;

    case 'date':
    case 'timestamp':
    case 'timestamp without time zone':
    case 'timestamp with time zone': {
      const formats = DATA_TIME_FORMAT;

      for (const format of formats) {
        const parsed = dayjs(value, format, true); // strict parsing
        if (parsed.isValid()) return parsed.toDate(); // convert to JS Date
      }
      return null; // Unrecognized format
    }

    default:
      return value;
  }
};

// Batch insertion
export const insertBatchWithSchema = async (
  batch: Record<string, any>[],
  tableName: string,
  schema: TableSchema
): Promise<void> => {
  const columns = schema.columns.map(col => col.column_name);
  // const values: any[] = batch.map(row => columns.map(col => row[col]));
  const values: any[] = batch.map(row =>
    columns.map(col => row[col] !== undefined ? row[col] : null)
  );
  
  const flatValues = values.flat();
  
  logger.info(`Inserting ${batch.length} rows with ${columns.length} columns each`);
  logger.info(`Total parameters: ${flatValues.length}`);

  if (flatValues.length === 0 || batch.length === 0) {
    console.warn(`Skipping insert into ${tableName} — no values to insert.`);
    return;
  }
  
  const expectedParams = batch.length * columns.length;
  if (flatValues.length !== expectedParams) {
    throw new Error(`Parameter count mismatch. Expected ${expectedParams}, got ${flatValues.length}`);
  }

  const valuePlaceholders = batch.map((_, i) => {
    const offset = i * columns.length;
    const rowPlaceholders = columns.map((_, j) => `$${offset + j + 1}`);
    return `(${rowPlaceholders.join(', ')})`;
  }).join(', ');

  // logger.info("Place holder: ",valuePlaceholders);

  const query = `
    INSERT INTO "${tableName}" (${columns.map(col => `"${col}"`).join(', ')})
    VALUES ${valuePlaceholders};
  `;

  await pool.query(query, flatValues);
};