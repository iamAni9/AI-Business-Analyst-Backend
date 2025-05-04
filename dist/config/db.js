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
exports.pool = exports.initializeDatabase = exports.query = void 0;
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = require("fs");
const path_1 = require("path");
dotenv_1.default.config();
const pool = new pg_1.Pool({
    user: process.env.POSTGRES_USER,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT || "5432"),
});
exports.pool = pool;
pool.connect()
    .then(() => console.log('Connected to PostgreSQL'))
    .catch((err) => console.error('Connection error', err));
const query = (text, params) => pool.query(text, params);
exports.query = query;
const initializeDatabase = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🔄 Initializing database schema...');
        // Read and execute schema.sql
        const schemaPath = (0, path_1.join)(__dirname, 'schema.sql');
        const schemaSQL = (0, fs_1.readFileSync)(schemaPath, 'utf8');
        // Split the SQL file into individual statements
        const statements = schemaSQL
            .split(';')
            .map(statement => statement.trim())
            .filter(statement => statement.length > 0);
        // Execute each statement
        for (const statement of statements) {
            yield (0, exports.query)(statement);
        }
        console.log('✅ Database schema initialized successfully');
    }
    catch (error) {
        console.error('❌ Error initializing database schema:', error);
        throw error;
    }
});
exports.initializeDatabase = initializeDatabase;
// Initialize schema when this module is imported
(0, exports.initializeDatabase)().catch(console.error);
