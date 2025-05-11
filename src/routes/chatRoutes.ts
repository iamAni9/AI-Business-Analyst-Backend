import {RequestHandler, Router} from "express"
import { responseUserQuery } from "../controllers/chatController"
const router = Router()



router.post("/response", responseUserQuery as RequestHandler)

export default router