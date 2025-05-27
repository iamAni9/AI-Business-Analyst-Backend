import { Router, Request, Response, RequestHandler } from "express";
import logger from "../config/logger";
import upload from "../middlewares/multer";
import { v4 as uuidv4 } from 'uuid';
import { generateAnalysis } from "../controllers/dataController";
import { queueManager } from '../workers/queueManager';
import pool from '../config/postgres';

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
        const uniqueTableId = generateTableId();
        const tableName = `table_${uniqueTableId}`;
        const filePath = file.path;

        logger.info('Processing file:', { originalName: file.originalname, tableName, filePath });

        // Sending job to queue for async processing (LLM, schema, DB, final_schema_and_metadata)
        await queueManager.addJob({
          filePath,
          tableName,
          userid,
          email,
          uploadId: uniqueTableId,
          originalFileName: file.originalname
        });

        uploadResults.push({
          success: true,
          message: 'Upload accepted',
          originalFileName: file.originalname,
          uploadId: uniqueTableId,
          tableName,
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



// ----------I am not using this route---------------
// Enhanced generate-analysis endpoint
// router.post("/generate-analysis", async (req: Request, res: Response) => {
//   try {
//     const { table_name, email } = req.body;
    
//     if (!table_name || !email) {
//       res.status(400).json({
//         success: false,
//         message: 'Table name and email are required'
//       });
//       return;
//     }

//     // Check if user exists
//     const userExists = await checkUserExists(email);
//     if (!userExists) {
//       res.status(404).json({
//         success: false,
//         message: 'User not found. Please register first.'
//       });
//       return;
//     }

//     // Check if analysis already exists
//     const existingAnalysis = await getAnalysisData(table_name);
//     if (existingAnalysis) {
//       logger.info('Using existing analysis for table:', table_name);
//       res.status(200).json({
//         success: true,
//         message: 'Analysis retrieved successfully',
//         analysis: existingAnalysis
//       });
//       return;
//     }

//     // Generate new analysis
//     // await generateAnalysis(req, res);
//   } catch (error) {
//     logger.error('Error in generate-analysis:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error generating analysis',
//       error: error instanceof Error ? error.message : 'Unknown error'
//     });
//   }
// });

export default router;


