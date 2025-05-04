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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUsersTable = exports.createUserData = void 0;
const db_1 = require("../config/db");
const createUserData = () => __awaiter(void 0, void 0, void 0, function* () {
    // Drop existing user_data table if it exists
    // await query('DROP TABLE IF EXISTS user_data CASCADE');
    const createUserDataQuery = `
        CREATE TABLE IF NOT EXISTS user_data (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE NOT NULL,
            table_name VARCHAR(255) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            user_id UUID NOT NULL REFERENCES users(id)
        );
    `;
    try {
        yield (0, db_1.query)(createUserDataQuery);
        console.log('User data created successfully, table created or already exists');
    }
    catch (error) {
        console.error('Error creating user data:', error);
        throw new Error('Error creating user data');
    }
});
exports.createUserData = createUserData;
// Create users table if it doesn't exist
const createUsersTable = () => __awaiter(void 0, void 0, void 0, function* () {
    // Drop existing users table if it exists
    // await query('DROP TABLE IF EXISTS users CASCADE');
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            name VARCHAR(100) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;
    try {
        yield (0, db_1.query)(createTableQuery);
        console.log('Users table created or already exists');
        yield (0, exports.createUserData)();
    }
    catch (error) {
        console.error('Error creating users table:', error);
        throw new Error('Error creating users table');
    }
});
exports.createUsersTable = createUsersTable;
