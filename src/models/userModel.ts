import { query } from '../config/db';

export interface User {
    id: string;
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    created_at: Date;
    updated_at: Date;
}

export interface UserData {
    id: string;
    email: string;
    table_name: string;
    user_id: string;
    created_at: Date;
    updated_at: Date;
}
export const createUserData = async () => {
    // Drop existing user_data table if it exists
    await query('DROP TABLE IF EXISTS user_data CASCADE');
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
        await query(createUserDataQuery);
        console.log('User data created successfully, table created or already exists');
    } catch (error) {
        console.error('Error creating user data:', error);
        throw new Error('Error creating user data');
    }
}

// Create users table if it doesn't exist
export const createUsersTable = async () => {
    // Drop existing users table if it exists
    await query('DROP TABLE IF EXISTS users CASCADE');
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
        await query(createTableQuery);
        console.log('Users table created or already exists');
        await createUserData();
    } catch (error) {
        console.error('Error creating users table:', error);
        throw new Error('Error creating users table');
    }
};


