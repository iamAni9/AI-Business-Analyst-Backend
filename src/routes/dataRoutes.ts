import { Router, Request, Response, RequestHandler } from "express";
import logger from "../config/logger";
import upload from "../middlewares/multer";
import { v4 as uuidv4 } from 'uuid';
import { generateAnalysis } from "../controllers/dataController";
import { queueManager } from '../workers/queueManager';
import pool from '../config/postgres';

const router = Router();

// Generate a unique ID for each upload
const generateUploadId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// Sanitize table name to be PostgreSQL compatible
const sanitizeTableName = (tableName: string): string => {
  // Replace hyphens and other special characters with underscores
  // and ensure the name starts with a letter
  const sanitized = tableName
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^[^a-zA-Z]/, 't_');
  
  // Ensure the name is not longer than 63 characters (PostgreSQL limit)
  return sanitized.slice(0, 63);
};

// Check if user exists in the database
const checkUserExists = async (email: string): Promise<boolean> => {
  try {
    const result = await pool.query(
      'SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)',
      [email]
    );
    return result.rows[0].exists;
  } catch (error) {
    logger.error('Error checking user existence:', error);
    throw error;
  }
};

// Get analysis data for a table
const getAnalysisData = async (tableName: string): Promise<any> => {
  try {
    const result = await pool.query(
      'SELECT * FROM analysis_data WHERE table_id = $1 ORDER BY created_at DESC LIMIT 1',
      [tableName]
    );
    return result.rows[0];
  } catch (error) {
    logger.error('Error retrieving analysis data:', error);
    throw error;
  }
};

router.post("/upload-csv", upload.single('file'), async (req: Request, res: Response) => {
  const uploadId = generateUploadId();
  
  try {
    const { tableName, email } = req.body;
    
    if (!req.file || !tableName || !email) {
      logger.error('Missing required fields:', { tableName, email, filePath: req.file?.path });
      res.status(400).json({ 
        success: false,
        message: 'file, tableName, and email are required',
        uploadId,
        status: 'failed'
      });
      return;
    }

    // Check if user exists before proceeding
    const userExists = await checkUserExists(email);
    if (!userExists) {
      logger.error('User not found:', { email });
      res.status(404).json({
        success: false,
        message: 'User not found. Please register first.',
        uploadId,
        status: 'failed'
      });
      return;
    }

    const sanitizedTableName = sanitizeTableName(tableName);
    
    logger.info('Uploading CSV:', { 
      originalTableName: tableName,
      sanitizedTableName,
      filePath: req.file?.path, 
      uploadId,
      email
    });
  
    const filePath = req.file.path;
    logger.info('File path:', filePath);

    // Add job to queue with sanitized table name
    await queueManager.addJob({
      filePath,
      tableName: sanitizedTableName,
      email,
      uploadId
    });

    res.json({ 
      success: true, 
      message: 'CSV upload initiated',
      uploadId,
      status: 'pending',
      sanitizedTableName
    });

  } catch (error) {
    logger.error('Error initiating CSV upload:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal Server Error',
      uploadId,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Enhanced endpoint to check upload status
router.get("/upload-status/:uploadId", (req: Request, res: Response) => {
  const { uploadId } = req.params;
  const status = queueManager.getJobStatus(uploadId);
  
  if (!status) {
    res.status(404).json({ 
      success: false, 
      message: 'Upload ID not found',
      uploadId
    });
    return;
  }

  res.json({ 
    success: true, 
    uploadId, 
    ...status
  });
});

// Enhanced generate-analysis endpoint
router.post("/generate-analysis", async (req: Request, res: Response) => {
  try {
    const { table_name, email } = req.body;
    
    if (!table_name || !email) {
      res.status(400).json({
        success: false,
        message: 'Table name and email are required'
      });
      return;
    }

    // Check if user exists
    const userExists = await checkUserExists(email);
    if (!userExists) {
      res.status(404).json({
        success: false,
        message: 'User not found. Please register first.'
      });
      return;
    }

    // Check if analysis already exists
    const existingAnalysis = await getAnalysisData(table_name);
    if (existingAnalysis) {
      logger.info('Using existing analysis for table:', table_name);
      res.status(200).json({
        success: true,
        message: 'Analysis retrieved successfully',
        analysis: existingAnalysis
      });
      return;
    }

    // Generate new analysis
    await generateAnalysis(req, res);
  } catch (error) {
    logger.error('Error in generate-analysis:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating analysis',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;