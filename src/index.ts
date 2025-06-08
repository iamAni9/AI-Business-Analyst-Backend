import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import morgan from "morgan";
import logger, { stream } from "./config/logger";
import dotenv from 'dotenv';
import session from 'express-session';
import connectPgSimple   from "connect-pg-simple";
import pool from "./config/postgres";
import { SESSION_EXPIRY } from "./config/constants";

import userRoutes from "./routes/userRoutes";
import dataRoutes from "./routes/dataRoutes";
import chatRoutes from "./routes/chatRoutes";
// import { query } from "./ai/client";

dotenv.config();

const app = express();
app.set('trust proxy', 1);

// Middlewares
const allowedOrigins = process.env.FRONTEND_ORIGIN?.split(',').map(origin => origin.trim()) || [];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.error(`CORS blocked: ${origin} not in ${allowedOrigins}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Session middleware 
const PgSession = connectPgSimple(session);

app.use(session({
  store: new PgSession({
    pool: pool,
    createTableIfMissing: true, 
  }),
  secret: process.env.SESSION_SECRET || 'fallback-secret',  
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_EXPIRY,
   }
}));

app.use(morgan('combined', { stream })); // Request logging middleware

app.use(express.json());
// Handle malformed JSON errors
app.use(((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err && (err as any).status === 400) {
    logger.error('Malformed JSON in request', { error: err.message });
    return res.status(400).json({
      success: false,
      message: 'Malformed JSON in request body',
    });
  }
  next(err);
}) as express.ErrorRequestHandler);


// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal Server Error' });
});


declare module 'express-session' {
  interface SessionData {
    user?: {
      id: string;
      name: string;
      email: string;
    };
  }
}

// Example route with logging
app.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info('Home route accessed');
    res.json({ message: 'Welcome to the API' });
  } catch(err) {
    next(err);
  }
});

// Health check endpoint
app.get('/health', (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info('Health check accessed');
    res.status(200).json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'backend-service'
    });
  } catch (err) {
    next(err);
  }
});

app.use("/v1/api/users", userRoutes)
app.use("/v1/api/data", dataRoutes)
app.use("/v1/api/chat", chatRoutes)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server is running on localhost:port ${PORT}`);
});