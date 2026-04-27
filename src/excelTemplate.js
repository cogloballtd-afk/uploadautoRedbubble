import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const TEMPLATE_HEADERS = [
  "TT",
  "Title",
  "Main Tag",
  "Supporting Tags",
  "Description",
  "Image path",
  "color",
  "status",
  "status_detail",
  "executed_at"
];

const IMAGE_EXTENSIONS = new Set([".png"]);

export function listImageFiles(folderPath) {
  if (!fs.existsSync(folderPath)) {
    throw new Error(`Folder does not exist: ${folderPath}`);
  }
  const stat = fs.statSync(folderPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${folderPath}`);
  }

  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .filter((entry) => IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => ({
      fileName: entry.name,
      title: path.basename(entry.name, path.extname(entry.name)),
      fullPath: path.join(folderPath, entry.name)
    }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { sensitivity: "base" }));
}

export function buildExcelTemplate({ folderPath, excelPath }) {
  const images = listImageFiles(folderPath);

  const rows = [TEMPLATE_HEADERS];
  const ttIndex = TEMPLATE_HEADERS.indexOf("TT");
  const titleIndex = TEMPLATE_HEADERS.indexOf("Title");
  const imagePathIndex = TEMPLATE_HEADERS.indexOf("Image path");

  images.forEach((image, index) => {
    const row = new Array(TEMPLATE_HEADERS.length).fill("");
    row[ttIndex] = index + 1;
    row[titleIndex] = image.title;
    row[imagePathIndex] = image.fullPath;
    rows.push(row);
  });

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  XLSX.writeFile(workbook, excelPath);

  return {
    excelPath,
    rowsAdded: images.length,
    headers: TEMPLATE_HEADERS
  };
}
