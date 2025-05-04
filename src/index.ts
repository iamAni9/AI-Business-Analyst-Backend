import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { query } from "./config/db";
import userRoutes from "./routes/userRoutes";
import { createUsersTable } from "./models/userModel";
import dataRoutes from "./routes/dataRoutes";
import chatRoutes from "./routes/chatRoutes";


dotenv.config();

const app = express();
const PORT = 3000;
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// Initialize database tables
const initializeDatabase = async () => {
    try {
        // Test database connection
        await query('SELECT NOW()');
        console.log('Database connection test successful');

        // Create users table
        await createUsersTable();
        console.log('Database tables initialized successfully');
    } catch (error) {
        console.error('Database initialization failed:', error);
        process.exit(1); // Exit if database initialization fails
    }
};

// Initialize database before starting the server
initializeDatabase().then(() => {
    app.use('/api/v1/users', userRoutes);
    app.use('/api/v1/data', dataRoutes);
    app.use('/api/v1/chat', chatRoutes  );

    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
});



