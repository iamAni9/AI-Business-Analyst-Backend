import multer from "multer";
import path from "path";
import fs from "fs";

// Defining path for storing uploaded files
const uploadsDir = path.join(__dirname, '..', 'uploads');

// If the uploads directory doesn't exist, creating it
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Uploaded files will get store in 'uploads/' directory
const upload = multer({ dest: uploadsDir });

export default upload;


// // src/utils/multer.ts or similar
// import multer from "multer";
// import path from "path";
// import fs from "fs";

// const uploadsDir = path.join(__dirname, '..', 'uploads');

// // Ensure the directory exists
// if (!fs.existsSync(uploadsDir)) {
//   fs.mkdirSync(uploadsDir, { recursive: true });
// }

// // Use diskStorage with unique filenames
// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     cb(null, uploadsDir);
//   },
//   filename: function (req, file, cb) {
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
//     const originalName = file.originalname.replace(/\s+/g, '_');
//     cb(null, `${uniqueSuffix}-${originalName}`);
//   }
// });

// const upload = multer({ storage });

// export default upload;
