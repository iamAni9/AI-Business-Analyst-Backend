import express, { Request, Response } from "express";
import cors from "cors";
import morgan from "morgan";
import logger, { stream } from "./config/logger";
import dotenv from 'dotenv';

import userRoutes from "./routes/userRoutes";
import dataRoutes from "./routes/dataRoutes";

import chatRoutes from "./routes/chatRoutes";



// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use(morgan('combined', { stream }));

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal Server Error' });
});

// Example route with logging
app.get('/', (req, res) => {
  logger.info('Home route accessed');
  res.json({ message: 'Welcome to the API' });
});

 


app.use("/v1/api/users", userRoutes)
app.use("/v1/api/data", dataRoutes)
app.use("/v1/api/chat", chatRoutes)




const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});