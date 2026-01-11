# SmartImport - Data Transformation Application

A full-stack web application for data transformation with AI-assisted mapping. Built with React frontend and Node.js/Express backend.

## Features

- **File Upload & Processing**: Support for multiple file formats
  - CSV files
  - Excel files (.xlsx, .xls)
  - PDF documents
  - Word documents (.docx, .doc)
- **Data Conversion**: Convert processed data to CSV format
- **AI-Assisted Mapping**: Intelligent data transformation using OpenAI API
  - Automatic field mapping suggestions
  - Transformation rule generation
  - Validation rule suggestions
  - Preview of transformed data

## Tech Stack

### Frontend
- React (Create React App)
- Axios for API calls

### Backend
- Node.js
- Express.js
- Multer for file uploads
- PapaParse for CSV processing
- XLSX for Excel processing
- pdf-parse for PDF processing
- Mammoth for Word document processing
- @json2csv/plainjs for CSV output generation
- OpenAI API for AI-powered data transformation
- dotenv for environment variables
- CORS for cross-origin requests

## Project Structure

```
SmartImport/
├── frontend/          # React application
│   ├── src/
│   └── package.json
├── backend/           # Express server
│   ├── server.js
│   ├── uploads/       # Uploaded files directory
│   └── package.json
├── package.json       # Root package.json with scripts
└── README.md
```

## Installation

1. Install root dependencies:
```bash
npm install
```

2. Install frontend dependencies:
```bash
cd frontend
npm install
cd ..
```

3. Install backend dependencies:
```bash
cd backend
npm install
cd ..
```

Or use the convenience script:
```bash
npm run install-all
```

## Configuration

### Backend Environment Variables

Create a `.env` file in the `backend` directory with the following content:

**Option 1: Using Terminal/Command Line**

```bash
cd backend
cat > .env << EOF
PORT=5000
NODE_ENV=development
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini
EOF
```

**Option 2: Manual Creation**

1. Navigate to the `backend` directory
2. Create a new file named `.env` (note the leading dot)
3. Add the following content:

```
PORT=5000
NODE_ENV=development
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini
```

**Getting Your OpenAI API Key:**

1. Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Navigate to API Keys section
4. Click "Create new secret key"
5. Copy the key and replace `your_openai_api_key_here` in your `.env` file

**Environment Variables Explained:**

- `PORT`: Server port (default: 5000)
- `NODE_ENV`: Environment mode (development/production)
- `OPENAI_API_KEY`: **Required** for AI-powered data transformation features
- `OPENAI_MODEL`: Optional, defaults to `gpt-4o-mini` if not specified. Other options: `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`

**Important:** Never commit your `.env` file to version control. It's already included in `.gitignore`.

For the frontend, create a `.env` file in the `frontend` directory (optional):
```
REACT_APP_API_URL=http://localhost:5001
```

**Note:** Port 5000 is often used by macOS AirPlay service. The backend defaults to port 5001 to avoid conflicts.

## Running the Application

### Run both frontend and backend concurrently:
```bash
npm run dev
```

### Run separately:

**Backend only:**
```bash
npm run server
```

**Frontend only:**
```bash
npm run client
```

The frontend will run on `http://localhost:3000` and the backend on `http://localhost:5001`.

**Note:** The frontend is configured to proxy API requests to the backend on port 5001, so you can use relative URLs in the frontend code. Port 5000 is often used by macOS AirPlay service, so we use 5001 to avoid conflicts.

## API Endpoints

### Health Check
- `GET /api/health` - Check if server is running

### File Upload
- `POST /api/upload` - Upload and process a file
  - Body: FormData with `file` field
  - Returns: Processed file data

### Data Conversion
- `POST /api/convert-to-csv` - Convert JSON data to CSV
  - Body: `{ "data": [...] }`
  - Returns: CSV file download

### Multi-File Upload
- `POST /api/upload-files` - Upload multiple files for transformation setup
  - Body: FormData with fields: `inputFile`, `outputSampleFile`, `inputReference` (optional), `outputReference` (optional)
  - Returns: Parsed data for all uploaded files

### AI-Powered Mapping
- `POST /api/ai-map` - Generate AI-powered transformation mapping
  - Body: `{ "inputData": [...], "outputSample": [...], "inputReference": {...}, "outputReference": {...} }`
  - Returns: AI-generated mappings, rules, validations, and preview

- `POST /api/upload-and-map` - Upload files and generate AI mapping in one request
  - Body: FormData with fields: `inputFile`, `outputSampleFile`, `inputReference` (optional), `outputReference` (optional)
  - Returns: Parsed files and AI-generated transformation mapping

### Transformations
- `POST /api/transform` - Apply transformation using input file and profile
  - Body: FormData with fields: `inputFile`, `profileFile` (.prf)
  - Returns: Transformed data with profile information

### Profile Management
- `GET /api/profiles` - Get all transformation profiles
- `GET /api/profiles/:id` - Get a specific profile
- `POST /api/profiles` - Create a new profile
- `PUT /api/profiles/:id` - Update an existing profile
- `DELETE /api/profiles/:id` - Delete a profile

## Usage

1. Start the application using `npm run dev`
2. Open your browser to `http://localhost:3000`
3. **For New Transformation:**
   - Click "New Transformation"
   - Upload input file, output sample file, and optional reference files
   - Click "Import Files" to process and generate AI mappings
   - Review and edit mappings, then save profile or approve transformation
4. **For Existing Transformation:**
   - Click "Existing Transformation"
   - Upload input file and profile (.prf) file
   - Click "Process" to generate preview
   - Review preview and approve to save output file

## Testing with Sample Data

Sample data files are available in the `samples/` folder:
- `input_data.csv` - Sample input data
- `output_sample.csv` - Sample output format
- `input_reference.txt` - Input data documentation
- `output_reference.txt` - Output format documentation

See `samples/README.md` for detailed testing instructions.

## Debugging

The application includes comprehensive console logging for debugging:

**Backend Logs:**
- `[AI]` - AI service calls and responses
- `[Preview]` - Preview generation process
- `[Transform]` - Transformation processing

**Frontend Logs:**
- `[Frontend]` - File uploads, API calls, and mapping operations

Check browser console (F12) and terminal/console output for detailed debugging information.

## Development

The backend uses `nodemon` for automatic server restarts during development. The frontend uses React's hot-reload feature.

## License

ISC

