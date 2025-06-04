import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

const connection = new Redis(process.env.REDIS_URL!); // default: localhost:6379

export const csvQueue = new Queue('csv-processing', { connection });