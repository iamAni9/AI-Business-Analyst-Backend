"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dataController_1 = require("../controller/dataController");
const multer_1 = require("../config/multer");
const router = (0, express_1.Router)();
router.post("/upload", multer_1.upload.single('file'), dataController_1.uploadData);
router.get("/files", dataController_1.getAllUploadedFiles);
exports.default = router;
