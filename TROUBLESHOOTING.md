# Troubleshooting Guide

## 403 Forbidden Error on File Upload

If you're getting a 403 Forbidden error when uploading files, try the following:

### 1. Restart the Frontend Server
The proxy configuration requires a server restart:
```bash
# Stop the current server (Ctrl+C)
# Then restart
cd frontend
npm start
```

### 2. Check Backend Server is Running
Ensure the backend is running on port 5000:
```bash
cd backend
npm run dev
```

### 3. Verify File Formats
Make sure you're uploading files with allowed extensions:
- Input/Output files: `.txt`, `.csv`, `.xlsx`, `.xls`
- Reference files: `.pdf`, `.docx`, `.doc`, `.xlsx`, `.xls`, `.txt`
- Profile files: `.prf`

### 4. Check File Sizes
Files must be under 10MB. Check the browser console for specific error messages.

### 5. Check Browser Console
Open browser DevTools (F12) and check:
- Console tab for error messages
- Network tab to see the actual request/response
- Look for CORS errors or file validation errors

### 6. Verify Proxy Configuration
Check that `frontend/package.json` contains:
```json
"proxy": "http://localhost:5000"
```

### 7. Check Backend Logs
Look at the terminal where the backend is running for:
- `[API]` logs showing request details
- `[Multer]` logs showing file filter checks
- Error messages

### 8. Test Direct API Call
You can test the backend directly:
```bash
curl -X POST http://localhost:5000/api/health
```

Should return: `{"status":"OK","message":"Server is running"}`

## Common Issues

### Issue: "Unable to connect to the server"
**Solution:** 
- Ensure backend is running on port 5000
- Check firewall settings
- Verify no other application is using port 5000

### Issue: "File type .xxx is not allowed"
**Solution:**
- Check the file extension matches allowed formats
- Ensure the file isn't corrupted
- Try renaming the file with the correct extension

### Issue: "File size too large"
**Solution:**
- Reduce file size to under 10MB
- Split large files into smaller chunks
- Compress files if possible

### Issue: CORS errors
**Solution:**
- Restart both frontend and backend servers
- Clear browser cache
- Check that CORS is properly configured in backend

## Debug Mode

Enable detailed logging by checking:
- Browser console (F12) for `[Frontend]` logs
- Backend terminal for `[API]`, `[Multer]`, `[AI]`, `[Preview]` logs

## Still Having Issues?

1. Check all console logs (browser and backend)
2. Verify all dependencies are installed: `npm install` in both frontend and backend
3. Ensure `.env` file exists in backend with proper configuration
4. Try using the sample files from the `samples/` folder

