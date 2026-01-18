import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  validateFileFormat, 
  validateFileSize, 
  ALLOWED_INPUT_FORMATS, 
  ALLOWED_PROFILE_FORMATS 
} from '../utils/fileValidation';
import {
  Container,
  Typography,
  Box,
  Button,
  Paper,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  ListItemButton,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  ArrowBack,
  CloudUpload,
  Description,
  Transform as TransformIcon,
  CheckCircle as ApproveIcon,
  Folder as FolderIcon
} from '@mui/icons-material';

// Use relative URL when proxy is configured, otherwise use full URL
const API_URL = process.env.REACT_APP_API_URL || '';

const ExistingTransformation = () => {
  const navigate = useNavigate();
  const [inputFile, setInputFile] = useState(null);
  const [profileFile, setProfileFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [preview, setPreview] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [showOutputDialog, setShowOutputDialog] = useState(false);
  const [outputPath, setOutputPath] = useState('');
  const [outputFileName, setOutputFileName] = useState('transformed_output');
  const [outputFormat, setOutputFormat] = useState('csv');
  const [saving, setSaving] = useState(false);
  const [showFolderPickerDialog, setShowFolderPickerDialog] = useState(false);

  React.useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    setLoadingProfiles(true);
    try {
      const response = await axios.get(`${API_URL}/api/profiles`);
      setProfiles(response.data.profiles || []);
    } catch (err) {
      console.error('Error loading profiles:', err);
    } finally {
      setLoadingProfiles(false);
    }
  };

  const handleInputFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const formatValidation = validateFileFormat(file, ALLOWED_INPUT_FORMATS);
    if (!formatValidation.valid) {
      setError(formatValidation.error);
      e.target.value = '';
      return;
    }
    
    // Validate file size (5GB = 5120 MB)
    const sizeValidation = validateFileSize(file, 5120);
    if (!sizeValidation.valid) {
      setError(sizeValidation.error);
      e.target.value = '';
      return;
    }
    
    setInputFile(file);
    setError(null);
    setPreview(null);
  };

  const handleProfileFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const formatValidation = validateFileFormat(file, ALLOWED_PROFILE_FORMATS);
    if (!formatValidation.valid) {
      setError(formatValidation.error);
      e.target.value = '';
      return;
    }
    
    const sizeValidation = validateFileSize(file, 1);
    if (!sizeValidation.valid) {
      setError(sizeValidation.error);
      e.target.value = '';
      return;
    }
    
    setProfileFile(file);
    setError(null);
    setPreview(null);
  };

  const handleProcess = async () => {
    if (!inputFile) {
      setError('Please select an input file');
      return;
    }

    if (!profileFile) {
      setError('Please select a profile file');
      return;
    }

    setProcessing(true);
    setError(null);
    setSuccess(null);
    setPreview(null);

    const formData = new FormData();
    formData.append('inputFile', inputFile);
    formData.append('profileFile', profileFile);

    try {
      console.log('[Frontend] Processing transformation with profile...');
      console.log('[Frontend] Input file:', inputFile?.name);
      console.log('[Frontend] Profile file:', profileFile?.name);
      
      const response = await axios.post(`${API_URL}/api/transform-preview`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 300000, // 5 minutes timeout for AI processing
      });
      
      console.log('[Frontend] Transform preview response received');
      console.log('[Frontend] Preview records:', response.data.preview?.length || 0);
      console.log('[Frontend] Profile:', response.data.profile?.name || response.data.profile?.id);
      
      if (!response.data.preview || !Array.isArray(response.data.preview)) {
        throw new Error('Invalid preview data received from server');
      }
      
      setPreview(response.data.preview);
      setProfile(response.data.profile);
      setSuccess('Preview generated successfully! Review the data below before final processing.');
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        setError('Request timed out. The file may be too large. Please try again.');
      } else if (err.response) {
        const errorMsg = err.response.data?.error || err.response.data?.message || 'Error processing transformation';
        setError(`Processing failed: ${errorMsg}`);
      } else if (err.request) {
        setError('Network error: Unable to connect to the server. Please check your connection.');
      } else {
        setError(`Error: ${err.message || 'An unexpected error occurred while processing the transformation'}`);
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleFinalProcess = async () => {
    if (!outputPath.trim() || !outputFileName.trim()) {
      setError('Please provide both output path and file name');
      return;
    }

    if (!inputFile || !profileFile) {
      setError('Input file and profile file are required');
      return;
    }

    setSaving(true);
    setError(null);

    const formData = new FormData();
    formData.append('inputFile', inputFile);
    formData.append('profileFile', profileFile);
    formData.append('outputPath', outputPath.trim());
    formData.append('fileName', outputFileName.trim());
    formData.append('format', outputFormat);

    try {
      const response = await axios.post(`${API_URL}/api/transform-and-save-with-profile`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      setSuccess(`File transformed and saved successfully to ${response.data.filePath}`);
      setShowOutputDialog(false);
      setSaving(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Error saving transformed file');
      setSaving(false);
    }
  };

  const handleDownloadProfile = (profileId) => {
    // Create a download link for the profile
    const link = document.createElement('a');
    link.href = `${API_URL}/api/profiles/${profileId}`;
    link.download = `${profileId}.prf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const PreviewTable = ({ data }) => {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return <Typography variant="body2" color="text.secondary">No preview data available</Typography>;
    }

    const columns = Object.keys(data[0] || {});
    const previewData = data.slice(0, 100);

    return (
      <TableContainer sx={{ maxHeight: 600, mt: 2 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell key={col} sx={{ fontWeight: 'bold', backgroundColor: 'grey.200' }}>
                  {col}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {previewData.map((row, idx) => (
              <TableRow key={idx} hover>
                {columns.map((col) => (
                  <TableCell key={col}>
                    {typeof row[col] === 'object' 
                      ? JSON.stringify(row[col]) 
                      : String(row[col] || '').substring(0, 100)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  return (
    <Box sx={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', py: 4 }}>
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center' }}>
        <IconButton onClick={() => navigate('/')} sx={{ mr: 1, color: 'white' }}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h4" component="h1" sx={{ color: 'white' }}>
          Existing Transformation
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Upload Files
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Upload your input file and select a transformation profile (.prf file) to apply the transformation.
        </Typography>

        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <Description sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6">Input File <span style={{ color: 'red' }}>*</span></Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Your source data file (CSV, Excel, TXT, or delimited)
            </Typography>
            <input
              accept=".txt,.csv,.xlsx,.xls,.dat"
              style={{ display: 'none' }}
              id="input-file"
              type="file"
              onChange={handleInputFileChange}
            />
            <label htmlFor="input-file">
              <Button
                variant="outlined"
                component="span"
                startIcon={<CloudUpload />}
                fullWidth
              >
                {inputFile ? inputFile.name : 'Choose Input File'}
              </Button>
            </label>
          </CardContent>
        </Card>

        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <TransformIcon sx={{ mr: 1, color: 'secondary.main' }} />
              <Typography variant="h6">Profile File (.prf) <span style={{ color: 'red' }}>*</span></Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Select a saved transformation profile
            </Typography>
            <input
              accept=".prf"
              style={{ display: 'none' }}
              id="profile-file"
              type="file"
              onChange={handleProfileFileChange}
            />
            <label htmlFor="profile-file">
              <Button
                variant="outlined"
                component="span"
                startIcon={<CloudUpload />}
                fullWidth
                color="secondary"
              >
                {profileFile ? profileFile.name : 'Choose Profile File'}
              </Button>
            </label>
          </CardContent>
        </Card>

        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            size="large"
            onClick={handleProcess}
            disabled={processing || !inputFile || !profileFile}
            startIcon={processing ? <CircularProgress size={20} color="inherit" /> : <TransformIcon />}
          >
            {processing ? 'Processing...' : 'Process'}
          </Button>
        </Box>
      </Paper>

      {/* Preview Section */}
      {preview && profile && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Preview (First 100 Records)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Profile: <strong>{profile.name || profile.id}</strong> | Total records: {preview.length}
          </Typography>
          <PreviewTable data={preview} />
          
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              size="large"
              onClick={() => setShowOutputDialog(true)}
              startIcon={<ApproveIcon />}
            >
              Approve & Save Output
            </Button>
          </Box>
        </Paper>
      )}

      {/* Output Path Dialog */}
      {showOutputDialog && (
        <Paper sx={{ p: 3, mb: 3, backgroundColor: 'rgba(255, 255, 255, 0.95)' }}>
          <Typography variant="h6" gutterBottom>
            Save Transformed File
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Specify the output path and format for the transformed file.
          </Typography>

          <TextField
            fullWidth
            label="Output File Name"
            value={outputFileName}
            onChange={(e) => setOutputFileName(e.target.value)}
            sx={{ mb: 2 }}
            required
            helperText="File name without extension (e.g., transformed_output)"
          />

          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Output Format</InputLabel>
            <Select
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value)}
              label="Output Format"
            >
              <MenuItem value="csv">CSV</MenuItem>
              <MenuItem value="xlsx">XLSX</MenuItem>
            </Select>
          </FormControl>

            <Box sx={{ mb: 2 }}>
              <TextField
                fullWidth
                label="Output Path (Folder)"
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                required
                placeholder="e.g., /Users/username/Documents/output or C:\Users\username\Documents\output"
                helperText="Enter the folder path where the output file should be saved, or click Browse to select a folder"
                InputProps={{
                  endAdornment: (
                    <IconButton
                      onClick={() => setShowFolderPickerDialog(true)}
                      edge="end"
                      sx={{ mr: -1 }}
                      title="Browse for folder"
                    >
                      <FolderIcon />
                    </IconButton>
                  )
                }}
              />
            </Box>

          {/* Folder Picker Dialog */}
          <Dialog 
            open={showFolderPickerDialog} 
            onClose={() => setShowFolderPickerDialog(false)}
            maxWidth="sm"
            fullWidth
          >
            <DialogTitle>Select Output Folder</DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Choose a common folder or enter a custom path below.
              </Typography>
              
              <List>
                {[
                  { name: 'Desktop', path: '~/Desktop', description: 'Your Desktop folder' },
                  { name: 'Documents', path: '~/Documents', description: 'Your Documents folder' },
                  { name: 'Downloads', path: '~/Downloads', description: 'Your Downloads folder' },
                  { name: 'Custom Path...', path: null, description: 'Enter or browse for a custom folder' }
                ].map((folder) => (
                  <ListItem key={folder.name} disablePadding>
                    <ListItemButton
                      onClick={async () => {
                        if (folder.path === null) {
                          // Custom path - try to use directory picker or prompt
                          setShowFolderPickerDialog(false);
                          try {
                            if ('showDirectoryPicker' in window) {
                              try {
                                const directoryHandle = await window.showDirectoryPicker();
                                const dirName = directoryHandle.name;
                                // Prompt user for full path since browser can't provide it
                                const customPath = prompt(
                                  `Selected folder: "${dirName}"\n\nNote: Browser security prevents direct access to full paths.\n\nPlease enter the full path to this folder (e.g., /Users/yourusername/${dirName}):`,
                                  outputPath || `/Users/yourusername/${dirName}`
                                );
                                if (customPath) {
                                  setOutputPath(customPath);
                                }
                              } catch (err) {
                                if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
                                  console.error('Directory picker error:', err);
                                  // Show user-friendly error message
                                  const errorMsg = err.message || 'Unknown error';
                                  const customPath = prompt(
                                    `Unable to access folder picker: ${errorMsg}\n\nPlease enter the full folder path manually:`,
                                    outputPath || ''
                                  );
                                  if (customPath) {
                                    setOutputPath(customPath);
                                  }
                                } else if (err.name === 'NotAllowedError') {
                                  // User denied permission or folder contains system files
                                  const customPath = prompt(
                                    `Cannot access this folder (may contain system files or permission denied).\n\nPlease enter the full folder path manually:`,
                                    outputPath || ''
                                  );
                                  if (customPath) {
                                    setOutputPath(customPath);
                                  }
                                }
                              }
                            } else {
                              // Fallback: prompt for path
                              const customPath = prompt(
                                'Please enter the full folder path:',
                                outputPath || ''
                              );
                              if (customPath) {
                                setOutputPath(customPath);
                              }
                            }
                          } catch (err) {
                            console.error('Error in folder selection:', err);
                            const customPath = prompt(
                              'Please enter the full folder path:',
                              outputPath || ''
                            );
                            if (customPath) {
                              setOutputPath(customPath);
                            }
                          }
                        } else {
                          // Use common path - replace ~ with /Users/username if needed
                          // For now, keep ~ and let user know they need to replace it
                          if (folder.path.startsWith('~')) {
                            const username = prompt(
                              `Selected: ${folder.name}\n\nPlease enter your macOS username to complete the path, or enter the full path:`,
                              outputPath || folder.path.replace('~', '/Users/yourusername')
                            );
                            if (username) {
                              // If user entered full path, use it; otherwise construct from username
                              if (username.startsWith('/')) {
                                setOutputPath(username);
                              } else {
                                setOutputPath(folder.path.replace('~', `/Users/${username}`));
                              }
                            }
                          } else {
                            setOutputPath(folder.path);
                          }
                          setShowFolderPickerDialog(false);
                        }
                      }}
                    >
                      <ListItemText 
                        primary={folder.name}
                        secondary={folder.description || folder.path}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
              
              <Box sx={{ mt: 2 }}>
                <TextField
                  fullWidth
                  label="Or Enter Custom Path"
                  value={outputPath}
                  onChange={(e) => setOutputPath(e.target.value)}
                  placeholder="/Users/username/Documents/output"
                  helperText="Enter the full path to your desired output folder"
                  size="small"
                />
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setShowFolderPickerDialog(false)}>Cancel</Button>
              <Button 
                onClick={() => {
                  if (outputPath.trim()) {
                    setShowFolderPickerDialog(false);
                  } else {
                    setError('Please select a folder or enter a path');
                  }
                }}
                variant="contained"
                disabled={!outputPath.trim()}
              >
                Use This Path
              </Button>
            </DialogActions>
          </Dialog>

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3 }}>
            <Button
              variant="outlined"
              onClick={() => {
                setShowOutputDialog(false);
                setOutputPath('');
                setOutputFileName('transformed_output');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={handleFinalProcess}
              disabled={saving || !outputPath.trim() || !outputFileName.trim()}
              startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <ApproveIcon />}
            >
              {saving ? 'Saving...' : 'Save Output File'}
            </Button>
          </Box>
        </Paper>
      )}

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Saved Profiles
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Available transformation profiles. Click to download.
        </Typography>
        
        {loadingProfiles ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        ) : profiles.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            No saved profiles found. Create a new transformation to save a profile.
          </Typography>
        ) : (
          <List>
            {profiles.map((profile) => (
              <ListItem key={profile.id} button onClick={() => handleDownloadProfile(profile.id)}>
                <ListItemText
                  primary={profile.name || profile.id}
                  secondary={`Created: ${new Date(profile.createdAt).toLocaleDateString()}`}
                />
                <ListItemSecondaryAction>
                  <Button
                    size="small"
                    onClick={() => handleDownloadProfile(profile.id)}
                  >
                    Download
                  </Button>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
      </Container>
    </Box>
  );
};

export default ExistingTransformation;
