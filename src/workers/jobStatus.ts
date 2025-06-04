// import { Job, Queue } from 'bullmq';
import { csvQueue } from './bullQueue';
import logger from "../config/logger";

export async function getJobStatus(uploadId: string) {
  try {
    // Now we can directly get the job using your uploadId since we set it as jobId
    const job = await csvQueue.getJob(uploadId);
    logger.info("Job: ", {job});

    if (!job) {
      return { 
        status: 'not_found',
        message: 'No job found with this upload ID'
      };
    }

    const state = await job.getState();
    const progress = job.progress;
    const result = job.returnvalue;
    
    return {
      status: state,
      progress,
      result,
      userid: job.data.userid,  // Include for verification
      originalFileName: job.data.originalFileName
    };
  } catch (error) {
    logger.error('Error checking job status:', error);
    return { status: 'error', message: 'Failed to check status' };
  }
}