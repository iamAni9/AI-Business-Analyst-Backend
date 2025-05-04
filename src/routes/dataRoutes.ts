import { Router, RequestHandler } from "express";
import { uploadData, getAllUploadedFiles } from "../controller/dataController";
import { upload } from "../config/multer";

const router = Router();

router.post("/upload", upload.single('file'), uploadData as RequestHandler);
router.get("/files", getAllUploadedFiles as RequestHandler);

export default router;