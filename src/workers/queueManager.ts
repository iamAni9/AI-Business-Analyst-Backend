import { processCSV, CSVJobData } from './csvWorker';
import logger from '../config/logger';

interface JobStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  progress?: number;
}

class QueueManager {
  private static instance: QueueManager;
  private jobStatuses: Map<string, JobStatus> = new Map();
  private processingQueue: CSVJobData[] = [];
  private isProcessing: boolean = false;

  private constructor() {}

  static getInstance(): QueueManager {
    if (!QueueManager.instance) {
      QueueManager.instance = new QueueManager();
    }
    return QueueManager.instance;
  }

  async addJob(jobData: CSVJobData): Promise<void> {
    this.jobStatuses.set(jobData.uploadId, { status: 'pending', progress: 0 });
    this.processingQueue.push(jobData);
    this.processNextJob();
  }

  getJobStatus(uploadId: string): JobStatus | undefined {
    return this.jobStatuses.get(uploadId);
  }

  updateJobStatus(uploadId: string, status: JobStatus) {
    this.jobStatuses.set(uploadId, status);
  }

  // For cleaning up the completed job
  private scheduleCleanup(uploadId: string, delay: number) {
    setTimeout(() => {
      this.jobStatuses.delete(uploadId);
    }, delay);  
  }

  private async processNextJob(): Promise<void> {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const jobData = this.processingQueue.shift()!;

    try {
      this.jobStatuses.set(jobData.uploadId, { status: 'processing', progress: 0 });
      await processCSV(jobData);
      this.jobStatuses.set(jobData.uploadId, { status: 'completed', progress: 100 });
      this.scheduleCleanup(jobData.uploadId, 3600000); // 1hr delay
    } catch (error) {
      logger.error('Error processing job:', error);
      this.jobStatuses.set(jobData.uploadId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        progress: 0
      });
      this.scheduleCleanup(jobData.uploadId, 86400000); // 24hr delay for failed job
    } finally {
      this.isProcessing = false;
      this.processNextJob();
    }
  }
}

export const queueManager = QueueManager.getInstance(); 