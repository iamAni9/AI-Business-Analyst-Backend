import { Router, Request, Response } from "express";
import logger from "../config/logger";
import upload from "../middlewares/multer";
import pool from '../config/postgres';
// import { v4 as uuidv4 } from 'uuid';
import { csvQueue, excelQueue, jsonQueue } from '../workers/bullQueue';
import { getJobStatus } from '../workers/jobStatus';
import path from 'path';
import { deteleTempTable } from "../utils/tableDeleteQuery";

const router = Router();

// Generate a unique ID for each upload
const generateTableId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
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

// // Get analysis data for a table
// const getAnalysisData = async (tableName: string): Promise<any> => {
//   try {
//     const result = await pool.query(
//       'SELECT * FROM analysis_data WHERE table_id = $1 ORDER BY created_at DESC LIMIT 1',
//       [tableName]
//     );
//     return result.rows[0];
//   } catch (error) {
//     logger.error('Error retrieving analysis data:', error);
//     throw error;
//   }
// };


router.post("/upload-csv", upload.array('files', 10), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!req.session.user) {
      res.status(401).json({ 
          success: false,
          message: 'Unauthorized' 
      });
      return;
    }
    const userid = req.session.user.id;
    const email = req.session.user.email;

    // logger.info("Upload attempt", {
    //   email: req.body.email,
    //   filesLength: files.length,
    //   filesReceived: files.map(f => f.originalname)
    // });
    
    if (!files || files.length === 0 || !userid || !email) {
      logger.error('Missing required fields:', { userid, email, files });
      res.status(400).json({
        success: false,
        message: 'At least one file and email are required',
        status: 'failed'
      });
      return;
    }

    // Check if user exists before proceeding
    // In future need to add the userid verification too
    const userExists = await checkUserExists(email);
    if (!userExists) {
      logger.error('User not found:', { email });
      res.status(404).json({
        success: false,
        message: 'User not found. Please register first.',
        status: 'failed'
      });
      return;
    }
      
    const uploadResults: any[] = [];
    for (const file of files) {
      try {
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueTableId = generateTableId();
        const tableName = `table_${uniqueTableId}`;
        const filePath = file.path;

        logger.info('Processing file:', { originalName: file.originalname, tableName, filePath });

        const jobData = {
          filePath,
          tableName,
          userid,
          email,
          uploadId: uniqueTableId,
          originalFileName: file.originalname
        };

        if (ext === '.csv') {
          await csvQueue.add('csv-processing', jobData, { jobId: uniqueTableId });
        } else if (ext === '.xlsx' || ext === '.xls') {
          await excelQueue.add('excel-processing', jobData, { jobId: uniqueTableId });
        } else if (ext === '.json') {
          await jsonQueue.add('json-processing', jobData, { jobId: uniqueTableId });
        } else {
          throw new Error(`Unsupported file format: ${ext}`);
        }

        uploadResults.push({
          success: true,
          message: 'Upload accepted',
          originalFileName: file.originalname,
          uploadId: uniqueTableId,
          tableName: tableName,
          status: 'pending'
        });

      } catch(error) {
        logger.error('Error initiating CSV upload:', error);
        uploadResults.push({
          success: false,
          message: 'Failed to process file',
          error: error instanceof Error ? error.message : 'Unknown error',
          fileName: file.originalname,
          status: 'failed'
        });
      }   
    } 
    res.json({
      success: true,
      message: 'Upload initiated for files',
      results: uploadResults
    });
  } catch (error) {
    logger.error("Unhandled error in upload handler:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// Enhanced endpoint to check upload status 
router.post("/upload-status/", (req: Request, res: Response) => {
  try {
    const { uploadId, type } = req.body;
    
    if (!uploadId || !type) {
      logger.error('Missing required fields:', { uploadId, type });
      res.status(400).json({
        success: false,
        message: 'Provide both fileId and type',
        status: 'failed'
      });
      return;
    }
    
    logger.info(`File id: ${uploadId} and type: ${type}`);
    setImmediate(async () => {
      const status = await getJobStatus(uploadId, type.toLowerCase());
      // const status = await queueManager.getJobStatus(uploadId);
      
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
  } catch (error) {
    logger.error("Unhandled error while checking status", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/delete-file/", async (req: Request, res: Response) => {
  try {
    const { fileId } = req.body;
    
    if (!req.session.user) {
      res.status(401).json({ 
          success: false,
          message: 'Unauthorized' 
      });
      return;
    }
    const userid = req.session.user.id;
    const email = req.session.user.email;

    if (!userid || !email) {
      logger.error('User does not authenticate.', { userid, email });
      res.status(400).json({
        success: false,
        message: 'May be user does not loggedIn or not exist.',
      });
      return;
    }

    const fileDeleted = await deteleTempTable(fileId);
    if (!fileDeleted) {
      logger.error('Error while deleting file:', { fileId });
      res.status(404).json({
        success: false,
        message: 'Error while deleting file.',
      });
      return;
    }

    res.json({
      success: true,
      message: 'File deleted successfully',
    });

  } catch (error) {
    logger.error("Unhandled error while deleting file:", error);
    res.status(500).json({ success: false, message: "Server error" });
  };
});

export default router;


