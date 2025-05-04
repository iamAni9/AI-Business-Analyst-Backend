"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const body_parser_1 = __importDefault(require("body-parser"));
const db_1 = require("./config/db");
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
const userModel_1 = require("./models/userModel");
const dataRoutes_1 = __importDefault(require("./routes/dataRoutes"));
const chatRoutes_1 = __importDefault(require("./routes/chatRoutes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = 3000;
app.use((0, cors_1.default)());
app.use(body_parser_1.default.json());
app.use(body_parser_1.default.urlencoded({ extended: true }));
app.use(express_1.default.json());
// Initialize database tables
const initializeDatabase = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Test database connection
        yield (0, db_1.query)('SELECT NOW()');
        console.log('Database connection test successful');
        // Create users table
        yield (0, userModel_1.createUsersTable)();
        console.log('Database tables initialized successfully');
    }
    catch (error) {
        console.error('Database initialization failed:', error);
        process.exit(1); // Exit if database initialization fails
    }
});
// Initialize database before starting the server
initializeDatabase().then(() => {
    app.use('/api/v1/users', userRoutes_1.default);
    app.use('/api/v1/data', dataRoutes_1.default);
    app.use('/api/v1/chat', chatRoutes_1.default);
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
});
