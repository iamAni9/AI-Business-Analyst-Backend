import {RequestHandler, Router} from 'express';
import { signUpUser, signInUser } from '../controller/userController';

const router = Router();

router.post("/signup", signUpUser as RequestHandler)
router.post("/signIn", signInUser as RequestHandler)
export default router;