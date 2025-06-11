import pool from '../config/postgres';
import logger from "../config/logger";

export const deteleTempTable = async (tableId: string) : Promise<any> => {
  try { 
    await pool.query('BEGIN');

    // 1. Deleting from analysis_table
    await pool.query(
      'DELETE FROM analysis_data WHERE table_name = $1',
      [tableId]
    );

    // 2. Droping the actual temp table
    const dropQuery = `DROP TABLE IF EXISTS "${tableId}"`;
    await pool.query(dropQuery);

    await pool.query('COMMIT');
    logger.info(`Successfully deleted table "${tableId}" and its entry in analysis_data.`);
    return true;
  } catch (error) {
    await pool.query('ROLLBACK');
    logger.error('Error while deleting data:', error);
    throw error;
  }
}