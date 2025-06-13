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
// export const insertBatchWithSchema = async (
//   batch: Record<string, any>[],
//   tableName: string,
//   schema: TableSchema
// ): Promise<void> => {
//   const columns = schema.columns.map(col => col.column_name);
//   // const values: any[] = batch.map(row => columns.map(col => row[col]));
//   const values: any[] = batch.map(row =>
//     columns.map(col => row[col] !== undefined ? row[col] : null)
//   );
  
//   const flatValues = values.flat();
  
//   logger.info(`Inserting ${batch.length} rows with ${columns.length} columns each`);
//   logger.info(`Total parameters: ${flatValues.length}`);

//   if (flatValues.length === 0 || batch.length === 0) {
//     console.warn(`Skipping insert into ${tableName} — no values to insert.`);
//     return;
//   }
  
//   const expectedParams = batch.length * columns.length;
//   if (flatValues.length !== expectedParams) {
//     throw new Error(`Parameter count mismatch. Expected ${expectedParams}, got ${flatValues.length}`);
//   }

//   const valuePlaceholders = batch.map((_, i) => {
//     const offset = i * columns.length;
//     const rowPlaceholders = columns.map((_, j) => `$${offset + j + 1}`);
//     return `(${rowPlaceholders.join(', ')})`;
//   }).join(', ');

//   // logger.info("Place holder: ",valuePlaceholders);

//   const query = `
//     INSERT INTO "${tableName}" (${columns.map(col => `"${col}"`).join(', ')})
//     VALUES ${valuePlaceholders};
//   `;

//   await pool.query(query, flatValues);
// };




// Helper to alter column type
export const alterColumnType = async (
  tableName: string,
  columnName: string,
  newType: string
): Promise<void> => {
  if (!tableName || !columnName || !newType) {
        console.error("Invalid parameters for alterColumnType. Aborting ALTER query.");
        throw new Error("Cannot alter table with empty table/column/type name.");
    }
  const query = `ALTER TABLE "${tableName}" ALTER COLUMN "${columnName}" TYPE ${newType}`;
  await pool.query(query);
};

// Error pattern matcher with conversion logic
export const getTypeConversion = (error: any): { columnName: string, newType: string } | null => {
    const message = error.message || '';
    let columnName = '';

    // --- New logic to extract column name ---
    // First, try the direct property (might work in some cases)
    if (error.column) {
        columnName = error.column;
    } 
    // If not, parse the 'where' string from the COPY error
    else if (error.where) {
        const columnMatch = error.where.match(/column\s+([^\s:]+):/);
        if (columnMatch && columnMatch[1]) {
            columnName = columnMatch[1];
        }
    }
    // --- End of new logic ---

    // If we couldn't find a column name, we can't proceed.
    if (!columnName) {
        return null;
    }

    // Now, determine the new type based on the error message
    // Handles the original "2400000000" error
    if (message.includes('out of range for type integer')) {
        return { columnName, newType: 'BIGINT' };
    }

    // Handles the "funding_rounds" text-in-int-column error
    // While the root cause is the missing HEADER option, if a *real* data row
    // had bad data, this would catch it and suggest changing the type.
    if (message.includes('invalid input syntax for type integer')) {
        // This could mean the column should be BIGINT for a numeric overflow,
        // or TEXT if it contains non-numeric data. BIGINT is a safe bet for upgrades.
        return { columnName, newType: 'BIGINT' };
    }

    // Add other conversion patterns here as needed (e.g., for varchar)
    if (message.includes('value too long for type character varying')) {
        return { columnName, newType: 'TEXT' };
    }

    return null;
};

// Main insertion function with the hybrid strategy
export const insertBatchWithSchema = async (
    batch: Record<string, any>[],
    tableName: string,
    schema: TableSchema,
    maxRetries = 3
): Promise<void> => {
    if (maxRetries <= 0) {
        throw new Error(`Schema correction failed after multiple attempts.`);
    }

    try {
        // --- STEP 1: Attempting the fast batch insert ---
        const columns = schema.columns.map(col => col.column_name);
        const values = batch.map(row => columns.map(col => row[col] ?? null));
        const flatValues = values.flat();

        if (flatValues.length === 0) return;

        logger.info(`Inserting ${batch.length} rows with ${columns.length} columns each`);
        logger.info(`Total parameters: ${flatValues.length}`);

        const valuePlaceholders = batch.map((_, i) => {
            const offset = i * columns.length;
            const rowPlaceholders = columns.map((_, j) => `$${offset + j + 1}`);
            return `(${rowPlaceholders.join(', ')})`;
        }).join(', ');

        const query = `
            INSERT INTO "${tableName}" (${columns.map(col => `"${col}"`).join(', ')})
            VALUES ${valuePlaceholders};
        `;
        await pool.query(query, flatValues);

    } catch (error: any) {
        // --- STEP 2: Catching the error and determining if it's fixable ---
        const conversion = getTypeConversion(error);

        if (conversion) {
            console.warn(`Batch insert failed. Starting diagnostic mode to find the problematic column.`);

            // --- STEP 3 & 4: Isolating the column and fixing the schema ---
            const failingColumn = await findFailingColumn(batch, tableName, schema);
            
            if (failingColumn) {
                console.warn(`Converting column "${failingColumn}" to ${conversion.newType}`);
                await alterColumnType(tableName, failingColumn, conversion.newType);

                // --- STEP 5: Retring the entire batch with the corrected schema ---
                console.info("Schema corrected. Retrying batch insert...");
                // Note: We don't need to update the local schema object because the next attempt will succeed on the DB level.
                // We can re-fetch it if needed, but for this logic, it's not required.
                return insertBatchWithSchema(batch, tableName, schema, maxRetries - 1);
            }
        }
        // If it is not fixable
        throw error;
    }
};

// Helper function to find the exact failing column by inserting rows one-by-one.
const findFailingColumn = async (
    batch: Record<string, any>[],
    tableName: string,
    schema: TableSchema,
): Promise<string | null> => {
    const columns = schema.columns.map(col => col.column_name);

    for (const row of batch) {
        try {
            const values = columns.map(col => row[col] ?? null);
            const valuePlaceholders = columns.map((_, i) => `$${i + 1}`).join(', ');
            logger.info(`Inserting ${values} into ${valuePlaceholders}`);

            const query = `
                INSERT INTO "${tableName}" (${columns.map(col => `"${col}"`).join(', ')})
                VALUES (${valuePlaceholders});
            `;
            await pool.query(query, values);

        } catch (error: any) {
            // This error is from a single-row insert and is much more likely to be specific.
            if (error.column) {
                console.log(`Diagnostic success: Found failing column: "${error.column}"`);
                return error.column; // SUCCESS!
            }
        }
    }
    
    // This part is tricky. If a row fails but we can't get the column,
    // we might need to delete the rows from this batch that succeeded before the failure.
    // For simplicity, this example assumes the transaction will be rolled back.
    // If you don't use transactions per batch, you need to handle partial inserts.
    console.error("Diagnostic failed: A row failed to insert, but could not identify the specific column.");
    return null;
};


