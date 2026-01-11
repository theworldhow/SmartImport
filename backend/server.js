// Suppress Node.js deprecation warnings from dependencies
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  // Only suppress DEP0060 (util._extend) warnings from dependencies
  if (warning.name === 'DeprecationWarning' && warning.code === 'DEP0060') {
    // Suppress this specific warning as it comes from dependencies
    return;
  }
  // Log other warnings
  console.warn(warning.name, warning.message);
});

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Papa = require('papaparse');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { Parser } = require('@json2csv/plainjs');
const OpenAI = require('openai');
const jobManager = require('./jobManager');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001; // Changed from 5000 to avoid conflict with AirPlay

// Initialize OpenAI client with extended timeout for complex transformations
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 300000, // 5 minutes timeout
  maxRetries: 2 // Retry on transient errors
}) : null;

// Middleware - CORS must be first
// Allow all origins in development for easier debugging
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Type']
}));

// Handle preflight requests explicitly
app.options('*', (req, res) => {
  console.log('[CORS] Preflight request for:', req.url);
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  res.sendStatus(200);
});

// Increase body parser limits to handle large JSON payloads (5GB)
app.use(express.json({ limit: '5gb' }));
app.use(express.urlencoded({ limit: '5gb', extended: true }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware for debugging
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log('[Request]', req.method, req.path, {
      contentType: req.headers['content-type'],
      origin: req.headers.origin,
      userAgent: req.headers['user-agent']?.substring(0, 50)
    });
  }
  next();
});

// Note: Error handling middleware moved to end of file (after all routes)

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024 // 5GB limit
  }
});

// Multer configuration for multiple files with specific field names
const uploadMultiple = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB limit per file
    files: 4 // Maximum 4 files
  },
  fileFilter: (req, file, cb) => {
    try {
      const fileExt = path.extname(file.originalname).toLowerCase();
      const allowedExtensions = ['.txt', '.csv', '.xlsx', '.xls', '.pdf', '.docx', '.doc'];
      
      console.log('[Multer] File filter check:', {
        filename: file.originalname,
        extension: fileExt,
        fieldname: file.fieldname,
        mimetype: file.mimetype
      });
      
      // Allow files with no extension (for delimited files)
      // Temporarily allow all files to debug 403 issue - validation happens in endpoint
      if (fileExt === '' || allowedExtensions.includes(fileExt) || fileExt === '.prf') {
        console.log('[Multer] File accepted:', file.originalname);
        cb(null, true);
      } else {
        console.log('[Multer] Warning: File extension not in standard list:', fileExt, 'but allowing for debugging');
        // Temporarily allow all files - we'll validate in the endpoint
        cb(null, true);
        // TODO: Re-enable strict filtering after debugging:
        // const error = new Error(`File type ${fileExt} is not allowed. Allowed types: ${allowedExtensions.join(', ')}`);
        // error.code = 'INVALID_FILE_TYPE';
        // cb(error, false);
      }
    } catch (error) {
      console.error('[Multer] File filter exception:', error);
      // Allow file on exception - validate in endpoint
      console.warn('[Multer] Allowing file despite filter exception for debugging');
      cb(null, true);
    }
  }
}).fields([
  { name: 'inputFile', maxCount: 1 },
  { name: 'outputSampleFile', maxCount: 1 },
  { name: 'inputReference', maxCount: 1 },
  { name: 'outputReference', maxCount: 1 }
]);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Create profiles directory if it doesn't exist
const profilesDir = path.join(__dirname, 'profiles');
if (!fs.existsSync(profilesDir)) {
  fs.mkdirSync(profilesDir, { recursive: true });
}

// File processing utilities with error handling
const processCSV = async (filePath, originalName) => {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    if (!fileContent || fileContent.trim().length === 0) {
      throw new Error('File is empty or contains no data');
    }
    return new Promise((resolve, reject) => {
      Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors && results.errors.length > 0) {
            console.warn('CSV parsing warnings:', results.errors);
          }
          if (!results.data || results.data.length === 0) {
            reject(new Error('CSV file contains no valid data rows'));
          } else {
            // Filter out records where all values are empty/null/whitespace
            const validData = results.data.filter(record => {
              if (!record || typeof record !== 'object') return false;
              const values = Object.values(record);
              return values.some(val => {
                if (val === null || val === undefined) return false;
                const strVal = String(val).trim();
                return strVal.length > 0;
              });
            });
            
            if (validData.length === 0) {
              reject(new Error('CSV file contains no valid data rows (all rows are empty)'));
            } else {
              console.log(`[CSV] Parsed ${validData.length} valid records from ${results.data.length} total rows`);
              resolve(validData);
            }
          }
        },
        error: (error) => reject(new Error(`CSV parsing failed: ${error.message}`))
      });
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${originalName}`);
    } else if (error.code === 'EACCES') {
      throw new Error(`Permission denied reading file: ${originalName}`);
    }
    throw new Error(`Error processing CSV file: ${error.message}`);
  }
};

const processExcel = (filePath, originalName) => {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${originalName}`);
    }
    const workbook = XLSX.readFile(filePath);
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('Excel file contains no sheets');
    }
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found in Excel file`);
    }
    
    // First try: Get raw data as arrays to find the actual header row
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Find the header row (contains column names like "Field Name", "Start Position", etc.)
    let headerRowIndex = -1;
    let headers = [];
    
    for (let i = 0; i < Math.min(rawData.length, 20); i++) {
      const row = rawData[i];
      if (!Array.isArray(row)) continue;
      
      const rowStr = row.map(cell => String(cell || '').toLowerCase()).join('|');
      
      // Check if this row looks like a header row with position-related columns
      if ((rowStr.includes('field') || rowStr.includes('column') || rowStr.includes('name')) &&
          (rowStr.includes('start') || rowStr.includes('position') || rowStr.includes('length'))) {
        headerRowIndex = i;
        headers = row.map(cell => String(cell || '').trim());
        console.log('[Excel] Found header row at index', i, ':', headers);
        break;
      }
    }
    
    // If we found a header row, parse data starting from the next row
    if (headerRowIndex >= 0 && headers.length > 0) {
      const data = [];
      for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!Array.isArray(row) || row.length === 0) continue;
        
        // Skip empty rows or rows that look like section headers
        const firstCell = String(row[0] || '').trim();
        if (!firstCell || firstCell.toUpperCase() === firstCell && firstCell.length > 20) continue;
        
        const obj = {};
        headers.forEach((header, idx) => {
          if (header && row[idx] !== undefined) {
            obj[header] = row[idx];
          }
        });
        
        // Only add rows that have actual data
        if (Object.keys(obj).length > 0 && Object.values(obj).some(v => v !== undefined && v !== '')) {
          data.push(obj);
        }
      }
      
      if (data.length > 0) {
        console.log('[Excel] Parsed', data.length, 'data rows with custom headers');
        console.log('[Excel] Sample row:', JSON.stringify(data[0]));
        return data;
      }
    }
    
    // Fallback: Use default parsing (first row as headers)
    const data = XLSX.utils.sheet_to_json(worksheet);
    if (!data || data.length === 0) {
      throw new Error('Excel file contains no data rows');
    }
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${originalName}`);
    } else if (error.code === 'EACCES') {
      throw new Error(`Permission denied reading file: ${originalName}`);
    }
    throw new Error(`Error processing Excel file: ${error.message}`);
  }
};

const processPDF = async (filePath, originalName) => {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${originalName}`);
    }
    const dataBuffer = fs.readFileSync(filePath);
    if (!dataBuffer || dataBuffer.length === 0) {
      throw new Error('PDF file is empty');
    }
    const data = await pdfParse(dataBuffer);
    if (!data || !data.text) {
      throw new Error('PDF file contains no extractable text');
    }
    return {
      text: data.text,
      pages: data.numpages,
      info: data.info
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${originalName}`);
    } else if (error.code === 'EACCES') {
      throw new Error(`Permission denied reading file: ${originalName}`);
    }
    throw new Error(`Error processing PDF file: ${error.message}`);
  }
};

const processWord = async (filePath, originalName) => {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${originalName}`);
    }
    const result = await mammoth.extractRawText({ path: filePath });
    if (!result || !result.value) {
      throw new Error('Word document contains no extractable text');
    }
    return {
      text: result.value,
      messages: result.messages
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${originalName}`);
    } else if (error.code === 'EACCES') {
      throw new Error(`Permission denied reading file: ${originalName}`);
    }
    throw new Error(`Error processing Word document: ${error.message}`);
  }
};

const processText = async (filePath, originalName) => {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${originalName}`);
    }
    const fileContent = fs.readFileSync(filePath, 'utf8');
    if (!fileContent || fileContent.trim().length === 0) {
      throw new Error('Text file is empty');
    }
    return {
      text: fileContent,
      lines: fileContent.split('\n').filter(line => line.trim().length > 0)
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${originalName}`);
    } else if (error.code === 'EACCES') {
      throw new Error(`Permission denied reading file: ${originalName}`);
    }
    throw new Error(`Error processing text file: ${error.message}`);
  }
};

// Universal file parser that detects file type and parses accordingly
const parseFile = async (filePath, originalName) => {
  const fileExt = path.extname(originalName).toLowerCase();
  
  try {
    switch (fileExt) {
      case '.csv':
        // Try CSV parsing
        try {
          return await processCSV(filePath, originalName);
        } catch (csvError) {
          // If CSV parsing fails, try as text
          console.warn(`CSV parsing failed for ${originalName}, trying as text:`, csvError.message);
          return await processText(filePath, originalName);
        }
      case '.txt':
      case '.dat':
        // Try CSV first, fallback to text if it fails
        try {
          return await processCSV(filePath, originalName);
        } catch (error) {
          // If CSV parsing fails, treat as plain text
          return await processText(filePath, originalName);
        }
      case '.xlsx':
      case '.xls':
        return processExcel(filePath, originalName);
      case '.pdf':
        return await processPDF(filePath, originalName);
      case '.docx':
      case '.doc':
        return await processWord(filePath, originalName);
      default:
        // For delimited files without extension or unknown extensions, try as text
        return await processText(filePath, originalName);
    }
  } catch (error) {
    throw new Error(`Failed to parse file "${originalName}": ${error.message}`);
  }
};

const convertToCSV = (jsonData) => {
  try {
    const parser = new Parser();
    return parser.parse(jsonData);
  } catch (error) {
    throw new Error(`Error converting to CSV: ${error.message}`);
  }
};

// Create a stratified sample of records across the entire dataset
// If total <= maxCount: return all records
// If total > maxCount: pick records evenly spread from start to end
const createStratifiedSample = (data, maxCount) => {
  if (!Array.isArray(data) || data.length === 0) return [];
  const total = data.length;
  if (total <= maxCount) {
    return data.slice();
  }
  const sample = [];
  const step = (total - 1) / (maxCount - 1);
  for (let i = 0; i < maxCount; i++) {
    const index = Math.round(i * step);
    sample.push(data[index]);
  }
  return sample;
};

// Parse output reference layout to extract position information from ANY file type
const parseLayoutFromReference = (referenceData) => {
  const layoutInfo = {};
  
  if (!referenceData) {
    return layoutInfo;
  }
  
  // Case 1: Array of objects (from Excel/CSV parsing)
  if (Array.isArray(referenceData)) {
    console.log('[Layout] Processing array data, rows:', referenceData.length);
    if (referenceData.length > 0) {
      console.log('[Layout] First row keys:', Object.keys(referenceData[0]));
      console.log('[Layout] Sample row:', JSON.stringify(referenceData[0]));
    }
    
    // Check if the data has proper column headers or if we need to scan for them
    // This handles Excel files where the first few rows are titles/descriptions
    let dataRows = referenceData;
    let headerRow = null;
    
    // Check if first row has position-related column names
    if (referenceData.length > 0) {
      const firstRowKeys = Object.keys(referenceData[0]);
      const hasPositionHeaders = firstRowKeys.some(key => {
        const keyLower = key.toLowerCase();
        return keyLower.includes('start') || keyLower.includes('position') || 
               keyLower.includes('length') || keyLower.includes('end pos') ||
               keyLower === 'length' || keyLower === 'len';
      });
      
      // If first row doesn't have position headers, scan all rows to find them
      if (!hasPositionHeaders) {
        console.log('[Layout] First row missing position headers, scanning for header row...');
        
        // Scan through all rows looking for one that contains position-related data
        for (let i = 0; i < referenceData.length; i++) {
          const row = referenceData[i];
          const values = Object.values(row);
          const valuesStr = values.map(v => String(v || '').toLowerCase()).join('|');
          
          // Look for a row that contains header-like values
          if ((valuesStr.includes('field name') || valuesStr.includes('fieldname') || valuesStr.includes('field')) &&
              (valuesStr.includes('start') || valuesStr.includes('position') || valuesStr.includes('length'))) {
            headerRow = row;
            console.log('[Layout] Found header row at index', i, ':', JSON.stringify(row));
            
            // The data rows start after this header row
            // But we need to re-map the data using this row as headers
            const headerValues = Object.values(row);
            const headerKey = Object.keys(row)[0]; // The single key from original parse
            
            // Build new data rows with proper column names
            const newDataRows = [];
            for (let j = i + 1; j < referenceData.length; j++) {
              const dataRow = referenceData[j];
              const dataValue = dataRow[headerKey];
              
              // Split by comma if it's a CSV-like string
              if (typeof dataValue === 'string' && dataValue.includes(',')) {
                const parts = dataValue.split(',');
                const newRow = {};
                headerValues.forEach((header, idx) => {
                  if (header && parts[idx] !== undefined) {
                    newRow[String(header).trim()] = parts[idx];
                  }
                });
                if (Object.keys(newRow).length > 0) {
                  newDataRows.push(newRow);
                }
              }
            }
            
            if (newDataRows.length > 0) {
              dataRows = newDataRows;
              console.log('[Layout] Re-parsed', newDataRows.length, 'data rows with proper headers');
              console.log('[Layout] New first row:', JSON.stringify(newDataRows[0]));
            }
            break;
          }
        }
      }
    }
    
    dataRows.forEach((row, idx) => {
      if (typeof row !== 'object' || row === null) return;
      
      // Get all keys from the row to find position-related columns dynamically
      const keys = Object.keys(row);
      
      // Find field name column (try exact matches first, then partial matches)
      let fieldName = null;
      let startPos = null;
      let endPos = null;
      let length = null;
      let dataType = null;
      let description = null;
      
      for (const key of keys) {
        const keyLower = key.toLowerCase().replace(/\s+/g, '');
        const value = row[key];
        
        // Field Name detection
        if (!fieldName && (
          keyLower === 'fieldname' || 
          keyLower === 'field name' ||
          keyLower === 'outputfield' ||
          keyLower === 'output field' ||
          keyLower === 'column' ||
          keyLower === 'name' ||
          key === 'Field Name'
        )) {
          fieldName = value;
        }
        
        // Start Position detection
        if (startPos === null && (
          keyLower === 'startposition' ||
          keyLower === 'start position' ||
          keyLower === 'start' ||
          keyLower === 'startpos' ||
          keyLower === 'from' ||
          keyLower === 'pos' ||
          keyLower === 'position' ||
          key === 'Start Position'
        )) {
          startPos = parseInt(value);
        }
        
        // End Position detection
        if (endPos === null && (
          keyLower === 'endposition' ||
          keyLower === 'end position' ||
          keyLower === 'end' ||
          keyLower === 'endpos' ||
          keyLower === 'to' ||
          key === 'End Position'
        )) {
          endPos = parseInt(value);
        }
        
        // Length detection
        if (length === null && (
          keyLower === 'length' ||
          keyLower === 'len' ||
          keyLower === 'size' ||
          keyLower === 'width' ||
          key === 'Length'
        )) {
          length = parseInt(value);
        }
        
        // Data Type detection
        if (!dataType && (
          keyLower === 'datatype' ||
          keyLower === 'data type' ||
          keyLower === 'type' ||
          keyLower === 'format' ||
          key === 'Data Type'
        )) {
          dataType = value;
        }
        
        // Description detection
        if (!description && (
          keyLower === 'description' ||
          keyLower === 'desc' ||
          keyLower === 'comment' ||
          key === 'Description'
        )) {
          description = value;
        }
      }
      
      // Only add if we found a field name and at least one position value
      if (fieldName && typeof fieldName === 'string' && fieldName.trim() && (startPos || endPos || length)) {
        // Clean NaN values
        startPos = isNaN(startPos) ? null : startPos;
        endPos = isNaN(endPos) ? null : endPos;
        length = isNaN(length) ? null : length;
        
        layoutInfo[fieldName.trim()] = {
          startPos: startPos,
          endPos: endPos,
          length: length,
          dataType: dataType || 'AN',
          description: description || ''
        };
        
        // Calculate missing values if possible
        if (layoutInfo[fieldName.trim()].startPos && layoutInfo[fieldName.trim()].endPos && !layoutInfo[fieldName.trim()].length) {
          layoutInfo[fieldName.trim()].length = layoutInfo[fieldName.trim()].endPos - layoutInfo[fieldName.trim()].startPos + 1;
        }
        if (layoutInfo[fieldName.trim()].startPos && layoutInfo[fieldName.trim()].length && !layoutInfo[fieldName.trim()].endPos) {
          layoutInfo[fieldName.trim()].endPos = layoutInfo[fieldName.trim()].startPos + layoutInfo[fieldName.trim()].length - 1;
        }
        if (layoutInfo[fieldName.trim()].endPos && layoutInfo[fieldName.trim()].length && !layoutInfo[fieldName.trim()].startPos) {
          layoutInfo[fieldName.trim()].startPos = layoutInfo[fieldName.trim()].endPos - layoutInfo[fieldName.trim()].length + 1;
        }
        
        if (idx < 3) {
          console.log('[Layout] Added field:', fieldName.trim(), layoutInfo[fieldName.trim()]);
        }
      }
    });
  }
  
  // Case 2: Object with text property (from PDF/Word parsing) - scan for position patterns
  if (referenceData.text || (typeof referenceData === 'string')) {
    const text = referenceData.text || referenceData;
    console.log('[Layout] Scanning text content for position patterns...');
    
    // Pattern 1: "FieldName    Start    End    Length" or similar table formats
    // Match lines like: "AuthorizationID    1    15    15" or "AuthorizationID,1,15,15"
    const tablePatterns = [
      // Pattern: FieldName followed by numbers (tab/space/comma separated)
      /^[\s,]*([A-Za-z][A-Za-z0-9_]+)[\s,]+(\d+)[\s,]+(\d+)[\s,]+(\d+)/gm,
      // Pattern: FieldName | Start | End | Length (pipe separated)
      /([A-Za-z][A-Za-z0-9_]+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)/gm,
    ];
    
    for (const pattern of tablePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const fieldName = match[1];
        const num1 = parseInt(match[2]);
        const num2 = parseInt(match[3]);
        const num3 = parseInt(match[4]);
        
        // Determine which numbers are start, end, length based on logic
        let startPos, endPos, length;
        if (num3 === num2 - num1 + 1) {
          // num3 is length calculated from start-end
          startPos = num1;
          endPos = num2;
          length = num3;
        } else if (num2 === num1 + num3 - 1) {
          // num2 is end calculated from start+length
          startPos = num1;
          length = num3;
          endPos = num2;
        } else {
          // Assume order: start, end, length
          startPos = num1;
          endPos = num2;
          length = num3;
        }
        
        if (fieldName && !layoutInfo[fieldName]) {
          layoutInfo[fieldName] = {
            startPos: startPos,
            endPos: endPos,
            length: length,
            dataType: 'AN',
            description: ''
          };
        }
      }
    }
    
    // Pattern 2: "FieldName: positions 1-15 (length 15)" or similar descriptive formats
    const descriptivePatterns = [
      /([A-Za-z][A-Za-z0-9_]+)[:\s]+(?:pos(?:ition)?s?\s*)?(\d+)\s*[-–to]+\s*(\d+)/gi,
      /([A-Za-z][A-Za-z0-9_]+)[:\s]+(?:start\s*)?(\d+)[,\s]+(?:end\s*)?(\d+)[,\s]+(?:len(?:gth)?\s*)?(\d+)/gi,
    ];
    
    for (const pattern of descriptivePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const fieldName = match[1];
        const startPos = parseInt(match[2]);
        const endPos = parseInt(match[3]);
        const length = match[4] ? parseInt(match[4]) : (endPos - startPos + 1);
        
        if (fieldName && !layoutInfo[fieldName]) {
          layoutInfo[fieldName] = {
            startPos: startPos,
            endPos: endPos,
            length: length,
            dataType: 'AN',
            description: ''
          };
        }
      }
    }
    
    // Pattern 3: Lines with "Start Position" / "End Position" / "Length" headers followed by data
    // Parse line by line looking for structured data after header detection
    const lines = text.split('\n');
    let headerIndices = { fieldName: -1, start: -1, end: -1, length: -1 };
    let foundHeader = false;
    
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      
      // Detect header row
      if (!foundHeader && (
        (lowerLine.includes('field') && (lowerLine.includes('start') || lowerLine.includes('position') || lowerLine.includes('length'))) ||
        (lowerLine.includes('column') && lowerLine.includes('position'))
      )) {
        // Try to identify column positions from header
        const parts = line.split(/[\t,|]+/).map(p => p.trim().toLowerCase());
        parts.forEach((part, idx) => {
          if (part.includes('field') || part.includes('name') || part.includes('column')) headerIndices.fieldName = idx;
          if (part.includes('start') || part === 'from' || part === 'pos') headerIndices.start = idx;
          if (part.includes('end') || part === 'to') headerIndices.end = idx;
          if (part.includes('len') || part.includes('size') || part.includes('width')) headerIndices.length = idx;
        });
        
        if (headerIndices.fieldName >= 0 && (headerIndices.start >= 0 || headerIndices.length >= 0)) {
          foundHeader = true;
          console.log('[Layout] Found header row with indices:', headerIndices);
        }
        continue;
      }
      
      // Parse data rows after header is found
      if (foundHeader) {
        const parts = line.split(/[\t,|]+/).map(p => p.trim());
        if (parts.length > Math.max(headerIndices.fieldName, headerIndices.start, headerIndices.end, headerIndices.length)) {
          const fieldName = headerIndices.fieldName >= 0 ? parts[headerIndices.fieldName] : null;
          const startPos = headerIndices.start >= 0 ? parseInt(parts[headerIndices.start]) : null;
          const endPos = headerIndices.end >= 0 ? parseInt(parts[headerIndices.end]) : null;
          const length = headerIndices.length >= 0 ? parseInt(parts[headerIndices.length]) : null;
          
          if (fieldName && /^[A-Za-z]/.test(fieldName) && (startPos || length)) {
            layoutInfo[fieldName] = {
              startPos: startPos || null,
              endPos: endPos || null,
              length: length || null,
              dataType: 'AN',
              description: ''
            };
            
            // Calculate missing values
            if (layoutInfo[fieldName].startPos && layoutInfo[fieldName].endPos && !layoutInfo[fieldName].length) {
              layoutInfo[fieldName].length = layoutInfo[fieldName].endPos - layoutInfo[fieldName].startPos + 1;
            }
            if (layoutInfo[fieldName].startPos && layoutInfo[fieldName].length && !layoutInfo[fieldName].endPos) {
              layoutInfo[fieldName].endPos = layoutInfo[fieldName].startPos + layoutInfo[fieldName].length - 1;
            }
          }
        }
      }
    }
  }
  
  console.log('[Layout] Parsed layout info for', Object.keys(layoutInfo).length, 'fields from reference');
  if (Object.keys(layoutInfo).length > 0) {
    console.log('[Layout] Sample fields:', Object.keys(layoutInfo).slice(0, 5));
  }
  return layoutInfo;
};

// Convert JSON data to fixed-width format based on mappings with position info
const convertToFixedWidth = (jsonData, mappings) => {
  try {
    if (!jsonData || jsonData.length === 0) {
      return '';
    }

    // Check if mappings have position information
    const hasPositionInfo = mappings.some(m => m.startPos && m.length);
    
    if (hasPositionInfo) {
      // Use position-based output - sort by startPos and use exact positions
      console.log('[FixedWidth] Using position-based layout from mappings');
      
      // Sort mappings by start position
      const sortedMappings = [...mappings]
        .filter(m => m.outputField && m.startPos && m.length)
        .sort((a, b) => (a.startPos || 0) - (b.startPos || 0));
      
      // Calculate total record length
      let totalLength = 0;
      sortedMappings.forEach(m => {
        const endPos = m.endPos || (m.startPos + m.length - 1);
        if (endPos > totalLength) {
          totalLength = endPos;
        }
      });
      
      console.log('[FixedWidth] Total record length:', totalLength);
      
      // Generate fixed-width lines
      const lines = [];
      
      jsonData.forEach(record => {
        // Initialize line with spaces
        let line = ' '.repeat(totalLength);
        
        sortedMappings.forEach(mapping => {
          let value = record[mapping.outputField];
          if (value === undefined || value === null) {
            value = '';
          }
          value = String(value);
          
          const start = mapping.startPos - 1; // Convert to 0-based index
          const length = mapping.length;
          
          // Pad or truncate to exact length
          if (value.length > length) {
            value = value.substring(0, length);
          } else {
            value = value.padEnd(length, ' ');
          }
          
          // Insert value at correct position
          line = line.substring(0, start) + value + line.substring(start + length);
        });
        
        lines.push(line);
      });

      return lines.join('\n') + '\n';
    } else {
      // Fall back to auto-calculated widths
      console.log('[FixedWidth] Using auto-calculated widths (no position info in mappings)');
      
      // Build field layout from mappings (output field order and lengths)
      const fieldLayout = [];
      const outputFields = Object.keys(jsonData[0]);
      
      // Calculate reasonable widths based on data
      outputFields.forEach(field => {
        let maxLength = field.length; // At least as wide as field name
        
        // Find max length in data
        jsonData.forEach(record => {
          const value = record[field];
          if (value !== undefined && value !== null) {
            const strValue = String(value);
            if (strValue.length > maxLength) {
              maxLength = strValue.length;
            }
          }
        });
        
        // Add some padding and cap at reasonable max
        maxLength = Math.min(maxLength + 2, 100);
        
        fieldLayout.push({
          field: field,
          length: maxLength
        });
      });

      // Generate fixed-width lines
      const lines = [];
      
      jsonData.forEach(record => {
        let line = '';
        fieldLayout.forEach(layout => {
          let value = record[layout.field];
          if (value === undefined || value === null) {
            value = '';
          }
          value = String(value);
          
          // Pad or truncate to exact length
          if (value.length > layout.length) {
            value = value.substring(0, layout.length);
          } else {
            value = value.padEnd(layout.length, ' ');
          }
          
          line += value;
        });
        lines.push(line);
      });

      return lines.join('\n') + '\n';
    }
  } catch (error) {
    throw new Error(`Error converting to fixed-width: ${error.message}`);
  }
};

// AI Service for intelligent data transformation
const generateTransformationMapping = async (inputData, outputSample, inputReference = null, outputReference = null, customMappings = null) => {
  if (!openai) {
    throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY in your .env file.');
  }

  // Prepare sample data using stratified sampling for better coverage
  const inputSample = Array.isArray(inputData) 
    ? createStratifiedSample(inputData, 20)
    : (typeof inputData === 'object' ? [inputData] : [{ text: String(inputData).substring(0, 2000) }]);
  
  const outputSampleData = Array.isArray(outputSample)
    ? createStratifiedSample(outputSample, 10)
    : (typeof outputSample === 'object' ? [outputSample] : [{ text: String(outputSample).substring(0, 2000) }]);

  // Build the prompt
  let prompt = `You are an expert data transformation specialist. Analyze the following data and create a comprehensive mapping strategy.

INPUT DATA SAMPLE:
${JSON.stringify(inputSample, null, 2)}

OUTPUT STRUCTURE SAMPLE:
${JSON.stringify(outputSampleData, null, 2)}`;

  if (inputReference) {
    const inputRefText = typeof inputReference === 'object' && inputReference.text
      ? inputReference.text.substring(0, 6000)
      : (typeof inputReference === 'object' ? JSON.stringify(inputReference, null, 2).substring(0, 6000) : String(inputReference).substring(0, 6000));
    prompt += `\n\nINPUT REFERENCE DOCUMENTATION:
${inputRefText}`;
  }

  if (outputReference) {
    const outputRefText = typeof outputReference === 'object' && outputReference.text
      ? outputReference.text.substring(0, 6000)
      : (typeof outputReference === 'object' ? JSON.stringify(outputReference, null, 2).substring(0, 6000) : String(outputReference).substring(0, 6000));
    prompt += `\n\nOUTPUT REFERENCE DOCUMENTATION:
${outputRefText}`;
  }

  // If custom mappings are provided, include them in the prompt for AI to review
  if (customMappings && Array.isArray(customMappings) && customMappings.length > 0) {
    prompt += `\n\nCUSTOM MAPPINGS PROVIDED BY USER (Please review and enhance these):
${JSON.stringify(customMappings, null, 2)}

IMPORTANT: The user has already defined these mappings. Please:
1. Review and validate these mappings
2. Apply the transformations specified in each mapping (e.g., uppercase, lowercase, trim, etc.)
3. Generate comprehensive transformation rules based on these mappings
4. Create validation rules based on the data types and requirements specified
5. Ensure all transformations are properly applied in the preview`;
  }

  prompt += `\n\nTASK:
1. Analyze the input data structure and identify all fields/columns
2. Analyze the output structure and identify all required fields/columns
3. ${customMappings ? 'Review and enhance the provided custom mappings' : 'Create intelligent field mappings from input to output'}
4. Suggest data transformation rules (formatting, calculations, concatenations, etc.)
5. Define validation rules (required fields, data types, constraints)
6. Generate a preview of 100 transformed records (or as many as available)

OUTPUT FORMAT (JSON only, no markdown):
{
  "mappings": [
    {
      "inputField": "source_field_name",
      "outputField": "target_field_name",
      "transformation": "description of transformation rule",
      "required": true/false,
      "dataType": "string|number|date|boolean|email|phone|etc",
      "validation": "validation rule description",
      "defaultValue": "default value if any"
    }
  ],
  "rules": [
    {
      "type": "formatting|calculation|concatenation|conditional|etc",
      "description": "rule description",
      "implementation": "how to implement this rule"
    }
  ],
  "validations": [
    {
      "field": "field_name",
      "type": "required|type|format|range|custom",
      "rule": "validation rule",
      "message": "error message if validation fails"
    }
  ],
  "preview": [
    // Array of transformed records matching output structure
  ],
  "summary": {
    "totalInputFields": number,
    "totalOutputFields": number,
    "mappedFields": number,
    "unmappedInputFields": ["list of input fields not mapped"],
    "missingOutputFields": ["list of output fields without mappings"],
    "transformationComplexity": "simple|moderate|complex"
  }
}`;

  try {
    console.log('[AI] Starting transformation mapping generation...');
    console.log('[AI] Input data sample size:', Array.isArray(inputData) ? inputData.length : 'N/A');
    console.log('[AI] Output sample size:', Array.isArray(outputSample) ? outputSample.length : 'N/A');
    console.log('[AI] Has input reference:', !!inputReference);
    console.log('[AI] Has output reference:', !!outputReference);
    
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a data transformation expert. Always respond with valid JSON only, no markdown formatting, no code blocks.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 8000
    });

    const responseText = completion.choices[0].message.content.trim();
    console.log('[AI] Raw response received, length:', responseText.length);
    console.log('[AI] Response preview (first 500 chars):', responseText.substring(0, 500));
    
    // Remove markdown code blocks if present
    let jsonText = responseText;
    if (responseText.startsWith('```json')) {
      jsonText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      console.log('[AI] Removed markdown code blocks (json)');
    } else if (responseText.startsWith('```')) {
      jsonText = responseText.replace(/```\n?/g, '');
      console.log('[AI] Removed markdown code blocks');
    }

    // Parse the JSON response
    let aiResponse;
    try {
      aiResponse = JSON.parse(jsonText);
      console.log('[AI] Successfully parsed JSON response');
      console.log('[AI] Mappings count:', aiResponse.mappings?.length || 0);
      console.log('[AI] Rules count:', aiResponse.rules?.length || 0);
      console.log('[AI] Validations count:', aiResponse.validations?.length || 0);
      console.log('[AI] Preview records:', aiResponse.preview?.length || 0);
      console.log('[AI] Summary:', JSON.stringify(aiResponse.summary || {}, null, 2));
    } catch (parseError) {
      console.error('[AI] JSON parse error:', parseError.message);
      console.error('[AI] JSON text (first 500 chars):', jsonText.substring(0, 500));
      throw new Error(`Failed to parse AI response as JSON: ${parseError.message}. Response preview: ${jsonText.substring(0, 200)}`);
    }

    // Always ensure preview has 100 records (or as many as available)
    // AI might generate a preview with only a few records, so we regenerate if needed
    const targetPreviewCount = 100;
    const currentPreviewCount = aiResponse.preview ? aiResponse.preview.length : 0;
    
    if (!aiResponse.preview || currentPreviewCount === 0 || currentPreviewCount < targetPreviewCount) {
      console.log(`[AI] Preview missing or incomplete (${currentPreviewCount} records), generating ${targetPreviewCount} records from mappings...`);
      
      // Check for complex transformations
      const mappingsWithComplexTransforms = (aiResponse.mappings || []).filter(m => {
        const transform = (m.transformation || '').toLowerCase();
        if (!transform) return false;
        const basicPatterns = ['uppercase', 'lowercase', 'trim', 'upper case', 'lower case'];
        return !basicPatterns.some(p => transform === p || transform === p.replace(' ', ''));
      });
      
      // Apply AI transformations if there are complex rules
      let aiTransformedData = null;
      if (mappingsWithComplexTransforms.length > 0) {
        try {
          aiTransformedData = await applyAITransformations(inputData, aiResponse.mappings || []);
        } catch (err) {
          console.warn('[AI] AI transformation failed:', err.message);
        }
      }
      
      aiResponse.preview = generatePreviewFromMappings(inputData, outputSample, aiResponse.mappings || [], aiTransformedData);
      console.log('[AI] Generated preview records:', aiResponse.preview.length);
      
      // Ensure we have the target number of records
      if (aiResponse.preview.length < targetPreviewCount && Array.isArray(inputData) && inputData.length >= targetPreviewCount) {
        console.log(`[AI] Preview has ${aiResponse.preview.length} records, expected ${targetPreviewCount}. This might be due to input data limitations.`);
      }
    } else {
      console.log(`[AI] Using AI-generated preview with ${currentPreviewCount} records`);
    }

    console.log('[AI] Transformation mapping generation completed successfully');
    return aiResponse;
  } catch (error) {
    console.error('[AI] Error in transformation mapping:', error.message);
    console.error('[AI] Error stack:', error.stack);
    throw new Error(`AI service error: ${error.message}`);
  }
};

// AI-powered function to apply natural language transformations to data
const applyAITransformations = async (inputData, mappings) => {
  if (!openai) {
    console.warn('[AI Transform] OpenAI not configured, falling back to basic transformations');
    return null;
  }

  // Filter mappings that have natural language transformations
  const mappingsWithTransformations = mappings.filter(m => 
    m.outputField && (m.transformations || m.transformation)
  );

  if (mappingsWithTransformations.length === 0) {
    console.log('[AI Transform] No transformations to apply');
    return null;
  }

  console.log('[AI Transform] Applying AI transformations for', mappingsWithTransformations.length, 'mappings');

  // Prepare sample input data (up to 100 records, stratified across full dataset)
  const sampleInput = Array.isArray(inputData) ? createStratifiedSample(inputData, 100) : [];
  
  if (sampleInput.length === 0) {
    console.warn('[AI Transform] No input data to transform');
    return null;
  }

  // Build the transformation prompt
  const prompt = `You are a data transformation engine. Apply the following transformation rules to the input data and generate the output.

INPUT DATA (${sampleInput.length} records):
${JSON.stringify(sampleInput.slice(0, 5), null, 2)}
${sampleInput.length > 5 ? `... and ${sampleInput.length - 5} more records with the same structure` : ''}

TRANSFORMATION MAPPINGS:
${JSON.stringify(mappingsWithTransformations.map(m => ({
  inputField: m.inputField || '(no input - use default or generate)',
  outputField: m.outputField,
  transformation: m.transformations || m.transformation,
  dataType: m.dataType || 'string',
  defaultValue: m.defaultValue || '',
  required: m.required || false
})), null, 2)}

TASK:
Apply each transformation rule to generate the output data. Parse the natural language transformation rules intelligently:

Common transformation patterns to handle:
- "uppercase" / "upper case" / "to uppercase" → Convert to uppercase
- "lowercase" / "lower case" / "to lowercase" → Convert to lowercase  
- "trim" / "remove spaces" / "strip whitespace" → Trim whitespace
- "capitalize" / "title case" → Capitalize first letter of each word
- "first N characters" / "take first N" → Extract first N characters
- "last N characters" / "take last N" → Extract last N characters
- "format as date" / "convert to date" → Format as date (YYYY-MM-DD)
- "format as currency" / "add $ sign" → Format as currency
- "remove special characters" / "alphanumeric only" → Remove non-alphanumeric
- "extract email" / "get email" → Extract email from text
- "extract phone" / "get phone number" → Extract phone number
- "concatenate" / "combine" / "merge" → Combine multiple fields
- "split" / "separate" → Split into parts
- "replace X with Y" → String replacement
- "add prefix" / "add suffix" → Add text before/after
- "calculate" / "compute" / "sum" / "multiply" → Mathematical operations
- "if X then Y" / "when X" → Conditional transformations
- "default to X" / "if empty use X" → Default value handling
- "map to" / "convert to enum" → Value mapping
- Any other natural language instruction → Interpret and apply intelligently

For each record in the input, generate the corresponding transformed output record with ALL output fields populated.

IMPORTANT:
- Generate exactly ${sampleInput.length} output records
- Each record must have ALL output fields from the mappings
- If an input field is blank/missing, use the defaultValue or generate appropriate data based on the transformation rule
- Never leave output fields blank - always generate a value based on the rules
- Apply transformations exactly as specified

OUTPUT FORMAT (JSON array only, no explanation):
[
  { "outputField1": "transformed_value1", "outputField2": "transformed_value2", ... },
  ...
]`;

  try {
    console.log('[AI Transform] Calling OpenAI to apply transformations...');
    
    // Wrap in Promise.race with timeout to prevent hanging
    const aiRequest = openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a data transformation engine. Output only valid JSON arrays with no markdown formatting or explanation. Apply transformation rules precisely.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1, // Low temperature for consistent transformations
      max_tokens: 16000 // Allow large response for many records
    });
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('AI transformation request timed out after 5 minutes')), 300000);
    });
    
    const response = await Promise.race([aiRequest, timeoutPromise]);

    let responseText = response.choices[0].message.content;
    console.log('[AI Transform] Raw response length:', responseText.length);
    
    // Clean up response - remove markdown code blocks if present
    responseText = responseText.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    
    // Parse the response
    const transformedData = JSON.parse(responseText);
    
    if (Array.isArray(transformedData) && transformedData.length > 0) {
      console.log('[AI Transform] Successfully transformed', transformedData.length, 'records');
      console.log('[AI Transform] Sample transformed record:', JSON.stringify(transformedData[0], null, 2));
      return transformedData;
    }
    
    console.warn('[AI Transform] Invalid response format, expected array');
    return null;
  } catch (error) {
    // Log detailed error information
    console.error('[AI Transform] Error applying transformations:', {
      message: error.message,
      code: error.code,
      type: error.constructor.name,
      stack: error.stack?.substring(0, 500) // First 500 chars of stack
    });
    
    // Don't throw - return null so basic transformations can be used instead
    // This allows the transformation to continue even if AI fails
    return null;
  }
};

// Apply a single transformation rule to a value (for basic/fallback transformations)
const applyBasicTransformation = (value, transformation, mapping, inputRecord) => {
  if (!transformation) {
    return value;
  }
  
  const transformStr = String(transformation).toLowerCase();
  const transformOriginal = String(transformation); // Keep original case for field name matching
  let result = value;
  
  // Handle empty/null values
  if (result === null || result === undefined || result === '') {
    if (mapping.defaultValue !== undefined && mapping.defaultValue !== '') {
      result = mapping.defaultValue;
    } else {
      result = '';
    }
  }
  
  // CONCATENATION PATTERNS - Handle combining multiple fields
  // Pattern: "Concatenate X + Y + Z" or "Concat X + Y"
  const concatMatch = transformOriginal.match(/concat(?:enate)?\s+["']?(.+?)["']?$/i);
  if (concatMatch && inputRecord) {
    const concatParts = concatMatch[1].split(/\s*\+\s*/);
    const concatResult = concatParts.map(part => {
      // Check if it's a literal string (in quotes)
      const literalMatch = part.match(/^["'](.*)["']$/);
      if (literalMatch) {
        return literalMatch[1];
      }
      // Otherwise treat as field name - try exact match first, then case-insensitive
      let fieldValue = inputRecord[part.trim()];
      if (fieldValue === undefined) {
        // Try case-insensitive match
        const lowerPart = part.trim().toLowerCase();
        for (const key of Object.keys(inputRecord)) {
          if (key.toLowerCase() === lowerPart) {
            fieldValue = inputRecord[key];
            break;
          }
        }
      }
      return fieldValue !== undefined ? String(fieldValue) : '';
    }).join('');
    
    if (concatResult) {
      result = concatResult;
    }
  }
  
  // Pattern: "Combine FieldA and FieldB" or "Combine FieldA, FieldB"
  const combineMatch = transformOriginal.match(/combine\s+(.+)/i);
  if (combineMatch && inputRecord && !concatMatch) {
    const fieldNames = combineMatch[1].split(/\s*(?:,|\s+and\s+|\s+with\s+|\+)\s*/i);
    const combinedResult = fieldNames.map(name => {
      const cleanName = name.replace(/["']/g, '').trim();
      let fieldValue = inputRecord[cleanName];
      if (fieldValue === undefined) {
        const lowerName = cleanName.toLowerCase();
        for (const key of Object.keys(inputRecord)) {
          if (key.toLowerCase() === lowerName) {
            fieldValue = inputRecord[key];
            break;
          }
        }
      }
      return fieldValue !== undefined ? String(fieldValue) : '';
    }).filter(v => v).join(' ');
    
    if (combinedResult) {
      result = combinedResult;
    }
  }
  
  // DATE FORMAT PATTERNS
  // Pattern: "Format CCYYMMDD to YYYY-MM-DD" or "Format as YYYY-MM-DD"
  if ((transformStr.includes('format') && transformStr.includes('yyyy')) || 
      transformStr.includes('date format') || 
      transformStr.includes('ccyymmdd')) {
    const dateStr = String(result);
    // Try to parse CCYYMMDD format (e.g., 20240115)
    if (/^\d{8}$/.test(dateStr)) {
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      result = `${year}-${month}-${day}`;
    }
  }
  
  // Apply common transformations
  if (transformStr.includes('trim') || transformStr.includes('strip')) {
    result = String(result).trim();
  }
  
  if (transformStr.includes('uppercase') || transformStr.includes('upper case') || transformStr.includes('to upper')) {
    result = String(result).toUpperCase();
  } else if (transformStr.includes('lowercase') || transformStr.includes('lower case') || transformStr.includes('to lower')) {
    result = String(result).toLowerCase();
  } else if (transformStr.includes('capitalize') || transformStr.includes('title case')) {
    result = String(result).split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
  }
  
  // First N characters
  const firstNMatch = transformStr.match(/first\s*(\d+)/);
  if (firstNMatch) {
    result = String(result).substring(0, parseInt(firstNMatch[1]));
  }
  
  // Last N characters
  const lastNMatch = transformStr.match(/last\s*(\d+)/);
  if (lastNMatch) {
    const n = parseInt(lastNMatch[1]);
    result = String(result).slice(-n);
  }
  
  // Prefix - also handles "Add CLM as prefix" or "Prefix: CLM"
  const prefixMatch = transformStr.match(/prefix[:\s]+["']?([^"']+)["']?/i) || 
                      transformStr.match(/add\s+["']?([^"']+)["']?\s+(?:as\s+)?prefix/i) ||
                      transformOriginal.match(/^["']([^"']+)["']\s*\+/);
  if (prefixMatch) {
    result = prefixMatch[1] + String(result);
  }
  
  // Suffix
  const suffixMatch = transformStr.match(/suffix[:\s]+["']?([^"']+)["']?/i) || transformStr.match(/add\s+["']?([^"']+)["']?\s+(?:as\s+)?suffix/i);
  if (suffixMatch) {
    result = String(result) + suffixMatch[1];
  }
  
  // Replace X with Y
  const replaceMatch = transformStr.match(/replace\s+["']?([^"']+)["']?\s+with\s+["']?([^"']*?)["']?$/i);
  if (replaceMatch) {
    result = String(result).replace(new RegExp(replaceMatch[1], 'gi'), replaceMatch[2]);
  }
  
  // Remove special characters
  if (transformStr.includes('remove special') || transformStr.includes('alphanumeric only')) {
    result = String(result).replace(/[^a-zA-Z0-9\s]/g, '');
  }
  
  // Handle data type conversion
  if (mapping.dataType === 'number') {
    const num = parseFloat(String(result).replace(/[^0-9.-]/g, ''));
    result = isNaN(num) ? 0 : num;
  } else if (mapping.dataType === 'date') {
    const dateValue = new Date(result);
    result = isNaN(dateValue.getTime()) ? result : dateValue.toISOString().split('T')[0];
  }
  
  return result;
};

// Helper function to generate preview from mappings (enhanced with AI support)
const generatePreviewFromMappings = (inputData, outputSample, mappings, aiTransformedData = null) => {
  console.log('[Preview] Generating preview from mappings...');
  console.log('[Preview] Input data records:', Array.isArray(inputData) ? inputData.length : 0);
  console.log('[Preview] Mappings count:', mappings?.length || 0);
  console.log('[Preview] AI transformed data available:', !!aiTransformedData);
  
  if (!Array.isArray(inputData) || inputData.length === 0) {
    console.warn('[Preview] No input data available');
    return [];
  }

  if (!mappings || mappings.length === 0) {
    console.warn('[Preview] No mappings available');
    return [];
  }

  // Get all output fields from mappings - these should ALL appear in preview
  const allOutputFields = new Set();
  const mappingsByOutputField = new Map();
  mappings.forEach(mapping => {
    if (mapping.outputField) {
      allOutputFields.add(mapping.outputField);
      mappingsByOutputField.set(mapping.outputField, mapping);
    }
  });
  console.log('[Preview] All output fields from mappings:', Array.from(allOutputFields));

  const preview = [];
  const maxRecords = 100; // Always try to get 100 valid records
  const maxIterations = Math.max(inputData.length, 1000); // Allow iterating through more records to find 100 valid ones
  console.log('[Preview] Processing up to', maxRecords, 'valid records from', inputData.length, 'total input records (max iterations:', maxIterations, ')');

  let processedCount = 0;
  let skippedCount = 0;
  let iterationCount = 0;
  
  // Continue until we have 100 valid records OR we've exhausted the input data
  for (let i = 0; i < inputData.length && processedCount < maxRecords && iterationCount < maxIterations; i++) {
    iterationCount++;
    const inputRecord = inputData[i];
    
    // Skip if input record is null, undefined, or empty, but continue to next record
    if (!inputRecord || (typeof inputRecord === 'object' && Object.keys(inputRecord).length === 0)) {
      skippedCount++;
      if (skippedCount <= 10) { // Log first 10 skips to help debug
        console.warn('[Preview] Skipping empty record at index', i);
      }
      continue;
    }
    
    // Additional check: skip if all values in the record are empty/null/whitespace
    const hasValidData = Object.values(inputRecord).some(val => {
      if (val === null || val === undefined) return false;
      const strVal = String(val).trim();
      return strVal.length > 0;
    });
    
    if (!hasValidData) {
      skippedCount++;
      if (skippedCount <= 10) {
        console.warn('[Preview] Skipping record with no valid data at index', i);
      }
      continue;
    }
    
    processedCount++;
    const transformedRecord = {};

    // Check if we have AI-transformed data for this record
    const aiRecord = aiTransformedData && aiTransformedData[i] ? aiTransformedData[i] : null;

    // Process each output field
    allOutputFields.forEach(outputField => {
      const mapping = mappingsByOutputField.get(outputField);
      
      // Priority 1: Use AI-transformed value if available
      if (aiRecord && aiRecord[outputField] !== undefined && aiRecord[outputField] !== '') {
        transformedRecord[outputField] = aiRecord[outputField];
        return;
      }
      
      if (!mapping) {
        transformedRecord[outputField] = '';
        return;
      }
      
      const inputField = mapping.inputField;
      const transformation = mapping.transformations || mapping.transformation || '';
      
      // Get input value - empty string if no input field specified
      let value = '';
      if (inputField && inputField !== '') {
        value = inputRecord && inputRecord[inputField] !== undefined 
          ? inputRecord[inputField] 
          : (mapping.defaultValue || '');
      } else if (mapping.defaultValue !== undefined && mapping.defaultValue !== '') {
        value = mapping.defaultValue;
      }
      
      // Apply transformation using the enhanced basic transformation function
      // IMPORTANT: Apply transformation even if inputField is empty - transformation might generate value
      if (transformation) {
        value = applyBasicTransformation(value, transformation, mapping, inputRecord);
      } else if (value !== '' && value !== null && value !== undefined) {
        // Apply data type conversion only if we have a value and no explicit transformation
        if (mapping.dataType === 'number') {
          const num = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
          value = isNaN(num) ? 0 : num;
        } else if (mapping.dataType === 'date') {
          const dateValue = new Date(value);
          value = isNaN(dateValue.getTime()) ? value : dateValue.toISOString().split('T')[0];
        } else {
          value = String(value);
        }
      }
      
      // IMPORTANT: Ensure ALL output fields are present in preview, even if inputField is empty
      // If no value was generated, use empty string or defaultValue
      if (value === undefined || value === null) {
        value = mapping.defaultValue !== undefined && mapping.defaultValue !== '' 
          ? mapping.defaultValue 
          : '';
      }
      
      // Ensure we never have undefined values - always include the field in preview
      transformedRecord[outputField] = value !== undefined && value !== null ? value : '';
    });

    preview.push(transformedRecord);
  }

  console.log('[Preview] Generated', preview.length, 'preview records (processed', processedCount, 'valid records, skipped', skippedCount, 'empty records, iterations:', iterationCount, ')');
  console.log('[Preview] Output columns in preview:', allOutputFields.size);
  
  // Warn if we didn't get 100 records
  if (preview.length < 100) {
    if (inputData.length >= 100) {
      console.warn('[Preview] Warning: Only generated', preview.length, 'valid records out of', inputData.length, 'input records. This may be due to many empty/invalid records.');
    } else {
      console.log('[Preview] Generated', preview.length, 'records (input file has', inputData.length, 'records)');
    }
  }
  
  // Log sample record to verify all fields are populated
  if (preview.length > 0) {
    console.log('[Preview] Sample record fields:', Object.keys(preview[0]));
    const emptyFields = Object.entries(preview[0]).filter(([k, v]) => v === '' || v === null || v === undefined);
    if (emptyFields.length > 0) {
      console.log('[Preview] Fields with empty values:', emptyFields.map(([k]) => k));
    }
  }
  if (preview.length > 0) {
    console.log('[Preview] Sample record:', JSON.stringify(preview[0], null, 2));
  }
  
  return preview;
};

// Profile management utilities
const getProfilePath = (profileId) => {
  return path.join(profilesDir, `${profileId}.prf`);
};

const saveProfile = (profileId, profileData) => {
  try {
    const profilePath = getProfilePath(profileId);
    const profileWithMetadata = {
      id: profileId,
      createdAt: profileData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...profileData
    };
    fs.writeFileSync(profilePath, JSON.stringify(profileWithMetadata, null, 2), 'utf8');
    return profileWithMetadata;
  } catch (error) {
    throw new Error(`Error saving profile: ${error.message}`);
  }
};

const getProfile = (profileId) => {
  try {
    const profilePath = getProfilePath(profileId);
    if (!fs.existsSync(profilePath)) {
      return null;
    }
    const fileContent = fs.readFileSync(profilePath, 'utf8');
    return JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Error reading profile: ${error.message}`);
  }
};

const getAllProfiles = () => {
  try {
    const files = fs.readdirSync(profilesDir);
    const profiles = files
      .filter(file => file.endsWith('.prf'))
      .map(file => {
        const profileId = path.basename(file, '.prf');
        return getProfile(profileId);
      })
      .filter(profile => profile !== null);
    return profiles;
  } catch (error) {
    throw new Error(`Error reading profiles: ${error.message}`);
  }
};

const deleteProfile = (profileId) => {
  try {
    const profilePath = getProfilePath(profileId);
    if (!fs.existsSync(profilePath)) {
      return false;
    }
    fs.unlinkSync(profilePath);
    return true;
  } catch (error) {
    throw new Error(`Error deleting profile: ${error.message}`);
  }
};

const generateProfileId = () => {
  return `profile-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Test endpoint for debugging uploads
app.post('/api/test-upload', (req, res, next) => {
  console.log('[Test] Test upload endpoint hit');
  console.log('[Test] Method:', req.method);
  console.log('[Test] Content-Type:', req.headers['content-type']);
  uploadMultiple(req, res, (err) => {
    if (err) {
      console.error('[Test] Error:', err);
      return res.status(400).json({ error: err.message });
    }
    console.log('[Test] Files:', req.files);
    res.json({ 
      success: true, 
      message: 'Upload test successful',
      files: req.files ? Object.keys(req.files) : []
    });
  });
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  try {
    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    let processedData = null;

    // Process file based on extension
    switch (fileExt) {
      case '.csv':
        processedData = await processCSV(filePath);
        break;
      case '.xlsx':
      case '.xls':
        processedData = processExcel(filePath);
        break;
      case '.pdf':
        processedData = await processPDF(filePath);
        break;
      case '.docx':
      case '.doc':
        processedData = await processWord(filePath);
        break;
      default:
        return res.status(400).json({ error: 'Unsupported file type' });
    }

    res.json({
      message: 'File processed successfully',
      file: {
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      },
      data: processedData
    });
  } catch (error) {
    res.status(500).json({ error: `Error processing file: ${error.message}` });
  }
});

// Convert JSON to CSV endpoint
app.post('/api/convert-to-csv', (req, res) => {
  try {
    const { data } = req.body;
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: 'Invalid data format. Expected an array.' });
    }
    
    const csv = convertToCSV(data);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=output.csv');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: `Error converting to CSV: ${error.message}` });
  }
});

// Profile management routes

// Get all profiles
app.get('/api/profiles', (req, res) => {
  try {
    const profiles = getAllProfiles();
    res.json({
      success: true,
      count: profiles.length,
      profiles: profiles
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a specific profile by ID
app.get('/api/profiles/:id', (req, res) => {
  try {
    const { id } = req.params;
    const profile = getProfile(id);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    res.json({
      success: true,
      profile: profile
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new profile
app.post('/api/profiles', (req, res) => {
  try {
    const profileData = req.body;
    
    // Validate required fields
    if (!profileData.name) {
      return res.status(400).json({ error: 'Profile name is required' });
    }
    
    // Generate profile ID if not provided
    const profileId = profileData.id || generateProfileId();
    
    // Check if profile already exists
    if (getProfile(profileId)) {
      return res.status(409).json({ error: 'Profile with this ID already exists' });
    }
    
    const savedProfile = saveProfile(profileId, profileData);
    
    res.status(201).json({
      success: true,
      message: 'Profile created successfully',
      profile: savedProfile
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update an existing profile
app.put('/api/profiles/:id', (req, res) => {
  try {
    const { id } = req.params;
    const profileData = req.body;
    
    // Check if profile exists
    const existingProfile = getProfile(id);
    if (!existingProfile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    // Preserve createdAt and id
    const updatedProfileData = {
      ...existingProfile,
      ...profileData,
      id: id,
      createdAt: existingProfile.createdAt,
      updatedAt: new Date().toISOString()
    };
    
    const savedProfile = saveProfile(id, updatedProfileData);
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      profile: savedProfile
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a profile
app.delete('/api/profiles/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    const deleted = deleteProfile(id);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    res.json({
      success: true,
      message: 'Profile deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Multi-file upload endpoint for transformation setup
app.post('/api/upload-files', uploadMultiple, async (req, res) => {
  try {
    const files = req.files;
    
    // Validate required files
    if (!files.inputFile || files.inputFile.length === 0) {
      return res.status(400).json({ error: 'inputFile is required' });
    }
    
    if (!files.outputSampleFile || files.outputSampleFile.length === 0) {
      return res.status(400).json({ error: 'outputSampleFile is required' });
    }
    
    const result = {
      inputFile: null,
      outputSampleFile: null,
      inputReference: null,
      outputReference: null
    };
    
    // Process inputFile (required)
    try {
      const inputFile = files.inputFile[0];
      result.inputFile = {
        filename: inputFile.filename,
        originalname: inputFile.originalname,
        size: inputFile.size,
        mimetype: inputFile.mimetype,
        data: await parseFile(inputFile.path, inputFile.originalname)
      };
    } catch (error) {
      return res.status(400).json({ 
        error: `Error processing input file "${files.inputFile[0].originalname}": ${error.message}` 
      });
    }
    
    // Process outputSampleFile (required)
    try {
      const outputSampleFile = files.outputSampleFile[0];
      result.outputSampleFile = {
        filename: outputSampleFile.filename,
        originalname: outputSampleFile.originalname,
        size: outputSampleFile.size,
        mimetype: outputSampleFile.mimetype,
        data: await parseFile(outputSampleFile.path, outputSampleFile.originalname)
      };
    } catch (error) {
      return res.status(400).json({ 
        error: `Error processing output sample file "${files.outputSampleFile[0].originalname}": ${error.message}` 
      });
    }
    
    // Process inputReference (optional)
    if (files.inputReference && files.inputReference.length > 0) {
      try {
        const inputReference = files.inputReference[0];
        result.inputReference = {
          filename: inputReference.filename,
          originalname: inputReference.originalname,
          size: inputReference.size,
          mimetype: inputReference.mimetype,
          data: await parseFile(inputReference.path, inputReference.originalname)
        };
      } catch (error) {
        console.error(`Warning: Error processing input reference "${files.inputReference[0].originalname}":`, error.message);
        result.inputReference = { 
          error: `Could not process input reference: ${error.message}`,
          filename: files.inputReference[0].originalname
        };
      }
    }
    
    // Process outputReference (optional)
    if (files.outputReference && files.outputReference.length > 0) {
      try {
        const outputReference = files.outputReference[0];
        result.outputReference = {
          filename: outputReference.filename,
          originalname: outputReference.originalname,
          size: outputReference.size,
          mimetype: outputReference.mimetype,
          data: await parseFile(outputReference.path, outputReference.originalname)
        };
      } catch (error) {
        console.error(`Warning: Error processing output reference "${files.outputReference[0].originalname}":`, error.message);
        result.outputReference = { 
          error: `Could not process output reference: ${error.message}`,
          filename: files.outputReference[0].originalname
        };
      }
    }
    
    res.json({
      success: true,
      message: 'Files processed successfully',
      files: result
    });
  } catch (error) {
    res.status(500).json({ error: `Error processing files: ${error.message}` });
  }
});

// AI-powered transformation mapping endpoint
app.post('/api/ai-map', async (req, res) => {
  try {
    const { inputData, inputFilePath, outputSample, inputReference, outputReference, customMappings, changedMappings, changedMappingKeys, previousPreview, previousValidations, previousRules } = req.body;

    // Validate required fields - either inputData or inputFilePath must be provided
    let actualInputData = inputData;
    
    // If inputFilePath is provided, read from file (for large files)
    if (inputFilePath && fs.existsSync(inputFilePath)) {
      console.log('[AI-Map] Reading input data from file path:', inputFilePath);
      try {
        const fileName = path.basename(inputFilePath);
        actualInputData = await parseFile(inputFilePath, fileName);
        console.log('[AI-Map] Loaded', actualInputData.length, 'records from file');
      } catch (error) {
        return res.status(400).json({ error: `Error reading input file: ${error.message}` });
      }
    }
    
    if (!actualInputData || !Array.isArray(actualInputData)) {
      return res.status(400).json({ error: 'inputData or inputFilePath is required and must provide valid array data' });
    }

    if (!outputSample) {
      return res.status(400).json({ error: 'outputSample is required' });
    }

    let aiMapping;

    // If custom mappings are provided, call AI to review and enhance them
    if (customMappings && Array.isArray(customMappings) && customMappings.length > 0) {
      console.log('[API] Custom mappings provided...');
      
      // Check if we have changed mappings - only send those to AI
      const hasChangedMappings = changedMappings && Array.isArray(changedMappings) && changedMappings.length > 0;
      
      if (hasChangedMappings) {
        // OPTIMIZATION: Only send changed/new mappings to AI for rule generation
        console.log('[API] Sending only', changedMappings.length, 'changed/new mappings to AI (out of', customMappings.length, 'total)');
        
        // Call AI only for changed mappings
        aiMapping = await generateTransformationMapping(
          actualInputData,
          outputSample,
          inputReference || null,
          outputReference || null,
          changedMappings // Only pass changed mappings to AI
        );
        
        // Create a map of AI-generated rules for changed mappings
        const aiGeneratedRulesMap = new Map();
        const aiGeneratedValidationsMap = new Map();
        
        if (aiMapping.rules && Array.isArray(aiMapping.rules)) {
          aiMapping.rules.forEach(rule => {
            // Extract output field from rule description
            const fieldMatch = rule.description && (
              rule.description.match(/to (\w+):/) || 
              rule.description.match(/to (\w+)/) ||
              rule.description.match(/field (\w+)/)
            );
            if (fieldMatch) {
              aiGeneratedRulesMap.set(fieldMatch[1], rule);
            }
          });
        }
        
        if (aiMapping.validations && Array.isArray(aiMapping.validations)) {
          aiMapping.validations.forEach(validation => {
            if (validation.field) {
              aiGeneratedValidationsMap.set(validation.field, validation);
            }
          });
        }
        
        // Start with previous rules and validations, then update only changed ones
        const finalRules = previousRules && Array.isArray(previousRules) ? [...previousRules] : [];
        const finalValidations = previousValidations && Array.isArray(previousValidations) ? [...previousValidations] : [];
        
        // Update rules only for changed mappings
        changedMappings.forEach(m => {
          if (m.outputField) {
            // Check if AI generated a rule for this field
            const aiRule = aiGeneratedRulesMap.get(m.outputField);
            
            // Find existing rule index by outputField property or by description
            const existingRuleIndex = finalRules.findIndex(r => 
              r.outputField === m.outputField || 
              (r.description && (
                r.description.startsWith(`${m.outputField}:`) ||
                r.description.includes(`to ${m.outputField}:`) || 
                r.description.includes(`→ ${m.outputField}`)
              ))
            );
            
            // Create new rule based on mapping - show transformation clearly
            const transformation = m.transformations || m.transformation || '';
            const inputFieldName = m.inputField || '(generated)';
            const newRule = aiRule || {
              type: transformation ? 'formatting' : 'mapping',
              description: transformation 
                ? `${m.outputField}: ${transformation}`
                : `Map ${inputFieldName} → ${m.outputField}`,
              implementation: transformation
                ? `Apply transformation "${transformation}" to generate ${m.outputField}${m.inputField ? ` from ${m.inputField}` : ''}`
                : `Direct mapping from ${inputFieldName} to ${m.outputField}`,
              outputField: m.outputField,
              inputField: m.inputField || '',
              transformationRule: transformation
            };
            
            if (existingRuleIndex !== -1) {
              finalRules[existingRuleIndex] = newRule;
              console.log('[API] Updated existing rule for:', m.outputField, 'new transformation:', transformation);
            } else {
              finalRules.push(newRule);
              console.log('[API] Added new rule for:', m.outputField, 'transformation:', transformation);
            }
            
            // Update validation - use required value from changedMapping (user's edit)
            const aiValidation = aiGeneratedValidationsMap.get(m.outputField);
            const existingValidationIndex = finalValidations.findIndex(v => v.field === m.outputField);
            
            // Handle various formats of the required field
            let isRequired = false;
            if (m.required === true || m.required === 'true' || m.required === 1 || m.required === '1') {
              isRequired = true;
            } else if (m.required === false || m.required === 'false' || m.required === 0 || m.required === '0' || m.required === null || m.required === undefined) {
              isRequired = false;
            }
            
            console.log('[API] [hasChangedMappings path] Processing validation for:', m.outputField);
            console.log('[API]   - raw required value:', JSON.stringify(m.required));
            console.log('[API]   - type of required:', typeof m.required);
            console.log('[API]   - isRequired result:', isRequired);
            
            // Always use user's required setting, not AI's
            const newValidation = {
              field: m.outputField,
              type: isRequired ? 'required' : 'optional',
              rule: m.dataType || 'string',
              message: `${m.outputField} must be ${m.dataType || 'string'}${isRequired ? ' and is required' : ''}`
            };
            
            console.log('[API]   - final validation type:', newValidation.type);
            
            if (existingValidationIndex !== -1) {
              finalValidations[existingValidationIndex] = newValidation;
            } else {
              finalValidations.push(newValidation);
            }
          }
        });
        
        // Deduplicate final rules before setting
        const seenRuleFields = new Set();
        const seenRuleDescriptions = new Set();
        const dedupedRules = finalRules.filter(rule => {
          if (rule.outputField && seenRuleFields.has(rule.outputField)) {
            return false;
          }
          if (rule.description && seenRuleDescriptions.has(rule.description)) {
            return false;
          }
          if (rule.outputField) seenRuleFields.add(rule.outputField);
          if (rule.description) seenRuleDescriptions.add(rule.description);
          return true;
        });
        
        // Deduplicate final validations
        const seenValidationFields = new Set();
        const dedupedValidations = finalValidations.filter(v => {
          if (seenValidationFields.has(v.field)) {
            return false;
          }
          seenValidationFields.add(v.field);
          return true;
        });
        
        // Set final rules and validations (preserving unchanged ones)
        aiMapping.rules = dedupedRules;
        aiMapping.validations = dedupedValidations;
        
        console.log('[API] Preserved', previousRules?.length || 0, 'previous rules, updated', changedMappings.length, 'changed rules');
        console.log('[API] Final rules count (after dedup):', dedupedRules.length);
        if (dedupedRules.length > 0) {
          console.log('[API] Sample rule:', JSON.stringify(dedupedRules[dedupedRules.length - 1], null, 2));
        }
        
        // Flag to indicate validations were already processed
        aiMapping._validationsProcessed = true;
        aiMapping._rulesProcessed = true;
        
      } else {
        // No changed mappings detected - this is likely the initial load or full refresh
        console.log('[API] No changed mappings detected, calling AI for all mappings...');
        aiMapping = await generateTransformationMapping(
          actualInputData,
          outputSample,
          inputReference || null,
          outputReference || null,
          customMappings // Pass all custom mappings to AI
        );
      }
      
      // Parse layout info from output reference if available (for refresh operations)
      let outputLayoutInfo = {};
      if (outputReference) {
        console.log('[API] [Refresh] Scanning output reference for position/layout info...');
        outputLayoutInfo = parseLayoutFromReference(outputReference);
        console.log('[API] [Refresh] Extracted output layout for', Object.keys(outputLayoutInfo).length, 'fields');
      }
      
      // Merge position info and add missing fields from outputLayoutInfo
      if (Object.keys(outputLayoutInfo).length > 0) {
        console.log('[API] [Refresh] Merging position info into mappings...');
        console.log('[API] [Refresh] Layout fields available:', Object.keys(outputLayoutInfo));
        console.log('[API] [Refresh] AI mapping outputFields:', aiMapping.mappings ? aiMapping.mappings.map(m => m.outputField) : []);
        
        // Ensure aiMapping.mappings exists
        if (!aiMapping.mappings || !Array.isArray(aiMapping.mappings)) {
          aiMapping.mappings = [];
        }
        
        // Create a map of existing mappings by outputField (case-insensitive)
        const mappingsByOutputField = new Map();
        aiMapping.mappings.forEach(m => {
          if (m.outputField) {
            mappingsByOutputField.set(m.outputField.toLowerCase(), m);
          }
        });
        
        // Also check customMappings for existing fields
        if (customMappings && Array.isArray(customMappings)) {
          customMappings.forEach(m => {
            if (m.outputField) {
              mappingsByOutputField.set(m.outputField.toLowerCase(), m);
            }
          });
        }
        
        // First, merge position info into existing mappings
        let mergedCount = 0;
        aiMapping.mappings = aiMapping.mappings.map(mapping => {
          // Try exact match first
          let layoutInfo = outputLayoutInfo[mapping.outputField];
          
          // Try case-insensitive match if exact match fails
          if (!layoutInfo && mapping.outputField) {
            const outputFieldLower = mapping.outputField.toLowerCase();
            for (const key of Object.keys(outputLayoutInfo)) {
              if (key.toLowerCase() === outputFieldLower) {
                layoutInfo = outputLayoutInfo[key];
                console.log('[API] [Refresh] Case-insensitive match found:', mapping.outputField, '->', key);
                break;
              }
            }
          }
          
          if (layoutInfo) {
            mergedCount++;
            return {
              ...mapping,
              startPos: layoutInfo.startPos,
              endPos: layoutInfo.endPos,
              length: layoutInfo.length,
              posDataType: layoutInfo.dataType,
              posDescription: layoutInfo.description
            };
          }
          return mapping;
        });
        
        // Second, add any fields from outputLayoutInfo that are NOT in mappings
        const missingFields = [];
        Object.keys(outputLayoutInfo).forEach(fieldName => {
          const fieldNameLower = fieldName.toLowerCase();
          if (!mappingsByOutputField.has(fieldNameLower)) {
            missingFields.push(fieldName);
          }
        });
        
        if (missingFields.length > 0) {
          console.log('[API] [Refresh] Adding', missingFields.length, 'missing fields from outputLayoutInfo:', missingFields);
          
          missingFields.forEach(fieldName => {
            const layoutInfo = outputLayoutInfo[fieldName];
            aiMapping.mappings.push({
              inputField: '', // No input field mapped yet
              outputField: fieldName,
              transformation: '',
              transformations: '',
              required: false,
              dataType: layoutInfo.dataType || 'string',
              startPos: layoutInfo.startPos,
              endPos: layoutInfo.endPos,
              length: layoutInfo.length,
              posDataType: layoutInfo.dataType,
              posDescription: layoutInfo.description
            });
          });
        }
        
        console.log('[API] [Refresh] Merged position info for', mergedCount, 'existing mappings');
        console.log('[API] [Refresh] Added', missingFields.length, 'missing fields from layout');
        console.log('[API] [Refresh] Total mappings after merge:', aiMapping.mappings.length);
        
        // Store layout info in mapping result for frontend use
        aiMapping.outputLayoutInfo = outputLayoutInfo;
        aiMapping.isPositionBased = Object.keys(outputLayoutInfo).length > 0;
      }
      
      // Ensure the custom mappings are preserved in the response
      // Merge AI suggestions with user's custom mappings
      if (aiMapping.mappings && Array.isArray(aiMapping.mappings)) {
        // Create a map of AI mappings by input+output field
        const aiMappingsMap = new Map();
        aiMapping.mappings.forEach(m => {
          const key = `${m.inputField || ''}_${m.outputField || ''}`;
          aiMappingsMap.set(key, m);
        });
        
        // Merge: use custom mapping structure but enhance with AI suggestions
        // Preserve user's transformations and other custom values
        const mergedMappings = customMappings.map(customMapping => {
          const key = `${customMapping.inputField || ''}_${customMapping.outputField || ''}`;
          const aiMappingItem = aiMappingsMap.get(key);
          
          if (aiMappingItem) {
            // Merge: preserve user's custom values (especially transformations), but use AI for rules/validations
            return {
              inputField: customMapping.inputField || aiMappingItem.inputField,
              outputField: customMapping.outputField || aiMappingItem.outputField,
              // Preserve user's transformations - they take priority
              transformation: customMapping.transformations || customMapping.transformation || aiMappingItem.transformation || '',
              transformations: customMapping.transformations || customMapping.transformation || aiMappingItem.transformation || '',
              // Preserve user's data type and required settings
              required: customMapping.required !== undefined ? customMapping.required : (aiMappingItem.required || false),
              dataType: customMapping.dataType || aiMappingItem.dataType || 'string',
              // Use AI's validation suggestions
              validation: aiMappingItem.validation || customMapping.rules || customMapping.validation || '',
              defaultValue: customMapping.defaultValue !== undefined ? customMapping.defaultValue : aiMappingItem.defaultValue
            };
          } else {
            // Custom mapping not found in AI response, use as-is but ensure all fields are present
            return {
              inputField: customMapping.inputField || '',
              outputField: customMapping.outputField || '',
              transformation: customMapping.transformations || customMapping.transformation || '',
              transformations: customMapping.transformations || customMapping.transformation || '',
              required: customMapping.required || false,
              dataType: customMapping.dataType || 'string',
              validation: customMapping.rules || customMapping.validation || '',
              defaultValue: customMapping.defaultValue
            };
          }
        });
        
        // Add any new mappings from customMappings that weren't in AI response
        // This ensures new rows added by user are included
        customMappings.forEach(customMapping => {
          const key = `${customMapping.inputField || ''}_${customMapping.outputField || ''}`;
          const existsInMerged = mergedMappings.some(m => 
            `${m.inputField || ''}_${m.outputField || ''}` === key
          );
          if (!existsInMerged && customMapping.inputField && customMapping.outputField) {
            // This is a new mapping from user that AI didn't return
            mergedMappings.push({
              inputField: customMapping.inputField,
              outputField: customMapping.outputField,
              transformation: customMapping.transformations || customMapping.transformation || '',
              transformations: customMapping.transformations || customMapping.transformation || '',
              required: customMapping.required || false,
              dataType: customMapping.dataType || 'string',
              validation: customMapping.rules || customMapping.validation || '',
              defaultValue: customMapping.defaultValue
            });
            console.log('[API] Added new user mapping to merged mappings:', key);
          }
        });
        
        // Remove duplicates (by inputField+outputField combination)
        const uniqueMappings = [];
        const seenKeys = new Set();
        mergedMappings.forEach(m => {
          const key = `${m.inputField || ''}_${m.outputField || ''}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueMappings.push(m);
          }
        });
        
        aiMapping.mappings = uniqueMappings;
        console.log('[API] Final merged mappings count:', uniqueMappings.length);
      } else {
        // If AI didn't return mappings, use custom mappings
        aiMapping.mappings = customMappings.map(m => ({
          inputField: m.inputField || '',
          outputField: m.outputField || '',
          transformation: m.transformations || m.transformation || '',
          transformations: m.transformations || m.transformation || '',
          required: m.required || false,
          dataType: m.dataType || 'string',
          validation: m.rules || m.validation || '',
          defaultValue: m.defaultValue
        }));
      }
      
      // Track which columns have changed
      const changedKeysSet = changedMappingKeys ? new Set(changedMappingKeys) : new Set();
      const changedOutputFields = new Set();
      
      // Get changed output fields from changed mappings first
      if (changedMappings && Array.isArray(changedMappings) && changedMappings.length > 0) {
        changedMappings.forEach(m => {
          if (m.outputField) {
            changedOutputFields.add(m.outputField);
            console.log('[API] Changed output field from changedMappings:', m.outputField);
          }
        });
      }
      
      // Also check merged mappings to ensure we capture all changed fields
      if (aiMapping.mappings && Array.isArray(aiMapping.mappings)) {
        aiMapping.mappings.forEach(m => {
          const key = `${m.inputField || ''}_${m.outputField || ''}`;
          if (changedKeysSet.has(key) && m.outputField) {
            changedOutputFields.add(m.outputField);
            console.log('[API] Changed output field from merged mappings:', m.outputField, 'key:', key);
          }
        });
      }
      
      console.log('[API] Changed output fields (final):', Array.from(changedOutputFields));
      console.log('[API] Changed mapping keys:', Array.from(changedKeysSet));
      
      // Regenerate preview - only update changed columns, preserve others
      // Use merged mappings which have user's transformations preserved
      console.log('[API] Generating preview with merged mappings (count:', aiMapping.mappings.length, ')');
      if (aiMapping.mappings.length > 0) {
        console.log('[API] Sample merged mapping:', {
          inputField: aiMapping.mappings[0].inputField,
          outputField: aiMapping.mappings[0].outputField,
          transformations: aiMapping.mappings[0].transformations || aiMapping.mappings[0].transformation,
          dataType: aiMapping.mappings[0].dataType
        });
      }
      
      // Check if any mappings have complex transformations that need AI interpretation
      const mappingsWithComplexTransforms = aiMapping.mappings.filter(m => {
        const transform = (m.transformations || m.transformation || '').toLowerCase();
        // Check for complex natural language transformations (not just basic keywords)
        if (!transform) return false;
        
        // Basic transformations that don't need AI
        const basicPatterns = ['uppercase', 'lowercase', 'trim', 'upper case', 'lower case'];
        const isBasicOnly = basicPatterns.some(p => transform === p || transform === p.replace(' ', ''));
        
        // If it has more than just basic keywords, it's complex
        return !isBasicOnly && transform.length > 0;
      });
      
      console.log('[API] Mappings with complex transformations:', mappingsWithComplexTransforms.length);
      
      // Apply AI transformations for complex natural language rules
      let aiTransformedData = null;
      if (mappingsWithComplexTransforms.length > 0) {
        console.log('[API] Applying AI transformations for complex rules...');
        try {
          aiTransformedData = await applyAITransformations(actualInputData, aiMapping.mappings);
          if (aiTransformedData && aiTransformedData.length > 0) {
            console.log('[API] AI transformations applied successfully, records:', aiTransformedData.length);
          }
        } catch (aiError) {
          console.warn('[API] AI transformation failed, falling back to basic transformations:', aiError.message);
        }
      }
      
      // IMPORTANT: Use customMappings for preview generation to ensure ALL fields and transformations are included
      // customMappings contains the user's latest edits, including all transformations
      // aiMapping.mappings might be missing some fields or have outdated transformations
      const previewMappings = customMappings && customMappings.length > 0 ? customMappings : aiMapping.mappings;
      
      console.log('[API] Generating preview with', previewMappings.length, 'mappings (from customMappings:', customMappings?.length || 0, ', from aiMapping:', aiMapping.mappings?.length || 0, ')');
      if (previewMappings.length > 0) {
        console.log('[API] Sample preview mapping:', {
          outputField: previewMappings[0].outputField,
          inputField: previewMappings[0].inputField,
          transformations: previewMappings[0].transformations || previewMappings[0].transformation,
          dataType: previewMappings[0].dataType
        });
      }
      
      // Convert customMappings format to match what generatePreviewFromMappings expects
      const formattedPreviewMappings = previewMappings.map(m => ({
        inputField: m.inputField || '',
        outputField: m.outputField || '',
        transformation: m.transformations || m.transformation || '',
        transformations: m.transformations || m.transformation || '',
        required: m.required || false,
        dataType: m.dataType || 'string',
        defaultValue: m.defaultValue,
        startPos: m.startPos,
        endPos: m.endPos,
        length: m.length
      }));
      
      // Generate preview with all mappings (use AI-transformed data if available)
      // Always generate up to 100 records for preview
      const newPreview = generatePreviewFromMappings(actualInputData, outputSample, formattedPreviewMappings, aiTransformedData);
      console.log('[API] Generated new preview with', newPreview.length, 'records (target: 100)');
      
      // Log preview fields to verify all mappings are included
      if (newPreview.length > 0) {
        const previewFields = Object.keys(newPreview[0]);
        const mappingFields = formattedPreviewMappings.map(m => m.outputField).filter(Boolean);
        const missingInPreview = mappingFields.filter(f => !previewFields.includes(f));
        if (missingInPreview.length > 0) {
          console.warn('[API] Fields in mappings but missing in preview:', missingInPreview);
        }
        console.log('[API] Preview fields count:', previewFields.length, 'Mapping fields count:', mappingFields.length);
      }
      
      // Ensure we have at least 100 records if input data allows
      if (newPreview.length < 100 && Array.isArray(actualInputData) && actualInputData.length >= 100) {
        console.warn('[API] Preview has fewer records than expected. Input data has', actualInputData.length, 'records but preview only has', newPreview.length);
      }
      if (newPreview.length > 0 && changedOutputFields.size > 0) {
        const firstChangedField = Array.from(changedOutputFields)[0];
        console.log('[API] Sample new preview record (first changed field:', firstChangedField, '):', 
          newPreview[0][firstChangedField]);
      }
      
      // Get ALL output fields from mappings to ensure preview includes everything
      const allMappingOutputFields = new Set();
      formattedPreviewMappings.forEach(m => {
        if (m.outputField) {
          allMappingOutputFields.add(m.outputField);
        }
      });
      console.log('[API] All output fields from mappings:', Array.from(allMappingOutputFields));
      
      // Ensure preview includes ALL fields from mappings, even if they're empty
      if (newPreview.length > 0) {
        newPreview.forEach(record => {
          allMappingOutputFields.forEach(field => {
            if (!(field in record)) {
              record[field] = ''; // Initialize missing fields with empty string
            }
          });
        });
      }
      
      // If we have previous preview and changed fields, merge them
      if (previousPreview && Array.isArray(previousPreview) && previousPreview.length > 0 && changedOutputFields.size > 0) {
        // Get all output fields from new preview (includes new columns)
        const allNewOutputFields = new Set();
        if (newPreview.length > 0) {
          Object.keys(newPreview[0]).forEach(field => allNewOutputFields.add(field));
        }
        
        // Merge: update changed columns, add new columns, preserve unchanged ones
        aiMapping.preview = previousPreview.map((existingRecord, index) => {
          const newRecord = newPreview[index] || {};
          // Create merged record: start with existing record
          const mergedRecord = { ...existingRecord };
          
          // Ensure ALL mapping fields exist in merged record
          allMappingOutputFields.forEach(field => {
            if (newRecord[field] !== undefined) {
              mergedRecord[field] = newRecord[field];
            } else if (!(field in mergedRecord)) {
              mergedRecord[field] = ''; // Add missing field
            }
          });
          
          // Update changed fields with new values (this applies transformations)
          changedOutputFields.forEach(field => {
            if (newRecord[field] !== undefined) {
              mergedRecord[field] = newRecord[field];
              if (index === 0) {
                console.log('[API] Updated preview field:', field, 'for record', index, ':', newRecord[field]);
              }
            }
          });
          
          // Also ensure all columns from new preview exist in merged record
          // This handles new output columns that might not be in changedOutputFields
          Object.keys(newRecord).forEach(field => {
            if (!(field in mergedRecord)) {
              mergedRecord[field] = newRecord[field];
              if (index === 0) {
                console.log('[API] Added new column to preview:', field, 'for record', index, ':', newRecord[field]);
              }
            }
          });
          
          return mergedRecord;
        });
        console.log('[API] Merged preview: updated', changedOutputFields.size, 'columns, total columns:', allMappingOutputFields.size);
      } else {
        // No previous preview or no changed fields, use new preview
        // But ensure it has ALL fields from mappings
        aiMapping.preview = newPreview;
        console.log('[API] Using new preview (no previous preview or no changed fields)');
      }
      
      // Final check: ensure preview has all fields from mappings
      if (aiMapping.preview.length > 0) {
        const previewFields = Object.keys(aiMapping.preview[0]);
        const missingFields = Array.from(allMappingOutputFields).filter(f => !previewFields.includes(f));
        if (missingFields.length > 0) {
          console.warn('[API] Adding missing fields to preview:', missingFields);
          aiMapping.preview.forEach(record => {
            missingFields.forEach(field => {
              record[field] = '';
            });
          });
        }
        console.log('[API] Final preview fields count:', Object.keys(aiMapping.preview[0]).length, 'Mapping fields count:', allMappingOutputFields.size);
      }
      
      // Update validations - only for changed mappings
      // Skip if validations were already processed in the hasChangedMappings path
      if (aiMapping._validationsProcessed) {
        console.log('[API] Validations already processed in hasChangedMappings path, skipping...');
      } else {
        // Start with previous validations if available, otherwise use AI-generated ones
        if (previousValidations && Array.isArray(previousValidations) && previousValidations.length > 0) {
          aiMapping.validations = JSON.parse(JSON.stringify(previousValidations)); // Deep copy
        } else if (!aiMapping.validations) {
          aiMapping.validations = [];
        }
      }
      
      const validationMap = new Map();
      aiMapping.validations.forEach(v => {
        validationMap.set(v.field, v);
      });
      
      // Update validations for changed mappings AND new mappings
      // Use changedMappings which contains the actual user edits with correct required values
      const changedMappingsMap = new Map();
      if (changedMappings && Array.isArray(changedMappings)) {
        changedMappings.forEach(m => {
          if (m.outputField) {
            changedMappingsMap.set(m.outputField, m);
          }
        });
      }
      
      // Skip validation update if already processed
      if (aiMapping._validationsProcessed) {
        console.log('[API] Skipping validation updates (already processed)');
      } else if (changedOutputFields.size > 0) {
        changedOutputFields.forEach(outputField => {
          // Get mapping from changedMappings (has correct required value from user)
          // or fall back to aiMapping.mappings
          const changedMapping = changedMappingsMap.get(outputField);
          const m = changedMapping || aiMapping.mappings.find(mapping => mapping.outputField === outputField);
          
          if (m && m.outputField) {
            const existingValidation = validationMap.get(m.outputField);
            
            // Handle various formats of the required field
            let isRequired = false;
            if (m.required === true || m.required === 'true' || m.required === 1 || m.required === '1') {
              isRequired = true;
            } else if (m.required === false || m.required === 'false' || m.required === 0 || m.required === '0' || m.required === null || m.required === undefined) {
              isRequired = false;
            }
            
            const newValidation = {
              field: m.outputField,
              type: isRequired ? 'required' : 'optional',
              rule: m.dataType || 'string',
              message: `${m.outputField} must be ${m.dataType || 'string'}${isRequired ? ' and is required' : ''}`
            };
            
            console.log('[API] [changedOutputFields path] Creating validation for:', m.outputField);
            console.log('[API]   - source: changedMapping=', !!changedMappingsMap.get(m.outputField));
            console.log('[API]   - raw required value:', JSON.stringify(m.required));
            console.log('[API]   - type of required:', typeof m.required);
            console.log('[API]   - isRequired result:', isRequired);
            console.log('[API]   - final validation type:', newValidation.type);
            
            if (existingValidation) {
              // Update existing validation for changed field
              existingValidation.type = newValidation.type;
              existingValidation.rule = newValidation.rule;
              existingValidation.message = newValidation.message;
              console.log('[API] Updated validation for changed field:', m.outputField, 'type:', newValidation.type);
            } else {
              // Add new validation for changed/new field
              aiMapping.validations.push(newValidation);
              validationMap.set(m.outputField, newValidation);
              console.log('[API] Added new validation for field:', m.outputField, 'type:', newValidation.type);
            }
          }
        });
      } else {
        // No changed fields detected, but ensure all mappings have validations
        // This handles the case where all mappings are new
        aiMapping.mappings.forEach(m => {
          // Output field is required, input field is optional
          if (m.outputField) {
            if (!validationMap.has(m.outputField)) {
              // Handle various formats of the required field
              let isRequired = false;
              if (m.required === true || m.required === 'true' || m.required === 1 || m.required === '1') {
                isRequired = true;
              }
              
              const newValidation = {
                field: m.outputField,
                type: isRequired ? 'required' : 'optional',
                rule: m.dataType || 'string',
                message: `${m.outputField} must be ${m.dataType || 'string'}${isRequired ? ' and is required' : ''}`
              };
              aiMapping.validations.push(newValidation);
              validationMap.set(m.outputField, newValidation);
              console.log('[API] Added validation for new field:', m.outputField, 'type:', newValidation.type, 'required:', m.required);
            }
          }
        });
      }
      
      // Update rules - only for changed mappings
      // Skip if rules were already processed in hasChangedMappings path
      if (aiMapping._rulesProcessed) {
        console.log('[API] Rules already processed in hasChangedMappings path, skipping...');
      } else {
        // Start with previous rules if available, otherwise use AI-generated ones
        if (previousRules && Array.isArray(previousRules) && previousRules.length > 0) {
          aiMapping.rules = JSON.parse(JSON.stringify(previousRules)); // Deep copy
        } else if (!aiMapping.rules) {
          aiMapping.rules = [];
        }
        
        // Update/add rules for changed mappings AND new mappings
        // Build map of existing rules by output field
        const existingRulesMap = new Map();
        aiMapping.rules.forEach((r, index) => {
          // Extract field from description if possible - try multiple patterns
          const fieldMatch = r.description && (
            r.description.match(/to (\w+):/) || 
            r.description.match(/to (\w+)/) ||
            r.description.match(/field (\w+)/)
          );
          if (fieldMatch) {
            existingRulesMap.set(fieldMatch[1], index);
          }
        });
        
        if (changedOutputFields.size > 0) {
        // Process changed mappings - only update rules for changed/new fields
        aiMapping.mappings.forEach(m => {
          // Output field is required, input field is optional
          if (m.outputField && changedOutputFields.has(m.outputField)) {
            const transformation = m.transformations || m.transformation || '';
            const inputFieldName = m.inputField || '(generated)';
            
            // Always create/update rule for changed/new field
            const existingRuleIndex = existingRulesMap.get(m.outputField);
            const newRule = {
              type: transformation ? 'formatting' : 'mapping',
              description: transformation 
                ? `${m.outputField}: ${transformation}`
                : `Map ${inputFieldName} → ${m.outputField}`,
              implementation: transformation
                ? `Apply transformation "${transformation}" to generate ${m.outputField}${m.inputField ? ` from ${m.inputField}` : ''}`
                : `Direct mapping from ${inputFieldName} to ${m.outputField}`,
              outputField: m.outputField,
              inputField: m.inputField || '',
              transformationRule: transformation
            };
            
            if (existingRuleIndex !== undefined) {
              // Update existing rule
              aiMapping.rules[existingRuleIndex] = newRule;
              console.log('[API] Updated rule for changed field:', m.outputField, 'transformation:', transformation);
            } else {
              // Add new rule
              aiMapping.rules.push(newRule);
              existingRulesMap.set(m.outputField, aiMapping.rules.length - 1);
              console.log('[API] Added new rule for changed/new field:', m.outputField, 'transformation:', transformation);
            }
          }
        });
      } else {
        // No changed fields detected, but ensure all mappings have rules
        // This handles the case where all mappings are new
        aiMapping.mappings.forEach(m => {
          // Output field is required, input field is optional
          if (m.outputField) {
            if (!existingRulesMap.has(m.outputField)) {
              const transformation = m.transformations || m.transformation || '';
              const inputFieldName = m.inputField || '(generated)';
              const newRule = {
                type: transformation ? 'formatting' : 'mapping',
                description: transformation 
                  ? `${m.outputField}: ${transformation}`
                  : `Map ${inputFieldName} → ${m.outputField}`,
                implementation: transformation
                  ? `Apply transformation "${transformation}" to generate ${m.outputField}${m.inputField ? ` from ${m.inputField}` : ''}`
                  : `Direct mapping from ${inputFieldName} to ${m.outputField}`,
                outputField: m.outputField,
                inputField: m.inputField || '',
                transformationRule: transformation
              };
              aiMapping.rules.push(newRule);
              existingRulesMap.set(m.outputField, aiMapping.rules.length - 1);
              console.log('[API] Added rule for new field:', m.outputField, 'transformation:', transformation);
            }
          }
        });
        }
      } // End of rules update else block
      
      // Deduplicate rules by outputField to prevent duplicates
      if (aiMapping.rules && Array.isArray(aiMapping.rules)) {
        const seenOutputFields = new Set();
        const seenDescriptions = new Set();
        aiMapping.rules = aiMapping.rules.filter(rule => {
          const key = rule.outputField || rule.description;
          if (rule.outputField && seenOutputFields.has(rule.outputField)) {
            console.log('[API] Removing duplicate rule for outputField:', rule.outputField);
            return false;
          }
          if (rule.description && seenDescriptions.has(rule.description)) {
            console.log('[API] Removing duplicate rule with description:', rule.description);
            return false;
          }
          if (rule.outputField) seenOutputFields.add(rule.outputField);
          if (rule.description) seenDescriptions.add(rule.description);
          return true;
        });
      }
      
      // Deduplicate validations by field
      if (aiMapping.validations && Array.isArray(aiMapping.validations)) {
        const seenFields = new Set();
        aiMapping.validations = aiMapping.validations.filter(v => {
          if (seenFields.has(v.field)) {
            console.log('[API] Removing duplicate validation for field:', v.field);
            return false;
          }
          seenFields.add(v.field);
          return true;
        });
      }
      
      console.log('[API] Updated only changed columns - Rules:', aiMapping.rules?.length || 0);
      console.log('[API] Updated only changed columns - Validations:', aiMapping.validations?.length || 0);
      console.log('[API] Updated only changed columns - Preview records:', aiMapping.preview?.length || 0);
      console.log('[API] Changed output fields:', Array.from(changedOutputFields));
    } else {
      // Call AI service to generate transformation mapping from scratch
      aiMapping = await generateTransformationMapping(
        inputData,
        outputSample,
        inputReference || null,
        outputReference || null
      );
    }

    // Clean up internal flags before returning
    delete aiMapping._validationsProcessed;
    delete aiMapping._rulesProcessed;
    
    res.json({
      success: true,
      message: 'Mapping generated successfully',
      mapping: aiMapping
    });
  } catch (error) {
    res.status(500).json({ 
      error: `Error generating mapping: ${error.message}`,
      details: error.message.includes('API key') ? 'Please configure OPENAI_API_KEY in your .env file' : undefined
    });
  }
});

// Combined endpoint: upload files and generate AI mapping in one request
app.post('/api/upload-and-map', (req, res, next) => {
  console.log('[API] /api/upload-and-map - Request received');
  console.log('[API] Method:', req.method);
  console.log('[API] URL:', req.url);
  console.log('[API] Content-Type:', req.headers['content-type']);
  console.log('[API] Origin:', req.headers.origin);
  
  // Wrap multer to catch all errors
  uploadMultiple(req, res, (err) => {
    if (err) {
      console.error('[API] Multer error caught in callback:', {
        message: err.message,
        code: err.code,
        name: err.name,
        type: err.constructor.name,
        isMulterError: err instanceof multer.MulterError
      });
      
      // Handle multer-specific errors
      if (err instanceof multer.MulterError) {
        console.error('[API] MulterError details:', err.code);
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size too large. Maximum size is 5GB.' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ error: 'Too many files. Maximum is 4 files.' });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ error: 'Unexpected file field name.' });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}`, code: err.code });
      }
      
      // Handle file filter errors
      if (err.code === 'INVALID_FILE_TYPE' || err.message.includes('File type')) {
        return res.status(400).json({ error: err.message });
      }
      
      // Generic error
      console.error('[API] Unknown upload error:', err);
      return res.status(400).json({ 
        error: err.message || 'File upload error',
        code: err.code || 'UNKNOWN_ERROR',
        details: 'Check server logs for more information'
      });
    }
    
    // Check if files were uploaded
    if (!req.files) {
      console.warn('[API] No files in request after multer processing');
      return res.status(400).json({ error: 'No files were uploaded' });
    }
    
    console.log('[API] Multer processing completed successfully');
    console.log('[API] Files received:', Object.keys(req.files));
    next();
  });
}, async (req, res) => {
  try {
    const files = req.files;
    console.log('[API] Files uploaded successfully:', files ? Object.keys(files) : 'No files');
    
    // Validate required files
    if (!files || !files.inputFile || files.inputFile.length === 0) {
      return res.status(400).json({ error: 'inputFile is required' });
    }
    
    if (!files.outputSampleFile || files.outputSampleFile.length === 0) {
      return res.status(400).json({ error: 'outputSampleFile is required' });
    }
    
    // Parse required files
    let inputData, outputSample;
    
    try {
      const inputFile = files.inputFile[0];
      inputData = await parseFile(inputFile.path, inputFile.originalname);
    } catch (error) {
      return res.status(400).json({ 
        error: `Error processing input file "${files.inputFile[0].originalname}": ${error.message}` 
      });
    }
    
    try {
      const outputSampleFile = files.outputSampleFile[0];
      outputSample = await parseFile(outputSampleFile.path, outputSampleFile.originalname);
    } catch (error) {
      return res.status(400).json({ 
        error: `Error processing output sample file "${files.outputSampleFile[0].originalname}": ${error.message}` 
      });
    }
    
    // Parse optional reference files
    let inputReference = null;
    let outputReference = null;
    
    if (files.inputReference && files.inputReference.length > 0) {
      try {
        const inputRefFile = files.inputReference[0];
        inputReference = await parseFile(inputRefFile.path, inputRefFile.originalname);
        console.log(`Input reference processed successfully: ${inputRefFile.originalname}`);
      } catch (error) {
        console.warn(`Warning: Could not process input reference "${files.inputReference[0].originalname}": ${error.message}`);
        // Continue without input reference - it's optional
      }
    }
    
    if (files.outputReference && files.outputReference.length > 0) {
      try {
        const outputRefFile = files.outputReference[0];
        outputReference = await parseFile(outputRefFile.path, outputRefFile.originalname);
        console.log(`Output reference processed successfully: ${outputRefFile.originalname}`);
      } catch (error) {
        console.warn(`Warning: Could not process output reference "${files.outputReference[0].originalname}": ${error.message}`);
        // Continue without output reference - it's optional
      }
    }
    
    // Parse layout info from output reference if available (works with ANY file type)
    let outputLayoutInfo = {};
    if (outputReference) {
      console.log('[API] Scanning output reference for position/layout info...');
      console.log('[API] Output reference type:', typeof outputReference, Array.isArray(outputReference) ? `array(${outputReference.length})` : '');
      if (Array.isArray(outputReference) && outputReference.length > 0) {
        console.log('[API] Output reference first row:', JSON.stringify(outputReference[0]));
        console.log('[API] Output reference keys:', Object.keys(outputReference[0]));
      }
      outputLayoutInfo = parseLayoutFromReference(outputReference);
      console.log('[API] Extracted output layout for', Object.keys(outputLayoutInfo).length, 'fields');
      if (Object.keys(outputLayoutInfo).length > 0) {
        const sampleKey = Object.keys(outputLayoutInfo)[0];
        console.log('[API] Sample layout entry:', sampleKey, outputLayoutInfo[sampleKey]);
      }
    }
    
    // Detect if output is position-based:
    // 1. From output sample file extension (.dat, .txt)
    // 2. OR from layout info found in output reference
    const outputSampleFileName = files.outputSampleFile[0].originalname.toLowerCase();
    const hasPositionLayout = Object.keys(outputLayoutInfo).length > 0;
    const isPositionBased = outputSampleFileName.endsWith('.dat') || outputSampleFileName.endsWith('.txt') || hasPositionLayout;
    console.log('[API] Output format detection - isPositionBased:', isPositionBased, 'filename:', outputSampleFileName);
    
    // Generate AI mapping with references included
    let aiMapping;
    try {
      console.log('Generating AI mapping with references:', {
        hasInputReference: !!inputReference,
        hasOutputReference: !!outputReference
      });
      aiMapping = await generateTransformationMapping(
        inputData,
        outputSample,
        inputReference,
        outputReference
      );
    } catch (error) {
      return res.status(500).json({ 
        error: `Error generating AI mapping: ${error.message}`,
        details: error.message.includes('API key') 
          ? 'Please configure OPENAI_API_KEY in your .env file' 
          : error.message.includes('timeout')
          ? 'AI service request timed out. Please try again with smaller files or check your connection.'
          : undefined
      });
    }
    
    // Merge position info from output layout into AI mappings
    // AND ensure ALL fields from outputLayoutInfo are in mappings (even if AI didn't return them)
    if (Object.keys(outputLayoutInfo).length > 0) {
      console.log('[API] Merging position info into mappings...');
      console.log('[API] Layout fields available:', Object.keys(outputLayoutInfo));
      console.log('[API] AI mapping outputFields:', aiMapping.mappings ? aiMapping.mappings.map(m => m.outputField) : []);
      
      // Ensure aiMapping.mappings exists
      if (!aiMapping.mappings || !Array.isArray(aiMapping.mappings)) {
        aiMapping.mappings = [];
      }
      
      // Create a map of existing mappings by outputField (case-insensitive)
      const mappingsByOutputField = new Map();
      aiMapping.mappings.forEach(m => {
        if (m.outputField) {
          mappingsByOutputField.set(m.outputField.toLowerCase(), m);
        }
      });
      
      // First, merge position info into existing mappings
      let mergedCount = 0;
      aiMapping.mappings = aiMapping.mappings.map(mapping => {
        // Try exact match first
        let layoutInfo = outputLayoutInfo[mapping.outputField];
        
        // Try case-insensitive match if exact match fails
        if (!layoutInfo && mapping.outputField) {
          const outputFieldLower = mapping.outputField.toLowerCase();
          for (const key of Object.keys(outputLayoutInfo)) {
            if (key.toLowerCase() === outputFieldLower) {
              layoutInfo = outputLayoutInfo[key];
              console.log('[API] Case-insensitive match found:', mapping.outputField, '->', key);
              break;
            }
          }
        }
        
        if (layoutInfo) {
          mergedCount++;
          console.log('[API] Merged position for:', mapping.outputField, layoutInfo);
          return {
            ...mapping,
            startPos: layoutInfo.startPos,
            endPos: layoutInfo.endPos,
            length: layoutInfo.length,
            posDataType: layoutInfo.dataType,
            posDescription: layoutInfo.description
          };
        }
        return mapping;
      });
      
      // Second, add any fields from outputLayoutInfo that are NOT in mappings
      const missingFields = [];
      Object.keys(outputLayoutInfo).forEach(fieldName => {
        const fieldNameLower = fieldName.toLowerCase();
        if (!mappingsByOutputField.has(fieldNameLower)) {
          missingFields.push(fieldName);
        }
      });
      
      if (missingFields.length > 0) {
        console.log('[API] Adding', missingFields.length, 'missing fields from outputLayoutInfo:', missingFields);
        
        missingFields.forEach(fieldName => {
          const layoutInfo = outputLayoutInfo[fieldName];
          aiMapping.mappings.push({
            inputField: '', // No input field mapped yet
            outputField: fieldName,
            transformation: '',
            transformations: '',
            required: false,
            dataType: layoutInfo.dataType || 'string',
            startPos: layoutInfo.startPos,
            endPos: layoutInfo.endPos,
            length: layoutInfo.length,
            posDataType: layoutInfo.dataType,
            posDescription: layoutInfo.description
          });
        });
      }
      
      console.log('[API] Merged position info for', mergedCount, 'existing mappings');
      console.log('[API] Added', missingFields.length, 'missing fields from layout');
      console.log('[API] Total mappings after merge:', aiMapping.mappings.length);
      
      // Store layout info in mapping result for frontend use
      aiMapping.outputLayoutInfo = outputLayoutInfo;
      aiMapping.isPositionBased = isPositionBased || Object.keys(outputLayoutInfo).length > 0;
      console.log('[API] isPositionBased set to:', aiMapping.isPositionBased);
    } else {
      console.log('[API] No position merge - layoutInfo fields:', Object.keys(outputLayoutInfo).length, 'aiMapping.mappings:', !!aiMapping.mappings);
    }
    
    // For large files, only return a sample to avoid "Invalid string length" errors
    // JavaScript has a maximum string length of ~2^28-1 characters (~512MB)
    const inputDataLength = Array.isArray(inputData) ? inputData.length : 0;
    const isLargeFile = inputDataLength > 1000;
    
    // Prepare response data - for large files, only include sample
    let responseInputData = inputData;
    if (isLargeFile && Array.isArray(inputData)) {
      // For large files, only send first 100 records for preview
      // The full file is stored on disk and can be accessed via file path
      responseInputData = inputData.slice(0, 100);
      console.log('[API] Large file detected (' + inputDataLength + ' records), returning sample of 100 records');
    }
    
    res.json({
      success: true,
      message: 'Files processed and AI mapping generated successfully',
      files: {
        inputFile: {
          filename: files.inputFile[0].filename,
          originalname: files.inputFile[0].originalname,
          size: files.inputFile[0].size,
          path: files.inputFile[0].path, // Include file path for large files
          data: responseInputData, // Include sample or full data depending on size
          totalRecords: inputDataLength, // Include total record count
          isLargeFile: isLargeFile // Flag to indicate if this is a large file
        },
        outputSampleFile: {
          filename: files.outputSampleFile[0].filename,
          originalname: files.outputSampleFile[0].originalname,
          size: files.outputSampleFile[0].size,
          data: outputSample // Output sample is usually small
        },
        inputReference: inputReference ? {
          data: inputReference
        } : null,
        outputReference: outputReference ? {
          data: outputReference
        } : null
      },
      mapping: aiMapping
    });
  } catch (error) {
    res.status(500).json({ error: `Error processing request: ${error.message}` });
  }
});

// Transform and save output file endpoint
app.post('/api/transform-and-save', async (req, res) => {
  try {
    console.log('[Transform-Save] Request received');
    const { inputData, inputFilePath, mappings, outputPath, fileName, format } = req.body;
    console.log('[Transform-Save] Request params:', {
      hasInputData: !!inputData,
      inputDataLength: Array.isArray(inputData) ? inputData.length : 'not array',
      hasInputFilePath: !!inputFilePath,
      inputFilePath: inputFilePath,
      mappingsCount: Array.isArray(mappings) ? mappings.length : 0,
      outputPath: outputPath,
      fileName: fileName,
      format: format
    });

    // Validate required fields - either inputData or inputFilePath must be provided
    let actualInputData = inputData;
    
    // If inputFilePath is provided, read from file (for large files)
    if (inputFilePath && fs.existsSync(inputFilePath)) {
      console.log('[Transform-Save] Reading input data from file path:', inputFilePath);
      try {
        const fileStats = fs.statSync(inputFilePath);
        console.log('[Transform-Save] File size:', (fileStats.size / 1024 / 1024).toFixed(2), 'MB');
        const fileName = path.basename(inputFilePath);
        actualInputData = await parseFile(inputFilePath, fileName);
        console.log('[Transform-Save] Loaded', actualInputData.length, 'records from file');
      } catch (error) {
        console.error('[Transform-Save] Error reading file:', error.message, error.stack);
        return res.status(400).json({ error: `Error reading input file: ${error.message}` });
      }
    } else if (inputFilePath) {
      console.error('[Transform-Save] File path provided but file does not exist:', inputFilePath);
      return res.status(400).json({ error: `Input file not found at path: ${inputFilePath}` });
    }
    
    // Validate that we have input data
    if (!actualInputData || !Array.isArray(actualInputData)) {
      console.error('[Transform-Save] No valid input data:', {
        actualInputData: actualInputData ? 'exists but not array' : 'null/undefined',
        type: typeof actualInputData
      });
      return res.status(400).json({ error: 'inputData or inputFilePath is required and must provide valid array data' });
    }

    if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({ error: 'mappings are required' });
    }

    if (!outputPath || !fileName) {
      return res.status(400).json({ error: 'outputPath and fileName are required' });
    }

    // Filter valid mappings - only require outputField, inputField is optional
    const validMappings = mappings.filter(m => m.outputField);

    if (validMappings.length === 0) {
      return res.status(400).json({ error: 'At least one valid mapping with output field is required' });
    }

    const recordCount = actualInputData.length;
    console.log('[Transform-Save] Processing', recordCount, 'records with', validMappings.length, 'mappings');

    // If more than 1000 records, create a background job instead
    if (recordCount > 1000) {
      console.log('[Transform-Save] Large file detected (' + recordCount + ' records), creating background job...');
      
      // Use existing file path if available, otherwise save to temp file
      let jobInputPath = inputFilePath;
      if (!jobInputPath || !fs.existsSync(jobInputPath)) {
        // Save input data to a temporary file for the job
        const tempInputPath = path.join(uploadsDir, `job-input-${Date.now()}.json`);
        fs.writeFileSync(tempInputPath, JSON.stringify(actualInputData), 'utf8');
        jobInputPath = tempInputPath;
      }

      // Create job
      const job = jobManager.createJob({
        inputData: null, // Don't store in job file, use file path instead
        inputFilePath: jobInputPath,
        mappings: validMappings,
        outputPath,
        fileName,
        format: format || 'csv'
      });

      // Trigger job processor
      runJobProcessor();

      return res.json({
        success: true,
        jobId: job.id,
        status: 'queued',
        message: `Large file detected (${recordCount} records). Job created and will process in background. You can close this window and check job status later.`,
        recordCount,
        isAsync: true
      });
    }

    // Continue with synchronous processing for files <= 1000 records
    
    // Check if any mappings have complex transformations that need AI interpretation
    const mappingsWithComplexTransforms = validMappings.filter(m => {
      const transform = (m.transformations || m.transformation || '').toLowerCase();
      if (!transform) return false;
      
      // Basic transformations that don't need AI
      const basicPatterns = ['uppercase', 'lowercase', 'trim', 'upper case', 'lower case'];
      const isBasicOnly = basicPatterns.some(p => transform === p || transform === p.replace(' ', ''));
      
      // If it has more than just basic keywords, it's complex
      return !isBasicOnly && transform.length > 0;
    });
    
    console.log('[Transform-Save] Mappings with complex transformations:', mappingsWithComplexTransforms.length);
    
    // Apply AI transformations for complex natural language rules (for ALL records)
    let aiTransformedData = null;
    if (mappingsWithComplexTransforms.length > 0) {
      console.log('[Transform-Save] Applying AI transformations for complex rules...');
      try {
        aiTransformedData = await applyAITransformations(actualInputData, validMappings);
        if (aiTransformedData && aiTransformedData.length > 0) {
          console.log('[Transform-Save] AI transformations applied successfully, records:', aiTransformedData.length);
        } else {
          console.warn('[Transform-Save] AI transformations returned empty result, using basic transformations');
        }
      } catch (aiError) {
        console.warn('[Transform-Save] AI transformation failed, falling back to basic transformations:', aiError.message);
        // Continue with basic transformations - don't fail the whole process
        aiTransformedData = null;
      }
    }

    // Transform ALL the data using the same logic as preview generation
    // Use generatePreviewFromMappings but for all records, not just 100
    const transformedData = [];
    
    // Get all output fields from mappings
    const allOutputFields = new Set();
    const mappingsByOutputField = new Map();
    validMappings.forEach(mapping => {
      if (mapping.outputField) {
        allOutputFields.add(mapping.outputField);
        mappingsByOutputField.set(mapping.outputField, mapping);
      }
    });
    
    console.log('[Transform-Save] Output fields:', Array.from(allOutputFields));
    
    for (let i = 0; i < actualInputData.length; i++) {
      const inputRecord = actualInputData[i];
      const transformedRecord = {};
      
      // Check if we have AI-transformed data for this record
      const aiRecord = aiTransformedData && aiTransformedData[i] ? aiTransformedData[i] : null;
      
      // Process each output field
      allOutputFields.forEach(outputField => {
        const mapping = mappingsByOutputField.get(outputField);
        
        // Priority 1: Use AI-transformed value if available
        if (aiRecord && aiRecord[outputField] !== undefined && aiRecord[outputField] !== '') {
          transformedRecord[outputField] = aiRecord[outputField];
          return;
        }
        
        if (!mapping) {
          transformedRecord[outputField] = '';
          return;
        }
        
        const inputField = mapping.inputField;
        const transformation = mapping.transformations || mapping.transformation || '';
        
        // Priority 2: If no input field, use default value or empty
        if (!inputField || inputField === '') {
          if (mapping.defaultValue !== undefined && mapping.defaultValue !== '') {
            transformedRecord[outputField] = mapping.defaultValue;
          } else {
            transformedRecord[outputField] = '';
          }
          return;
        }
        
        // Priority 3: Get input value and apply transformation
        let value = inputRecord && inputRecord[inputField] !== undefined 
          ? inputRecord[inputField] 
          : (mapping.defaultValue || '');
        
        // Apply transformation using the enhanced basic transformation function
        if (transformation) {
          value = applyBasicTransformation(value, transformation, mapping, inputRecord);
        } else {
          // Apply data type conversion even without explicit transformation
          if (value !== '' && value !== null && value !== undefined) {
            if (mapping.dataType === 'number') {
              const num = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
              value = isNaN(num) ? 0 : num;
            } else if (mapping.dataType === 'date') {
              const dateValue = new Date(value);
              value = isNaN(dateValue.getTime()) ? value : dateValue.toISOString().split('T')[0];
            } else {
              value = String(value);
            }
          }
        }
        
        // Ensure we never have undefined values
        transformedRecord[outputField] = value !== undefined && value !== null ? value : '';
      });
      
      transformedData.push(transformedRecord);
    }
    
    console.log('[Transform-Save] Transformed', transformedData.length, 'records');
    if (transformedData.length > 0) {
      console.log('[Transform-Save] Sample output record:', JSON.stringify(transformedData[0], null, 2));
    }

    // Ensure output directory exists
    if (!fs.existsSync(outputPath)) {
      try {
        fs.mkdirSync(outputPath, { recursive: true });
      } catch (error) {
        return res.status(400).json({ error: `Cannot create output directory: ${error.message}` });
      }
    }

    // Generate file path based on format
    let fileExtension;
    switch (format) {
      case 'xlsx':
        fileExtension = '.xlsx';
        break;
      case 'dat':
        fileExtension = '.dat';
        break;
      case 'txt':
        fileExtension = '.txt';
        break;
      default:
        fileExtension = '.csv';
    }
    const fullFilePath = path.join(outputPath, `${fileName}${fileExtension}`);

    // Save file based on format
    try {
      if (format === 'xlsx') {
        // Create Excel file
        console.log('[Transform-Save] Creating Excel file...');
        const worksheet = XLSX.utils.json_to_sheet(transformedData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
        XLSX.writeFile(workbook, fullFilePath);
        console.log('[Transform-Save] Excel file created successfully');
      } else if (format === 'dat' || format === 'txt') {
        // Create fixed-width positional file
        console.log('[Transform-Save] Creating fixed-width file...');
        const fixedWidthContent = convertToFixedWidth(transformedData, validMappings);
        fs.writeFileSync(fullFilePath, fixedWidthContent, 'utf8');
        console.log('[Transform-Save] Fixed-width file created successfully, size:', (fixedWidthContent.length / 1024).toFixed(2), 'KB');
      } else {
        // Create CSV file
        console.log('[Transform-Save] Creating CSV file...');
        const csv = convertToCSV(transformedData);
        fs.writeFileSync(fullFilePath, csv, 'utf8');
        console.log('[Transform-Save] CSV file created successfully, size:', (csv.length / 1024).toFixed(2), 'KB');
      }
    } catch (saveError) {
      console.error('[Transform-Save] Error saving file:', {
        message: saveError.message,
        path: fullFilePath,
        format: format,
        recordCount: transformedData.length
      });
      throw new Error(`Failed to save output file: ${saveError.message}. Please check output path permissions and disk space.`);
    }

    res.json({
      success: true,
      message: 'File transformed and saved successfully',
      filePath: fullFilePath,
      recordCount: transformedData.length
    });
  } catch (error) {
    console.error('[Transform-Save] Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code
    });
    
    // Make sure response hasn't been sent already
    if (!res.headersSent) {
      // Provide more helpful error messages based on error type
      let errorMessage = `Error transforming and saving file: ${error.message}`;
      let errorDetails = process.env.NODE_ENV === 'development' ? error.stack : undefined;
      
      // Check for specific error types
      if (error.message?.includes('Connection error') || error.message?.includes('ECONNREFUSED') || error.code === 'ECONNREFUSED') {
        errorMessage = 'Connection error: Unable to connect to AI service. Please check your internet connection and OpenAI API key configuration. The transformation will continue with basic transformations only.';
      } else if (error.message?.includes('API key') || error.message?.includes('authentication')) {
        errorMessage = 'Authentication error: Please check your OpenAI API key in the .env file.';
      } else if (error.message?.includes('timeout') || error.code === 'ETIMEDOUT') {
        errorMessage = 'Request timeout: The transformation is taking too long. For large files, consider using the background job feature (files >1000 records are automatically processed as background jobs).';
      } else if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
        errorMessage = `File not found: ${error.message}. Please ensure all input files are available.`;
      } else if (error.message?.includes('EACCES') || error.message?.includes('permission')) {
        errorMessage = `Permission denied: ${error.message}. Please check file and directory permissions.`;
      }
      
      res.status(500).json({ 
        error: errorMessage,
        details: errorDetails
      });
    } else {
      console.error('[Transform-Save] Response already sent, cannot send error response');
    }
  }
});

// Transform with profile and return preview
app.post('/api/transform-preview', upload.fields([
  { name: 'inputFile', maxCount: 1 },
  { name: 'profileFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const files = req.files;
    
    // Validate required files
    if (!files.inputFile || files.inputFile.length === 0) {
      return res.status(400).json({ error: 'inputFile is required' });
    }
    
    if (!files.profileFile || files.profileFile.length === 0) {
      return res.status(400).json({ error: 'profileFile is required' });
    }
    
    const inputFile = files.inputFile[0];
    const profileFile = files.profileFile[0];
    
    // Validate profile file extension
    if (!profileFile.originalname.endsWith('.prf')) {
      return res.status(400).json({ error: 'profileFile must be a .prf file' });
    }
    
    // Read and parse the profile file
    let profile;
    try {
      const profileContent = fs.readFileSync(profileFile.path, 'utf8');
      profile = JSON.parse(profileContent);
    } catch (error) {
      return res.status(400).json({ error: `Invalid profile file: ${error.message}` });
    }
    
    // Parse the input file
    let inputData;
    try {
      inputData = await parseFile(inputFile.path, inputFile.originalname);
    } catch (error) {
      return res.status(500).json({ error: `Error processing inputFile: ${error.message}` });
    }
    
    // Get mappings from profile
    const mappings = profile.mappings || [];
    console.log('[Transform] Profile loaded:', profile.name || profile.id);
    console.log('[Transform] Mappings count:', mappings.length);
    console.log('[Transform] Input data records:', inputData.length);
    
    if (mappings.length === 0) {
      return res.status(400).json({ error: 'Profile does not contain any mappings' });
    }
    
    // Check for complex transformations that need AI
    const mappingsWithComplexTransforms = mappings.filter(m => {
      const transform = (m.transformations || m.transformation || '').toLowerCase();
      if (!transform) return false;
      const basicPatterns = ['uppercase', 'lowercase', 'trim', 'upper case', 'lower case'];
      return !basicPatterns.some(p => transform === p || transform === p.replace(' ', ''));
    });
    
    // Apply AI transformations if there are complex rules
    let aiTransformedData = null;
    if (mappingsWithComplexTransforms.length > 0) {
      console.log('[Transform] Applying AI transformations for', mappingsWithComplexTransforms.length, 'complex rules');
      try {
        aiTransformedData = await applyAITransformations(inputData, mappings);
      } catch (err) {
        console.warn('[Transform] AI transformation failed:', err.message);
      }
    }
    
    // Generate preview using mappings (first 100 records)
    const preview = generatePreviewFromMappings(inputData, [], mappings, aiTransformedData);
    console.log('[Transform] Preview generated:', preview.length, 'records');
    
    res.json({
      success: true,
      message: 'Preview generated successfully',
      profile: {
        id: profile.id,
        name: profile.name,
        ...profile
      },
      preview: preview,
      totalRecords: inputData.length
    });
  } catch (error) {
    res.status(500).json({ error: `Error processing transformation: ${error.message}` });
  }
});

// Transform with profile and save to output path
app.post('/api/transform-and-save-with-profile', upload.fields([
  { name: 'inputFile', maxCount: 1 },
  { name: 'profileFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const files = req.files;
    const { outputPath, fileName, format } = req.body;
    
    // Validate required files
    if (!files.inputFile || files.inputFile.length === 0) {
      return res.status(400).json({ error: 'inputFile is required' });
    }
    
    if (!files.profileFile || files.profileFile.length === 0) {
      return res.status(400).json({ error: 'profileFile is required' });
    }
    
    if (!outputPath || !fileName) {
      return res.status(400).json({ error: 'outputPath and fileName are required' });
    }
    
    const inputFile = files.inputFile[0];
    const profileFile = files.profileFile[0];
    
    // Validate profile file extension
    if (!profileFile.originalname.endsWith('.prf')) {
      return res.status(400).json({ error: 'profileFile must be a .prf file' });
    }
    
    // Read and parse the profile file
    let profile;
    try {
      const profileContent = fs.readFileSync(profileFile.path, 'utf8');
      profile = JSON.parse(profileContent);
    } catch (error) {
      return res.status(400).json({ error: `Invalid profile file: ${error.message}` });
    }
    
    // Parse the input file
    let inputData;
    try {
      inputData = await parseFile(inputFile.path, inputFile.originalname);
    } catch (error) {
      return res.status(500).json({ error: `Error processing inputFile: ${error.message}` });
    }
    
    // Get mappings from profile - only require outputField
    const mappings = (profile.mappings || []).filter(m => m.outputField);
    if (mappings.length === 0) {
      return res.status(400).json({ error: 'Profile does not contain any valid mappings' });
    }
    
    console.log('[Transform-Profile] Processing', inputData.length, 'records with', mappings.length, 'mappings');
    
    // Check if any mappings have complex transformations that need AI interpretation
    const mappingsWithComplexTransforms = mappings.filter(m => {
      const transform = (m.transformations || m.transformation || '').toLowerCase();
      if (!transform) return false;
      
      // Basic transformations that don't need AI
      const basicPatterns = ['uppercase', 'lowercase', 'trim', 'upper case', 'lower case'];
      const isBasicOnly = basicPatterns.some(p => transform === p || transform === p.replace(' ', ''));
      
      return !isBasicOnly && transform.length > 0;
    });
    
    console.log('[Transform-Profile] Mappings with complex transformations:', mappingsWithComplexTransforms.length);
    
    // Apply AI transformations for complex natural language rules
    let aiTransformedData = null;
    if (mappingsWithComplexTransforms.length > 0) {
      console.log('[Transform-Profile] Applying AI transformations...');
      try {
        aiTransformedData = await applyAITransformations(inputData, mappings);
        if (aiTransformedData && aiTransformedData.length > 0) {
          console.log('[Transform-Profile] AI transformations applied, records:', aiTransformedData.length);
        }
      } catch (aiError) {
        console.warn('[Transform-Profile] AI transformation failed:', aiError.message);
      }
    }
    
    // Get all output fields from mappings
    const allOutputFields = new Set();
    const mappingsByOutputField = new Map();
    mappings.forEach(mapping => {
      if (mapping.outputField) {
        allOutputFields.add(mapping.outputField);
        mappingsByOutputField.set(mapping.outputField, mapping);
      }
    });
    
    // Transform all data using the same logic as preview generation
    const transformedData = [];
    
    for (let i = 0; i < inputData.length; i++) {
      const inputRecord = inputData[i];
      const transformedRecord = {};
      
      const aiRecord = aiTransformedData && aiTransformedData[i] ? aiTransformedData[i] : null;
      
      allOutputFields.forEach(outputField => {
        const mapping = mappingsByOutputField.get(outputField);
        
        // Priority 1: Use AI-transformed value if available
        if (aiRecord && aiRecord[outputField] !== undefined && aiRecord[outputField] !== '') {
          transformedRecord[outputField] = aiRecord[outputField];
          return;
        }
        
        if (!mapping) {
          transformedRecord[outputField] = '';
          return;
        }
        
        const inputField = mapping.inputField;
        const transformation = mapping.transformations || mapping.transformation || '';
        
        // Priority 2: If no input field, use default value or empty
        if (!inputField || inputField === '') {
          if (mapping.defaultValue !== undefined && mapping.defaultValue !== '') {
            transformedRecord[outputField] = mapping.defaultValue;
          } else {
            transformedRecord[outputField] = '';
          }
          return;
        }
        
        // Priority 3: Get input value and apply transformation
        let value = inputRecord && inputRecord[inputField] !== undefined 
          ? inputRecord[inputField] 
          : (mapping.defaultValue || '');
        
        // Apply transformation
        if (transformation) {
          value = applyBasicTransformation(value, transformation, mapping, inputRecord);
        } else {
          // Apply data type conversion
          if (value !== '' && value !== null && value !== undefined) {
            if (mapping.dataType === 'number') {
              const num = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
              value = isNaN(num) ? 0 : num;
            } else if (mapping.dataType === 'date') {
              const dateValue = new Date(value);
              value = isNaN(dateValue.getTime()) ? value : dateValue.toISOString().split('T')[0];
            } else {
              value = String(value);
            }
          }
        }
        
        transformedRecord[outputField] = value !== undefined && value !== null ? value : '';
      });
      
      transformedData.push(transformedRecord);
    }
    
    console.log('[Transform-Profile] Transformed', transformedData.length, 'records');

    // Ensure output directory exists
    if (!fs.existsSync(outputPath)) {
      try {
        fs.mkdirSync(outputPath, { recursive: true });
      } catch (error) {
        return res.status(400).json({ error: `Cannot create output directory: ${error.message}` });
      }
    }

    // Generate file path based on format
    let fileExtension;
    switch (format) {
      case 'xlsx':
        fileExtension = '.xlsx';
        break;
      case 'dat':
        fileExtension = '.dat';
        break;
      case 'txt':
        fileExtension = '.txt';
        break;
      default:
        fileExtension = '.csv';
    }
    const fullFilePath = path.join(outputPath, `${fileName}${fileExtension}`);

    // Save file based on format
    if (format === 'xlsx') {
      // Create Excel file
      const worksheet = XLSX.utils.json_to_sheet(transformedData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      XLSX.writeFile(workbook, fullFilePath);
    } else if (format === 'dat' || format === 'txt') {
      // Create fixed-width positional file
      const fixedWidthContent = convertToFixedWidth(transformedData, mappings);
      fs.writeFileSync(fullFilePath, fixedWidthContent, 'utf8');
    } else {
      // Create CSV file
      const csv = convertToCSV(transformedData);
      fs.writeFileSync(fullFilePath, csv, 'utf8');
    }

    res.json({
      success: true,
      message: 'File transformed and saved successfully',
      filePath: fullFilePath,
      recordCount: transformedData.length
    });
  } catch (error) {
    res.status(500).json({ error: `Error transforming and saving file: ${error.message}` });
  }
});

// Transformation endpoint with inputFile and profileFile (legacy, kept for compatibility)
app.post('/api/transform', upload.fields([
  { name: 'inputFile', maxCount: 1 },
  { name: 'profileFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const files = req.files;
    
    // Validate required files
    if (!files.inputFile || files.inputFile.length === 0) {
      return res.status(400).json({ error: 'inputFile is required' });
    }
    
    if (!files.profileFile || files.profileFile.length === 0) {
      return res.status(400).json({ error: 'profileFile is required' });
    }
    
    const inputFile = files.inputFile[0];
    const profileFile = files.profileFile[0];
    
    // Validate profile file extension
    if (!profileFile.originalname.endsWith('.prf')) {
      return res.status(400).json({ error: 'profileFile must be a .prf file' });
    }
    
    // Read and parse the profile file
    let profile;
    try {
      const profileContent = fs.readFileSync(profileFile.path, 'utf8');
      profile = JSON.parse(profileContent);
    } catch (error) {
      return res.status(400).json({ error: `Invalid profile file: ${error.message}` });
    }
    
    // Parse the input file
    let inputData;
    try {
      inputData = await parseFile(inputFile.path, inputFile.originalname);
    } catch (error) {
      return res.status(500).json({ error: `Error processing inputFile: ${error.message}` });
    }
    
    // Return the parsed data along with profile information
    res.json({
      success: true,
      message: 'Transformation ready',
      inputFile: {
        filename: inputFile.filename,
        originalname: inputFile.originalname,
        size: inputFile.size,
        mimetype: inputFile.mimetype
      },
      profile: {
        id: profile.id,
        name: profile.name,
        ...profile
      },
      inputData: inputData,
      // This is where transformation logic would be applied
      // For now, we just return the parsed input data
      transformedData: null // Placeholder for transformation result
    });
  } catch (error) {
    res.status(500).json({ error: `Error processing transformation: ${error.message}` });
  }
});

// Error handling middleware (must be after all routes)
app.use((error, req, res, next) => {
  console.error('[Error Handler] Error caught:', error.message, error.code);
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Maximum size is 5GB.' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Maximum is 4 files.' });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field name.' });
    }
    return res.status(400).json({ error: `Upload error: ${error.message}` });
  }
  if (error) {
    // Handle file filter errors
    if (error.message && error.message.includes('File type')) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
  next();
});

// ============================================
// BACKGROUND JOB PROCESSING
// ============================================

// Process a single job (extracted transformation logic)
const processJob = async (job) => {
  try {
    console.log('[JobProcessor] Starting job:', job.id);
    jobManager.updateJob(job.id, { status: jobManager.JOB_STATUS.RUNNING, progress: 0 });

    // Read input data from file path
    let inputData;
    if (job.inputFilePath && fs.existsSync(job.inputFilePath)) {
      // Parse the input file
      const fileExt = path.extname(job.inputFilePath).toLowerCase();
      inputData = await parseFile(job.inputFilePath, path.basename(job.inputFilePath));
    } else if (job.inputFile && Array.isArray(job.inputFile)) {
      // Input data was passed directly
      inputData = job.inputFile;
    } else {
      throw new Error('No input data available for job');
    }

    console.log('[JobProcessor] Loaded', inputData.length, 'input records');

    // Filter valid mappings
    const validMappings = (job.mappings || []).filter(m => m.outputField);
    if (validMappings.length === 0) {
      throw new Error('No valid mappings found');
    }

    // Check for complex transformations
    const mappingsWithComplexTransforms = validMappings.filter(m => {
      const transform = (m.transformations || m.transformation || '').toLowerCase();
      if (!transform) return false;
      const basicPatterns = ['uppercase', 'lowercase', 'trim', 'upper case', 'lower case'];
      return !basicPatterns.some(p => transform === p || transform === p.replace(' ', ''));
    });

    // Apply AI transformations if needed
    let aiTransformedData = null;
    if (mappingsWithComplexTransforms.length > 0) {
      console.log('[JobProcessor] Applying AI transformations...');
      try {
        aiTransformedData = await applyAITransformations(inputData, validMappings);
      } catch (aiError) {
        console.warn('[JobProcessor] AI transformation failed:', aiError.message);
      }
    }

    // Transform all data
    const transformedData = [];
    const allOutputFields = new Set();
    const mappingsByOutputField = new Map();
    validMappings.forEach(mapping => {
      if (mapping.outputField) {
        allOutputFields.add(mapping.outputField);
        mappingsByOutputField.set(mapping.outputField, mapping);
      }
    });

    const totalRecords = inputData.length;
    for (let i = 0; i < totalRecords; i++) {
      const inputRecord = inputData[i];
      const transformedRecord = {};

      // Update progress every 100 records
      if (i % 100 === 0) {
        const progress = Math.round((i / totalRecords) * 100);
        jobManager.updateJob(job.id, { progress });
      }

      const aiRecord = aiTransformedData && aiTransformedData[i] ? aiTransformedData[i] : null;

      allOutputFields.forEach(outputField => {
        const mapping = mappingsByOutputField.get(outputField);

        if (aiRecord && aiRecord[outputField] !== undefined && aiRecord[outputField] !== '') {
          transformedRecord[outputField] = aiRecord[outputField];
          return;
        }

        if (!mapping) {
          transformedRecord[outputField] = '';
          return;
        }

        const inputField = mapping.inputField;
        const transformation = mapping.transformations || mapping.transformation || '';

        // Priority 2: If no input field, use default value or empty
        if (!inputField || inputField === '') {
          if (mapping.defaultValue !== undefined && mapping.defaultValue !== '') {
            transformedRecord[outputField] = mapping.defaultValue;
          } else {
            // Even if no input field, we can still apply transformations (e.g., concatenate, static values)
            let value = '';
            if (transformation) {
              value = applyBasicTransformation(value, transformation, mapping, inputRecord);
            }
            transformedRecord[outputField] = value !== undefined && value !== null ? value : '';
          }
          return;
        }

        // Priority 3: Get input value and apply transformation
        let value = inputRecord && inputRecord[inputField] !== undefined 
          ? inputRecord[inputField] 
          : (mapping.defaultValue || '');

        // Apply transformation using the enhanced basic transformation function
        if (transformation) {
          value = applyBasicTransformation(value, transformation, mapping, inputRecord);
        } else if (value !== '' && value !== null && value !== undefined) {
          if (mapping.dataType === 'number') {
            const num = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
            value = isNaN(num) ? 0 : num;
          } else if (mapping.dataType === 'date') {
            const dateValue = new Date(value);
            value = isNaN(dateValue.getTime()) ? value : dateValue.toISOString().split('T')[0];
          } else {
            value = String(value);
          }
        }

        transformedRecord[outputField] = value !== undefined && value !== null ? value : '';
      });

      transformedData.push(transformedRecord);
    }

    console.log('[JobProcessor] Transformed', transformedData.length, 'records');

    // Ensure output directory exists
    if (!fs.existsSync(job.outputPath)) {
      fs.mkdirSync(job.outputPath, { recursive: true });
    }

    // Generate file path
    let fileExtension;
    switch (job.format) {
      case 'xlsx':
        fileExtension = '.xlsx';
        break;
      case 'dat':
        fileExtension = '.dat';
        break;
      case 'txt':
        fileExtension = '.txt';
        break;
      default:
        fileExtension = '.csv';
    }
    const fullFilePath = path.join(job.outputPath, `${job.fileName}${fileExtension}`);

    // Save file
    if (job.format === 'xlsx') {
      const worksheet = XLSX.utils.json_to_sheet(transformedData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      XLSX.writeFile(workbook, fullFilePath);
    } else if (job.format === 'dat' || job.format === 'txt') {
      const fixedWidthContent = convertToFixedWidth(transformedData, validMappings);
      fs.writeFileSync(fullFilePath, fixedWidthContent, 'utf8');
    } else {
      const csv = convertToCSV(transformedData);
      fs.writeFileSync(fullFilePath, csv, 'utf8');
    }

    // Update job as completed
    jobManager.updateJob(job.id, {
      status: jobManager.JOB_STATUS.COMPLETED,
      outputFilePath: fullFilePath,
      recordCount: transformedData.length,
      progress: 100
    });

    // Send OS notification
    jobManager.sendNotification(
      'SmartImport Job Completed',
      `Job ${job.id} finished successfully. ${transformedData.length} records processed. Output: ${path.basename(fullFilePath)}`,
      job.id
    );

    console.log('[JobProcessor] Job completed:', job.id);
  } catch (error) {
    console.error('[JobProcessor] Job failed:', job.id, error.message);
    jobManager.updateJob(job.id, {
      status: jobManager.JOB_STATUS.FAILED,
      error: error.message
    });

    // Send failure notification
    jobManager.sendNotification(
      'SmartImport Job Failed',
      `Job ${job.id} failed: ${error.message}`,
      job.id
    );
  }
};

// Background job runner - processes queued jobs
let isProcessingJobs = false;
const runJobProcessor = async () => {
  if (isProcessingJobs) {
    return; // Already processing
  }

  try {
    isProcessingJobs = true;
    
    // First, check for stuck jobs (RUNNING but haven't been updated in 10 minutes)
    // This handles cases where server restarted during job processing
    const allJobs = jobManager.getAllJobs();
    const stuckJobs = allJobs.filter(job => {
      if (job.status === jobManager.JOB_STATUS.RUNNING) {
        const startedAt = job.startedAt ? new Date(job.startedAt) : new Date(job.createdAt);
        const minutesSinceStart = (Date.now() - startedAt.getTime()) / 1000 / 60;
        // If job has been running for more than 10 minutes without progress update, consider it stuck
        return minutesSinceStart > 10;
      }
      return false;
    });
    
    if (stuckJobs.length > 0) {
      console.log('[JobProcessor] Found', stuckJobs.length, 'stuck job(s), resetting to queued...');
      stuckJobs.forEach(job => {
        try {
          jobManager.updateJob(job.id, { 
            status: jobManager.JOB_STATUS.QUEUED,
            startedAt: null,
            progress: 0
          });
          console.log('[JobProcessor] Reset stuck job to queued:', job.id);
        } catch (error) {
          console.error('[JobProcessor] Error resetting stuck job:', job.id, error.message);
        }
      });
    }
    
    const queuedJobs = jobManager.getQueuedJobs();

    if (queuedJobs.length === 0) {
      isProcessingJobs = false;
      return;
    }

    // Process jobs one at a time (FIFO)
    for (const job of queuedJobs) {
      await processJob(job);
    }
  } catch (error) {
    console.error('[JobProcessor] Error in job runner:', error.message);
  } finally {
    isProcessingJobs = false;
  }
};

// Start job processor - check for jobs every 5 seconds
setInterval(runJobProcessor, 5000);
// Also run immediately on startup to recover any stuck jobs
runJobProcessor();
console.log('[JobProcessor] Background job processor started (checks every 5 seconds)');

// ============================================
// JOB API ENDPOINTS
// ============================================

// Create a new transformation job (for large files)
app.post('/api/jobs/transform', async (req, res) => {
  try {
    const { inputData, inputFilePath, mappings, outputPath, fileName, format } = req.body;

    // Validate required fields
    if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({ error: 'mappings are required' });
    }

    if (!outputPath || !fileName) {
      return res.status(400).json({ error: 'outputPath and fileName are required' });
    }

    // Check if we have input data or file path
    if (!inputData && !inputFilePath) {
      return res.status(400).json({ error: 'Either inputData or inputFilePath is required' });
    }

    // Determine record count
    let recordCount = 0;
    if (inputData && Array.isArray(inputData)) {
      recordCount = inputData.length;
    } else if (inputFilePath && fs.existsSync(inputFilePath)) {
      // Quick count - read first few lines to estimate or parse full file
      try {
        const fileData = await parseFile(inputFilePath, path.basename(inputFilePath));
        recordCount = Array.isArray(fileData) ? fileData.length : 1;
      } catch (error) {
        console.warn('[Jobs] Could not determine record count:', error.message);
        recordCount = 0; // Will be determined during processing
      }
    }

    // Create job
    const job = jobManager.createJob({
      inputData: inputData || null,
      inputFilePath: inputFilePath || null,
      mappings,
      outputPath,
      fileName,
      format: format || 'csv'
    });

    // Trigger job processor immediately
    runJobProcessor();

    res.json({
      success: true,
      jobId: job.id,
      status: job.status,
      message: `Job created successfully. ${recordCount > 0 ? `Processing ${recordCount} records.` : 'Processing...'}`,
      recordCount
    });
  } catch (error) {
    res.status(500).json({ error: `Error creating job: ${error.message}` });
  }
});

// Get all jobs
app.get('/api/jobs', (req, res) => {
  try {
    const jobs = jobManager.getAllJobs();
    res.json({
      success: true,
      jobs: jobs
    });
  } catch (error) {
    res.status(500).json({ error: `Error fetching jobs: ${error.message}` });
  }
});

// Get job by ID
app.get('/api/jobs/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const job = jobManager.getJob(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      success: true,
      job: job
    });
  } catch (error) {
    res.status(500).json({ error: `Error fetching job: ${error.message}` });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`CORS enabled for: http://localhost:3000, http://127.0.0.1:3000`);
});

