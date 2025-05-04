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
exports.signInUser = exports.signUpUser = void 0;
const db_1 = require("../config/db");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const signUpUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("signUpUser");
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            res.status(400).json({
                success: false,
                message: "All fields are required"
            });
            return;
        }
        // Check if user already exists
        const existingUser = yield (0, db_1.query)('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: "User with this email already exists"
            });
        }
        const hashedPassword = yield bcryptjs_1.default.hash(password, 10);
        const newUser = yield (0, db_1.query)(`INSERT INTO users (name, email, password) 
             VALUES ($1, $2, $3) 
             RETURNING id, name, email, created_at, updated_at`, [name, email, hashedPassword]);
        if (!newUser || !newUser.rows[0]) {
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
    }
    catch (error) {
        console.error('Signup error:', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});
exports.signUpUser = signUpUser;
const signInUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("signInUser");
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }
        const user = yield (0, db_1.query)('SELECT * FROM users WHERE email = $1', [email]);
        if (!user || !user.rows[0]) {
            res.status(400).json({
                success: false,
                message: "User not found"
            });
            return;
        }
        const isPasswordValid = yield bcryptjs_1.default.compare(password, user.rows[0].password);
        if (!isPasswordValid) {
            res.status(400).json({
                success: false,
                message: "Invalid password"
            });
            return;
        }
        // Remove password from response data
        const userData = {
            id: user.rows[0].id,
            name: user.rows[0].name,
            email: user.rows[0].email,
            created_at: user.rows[0].created_at,
            updated_at: user.rows[0].updated_at
        };
        return res.status(200).json({
            success: true,
            message: "User logged in successfully",
            data: userData
        });
    }
    catch (error) {
        console.error('Signin error:', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});
exports.signInUser = signInUser;
