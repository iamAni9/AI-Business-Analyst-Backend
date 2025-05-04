import { Request, Response } from "express";
import { query } from "../config/db";
import bcrypt from "bcryptjs";

const signUpUser = async(req: Request, res: Response)=>{
    console.log("signUpUser");

    try {
        const {name, email, password} = req.body;
        if(!name || !email || !password){
             res.status(400).json({
                success: false,
                message: "All fields are required"
            });
            return
        }

        // Check if user already exists
        const existingUser = await query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: "User with this email already exists"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await query(
            `INSERT INTO users (name, email, password) 
             VALUES ($1, $2, $3) 
             RETURNING id, name, email, created_at, updated_at`,
            [name, email, hashedPassword]
        );

        if(!newUser || !newUser.rows[0]){
            return res.status(400).json({
                success: false,
                message: "Failed to create user"
            });
        }

        return res.status(201).json({
            success: true,
            message: "User created successfully",  
            data: newUser.rows[0]
        });

    } catch (error) {
        console.error('Signup error:', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
}

const signInUser = async(req: Request, res: Response)=>{
    console.log("signInUser");
    try {
        const {email, password} = req.body;
        if(!email || !password){
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }
        const user = await query('SELECT * FROM users WHERE email = $1', [email]);
        if(!user || !user.rows[0]){
             res.status(400).json({
                success: false,
                message: "User not found"
            });
            return
        }
        const isPasswordValid = await bcrypt.compare(password, user.rows[0].password);
        if(!isPasswordValid){
             res.status(400).json({
                success: false,
                message: "Invalid password"
            });
            return
        }
        // Remove password from response data
        const userData :{
            id: string;
            name: string;
            email: string;
            created_at: string;
            updated_at: string;
        } = {
            id: user.rows[0].id,
            name: user.rows[0].name,
            email: user.rows[0].email,
            created_at: user.rows[0].created_at,
            updated_at: user.rows[0].updated_at
        }
        return res.status(200).json({
            success: true,
            message: "User logged in successfully",
            data: userData
        });
    } catch (error) {
        console.error('Signin error:', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }

}

export {signUpUser, signInUser}