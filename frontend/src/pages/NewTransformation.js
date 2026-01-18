import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  validateFileFormat, 
  validateFileSize, 
  ALLOWED_INPUT_FORMATS, 
  ALLOWED_REFERENCE_FORMATS 
} from '../utils/fileValidation';
import {
  Container,
  Typography,
  Box,
  Button,
  Paper,
  TextField,
  Alert,
  CircularProgress,
  Stepper,
  Step,
  StepLabel,
  Card,
  CardContent,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Grid,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemButton,
  ListItemText
} from '@mui/material';
import {
  ArrowBack,
  CloudUpload,
  CheckCircle,
  Description,
  Refresh as RefreshIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  CheckCircle as ApproveIcon,
  Folder as FolderIcon,
  Edit as EditIcon,
  Close as CloseIcon
} from '@mui/icons-material';

// Use relative URL when proxy is configured, otherwise use full URL
const API_URL = process.env.REACT_APP_API_URL || '';

const steps = ['Upload Files', 'AI Analysis', 'Review & Save'];

const NewTransformation = () => {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  const [files, setFiles] = useState({
    inputFile: null,
    outputSampleFile: null,
    inputReference: null,
    outputReference: null
  });

  const [uploadResult, setUploadResult] = useState(null);
  const [aiMapping, setAiMapping] = useState(null);
  const [editableMappings, setEditableMappings] = useState([]);
  const [previousMappings, setPreviousMappings] = useState([]); // Track previous state for comparison
  const [hasChanges, setHasChanges] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [outputFormat, setOutputFormat] = useState('csv');
  const [outputFileName, setOutputFileName] = useState('transformed_output');
  const [approving, setApproving] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showFolderPickerDialog, setShowFolderPickerDialog] = useState(false);
  
  // Transformation popup state
  const [transformationPopup, setTransformationPopup] = useState({
    open: false,
    rowIndex: null,
    value: ''
  });
  
  // Separate message states for different sections
  const [profileMessage, setProfileMessage] = useState({ type: null, text: null });
  const [transformMessage, setTransformMessage] = useState({ type: null, text: null });
  
  // Position-based file tracking
  const [isPositionBased, setIsPositionBased] = useState(false);
  const [outputLayoutInfo, setOutputLayoutInfo] = useState({});
  
  // Job management
  const [jobs, setJobs] = useState([]);
  const [showJobHistory, setShowJobHistory] = useState(false);
  const [refreshingJobs, setRefreshingJobs] = useState(false);
  
  // Validation error dialog state
  const [validationErrorDialog, setValidationErrorDialog] = useState({
    open: false,
    title: '',
    message: ''
  });
  
  const dataTypes = ['string', 'number', 'date', 'boolean', 'email', 'phone'];
  const outputFormats = ['csv', 'xlsx', 'txt', 'dat'];

  const handleFileChange = (fieldName) => (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate file format
    const allowedFormats = fieldName.includes('Reference') 
      ? ALLOWED_REFERENCE_FORMATS 
      : ALLOWED_INPUT_FORMATS;
    
    const formatValidation = validateFileFormat(file, allowedFormats);
    if (!formatValidation.valid) {
      setError(formatValidation.error);
      e.target.value = ''; // Clear the input
      return;
    }
    
    // Validate file size (5GB = 5120 MB)
    const sizeValidation = validateFileSize(file, 5120);
    if (!sizeValidation.valid) {
      setError(sizeValidation.error);
      e.target.value = ''; // Clear the input
      return;
    }
    
    setFiles(prev => ({ ...prev, [fieldName]: file }));
    setError(null);
  };

  const handleImportFiles = async () => {
    if (!files.inputFile || !files.outputSampleFile) {
      setError('Input file and output sample file are required');
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.append('inputFile', files.inputFile);
    formData.append('outputSampleFile', files.outputSampleFile);
    if (files.inputReference) formData.append('inputReference', files.inputReference);
    if (files.outputReference) formData.append('outputReference', files.outputReference);

    try {
      console.log('[Frontend] Starting file upload and AI mapping...');
      console.log('[Frontend] API_URL:', API_URL || '(using proxy)');
      console.log('[Frontend] Full URL:', `${API_URL || ''}/api/upload-and-map`);
      console.log('[Frontend] Files:', {
        inputFile: files.inputFile?.name,
        outputSampleFile: files.outputSampleFile?.name,
        inputReference: files.inputReference?.name,
        outputReference: files.outputReference?.name
      });
      
      const uploadUrl = API_URL ? `${API_URL}/api/upload-and-map` : '/api/upload-and-map';
      console.log('[Frontend] Uploading to:', uploadUrl);
      
      const response = await axios.post(uploadUrl, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 1800000, // 30 minutes timeout for large file uploads (up to 5GB)
        withCredentials: false, // Don't send credentials with file uploads
      });
      
      console.log('[Frontend] Upload and mapping response received');
      console.log('[Frontend] Response data:', {
        hasFiles: !!response.data.files,
        hasMapping: !!response.data.mapping,
        mappingKeys: response.data.mapping ? Object.keys(response.data.mapping) : []
      });
      
      setUploadResult(response.data.files);
      const mapping = response.data.mapping;
      console.log('[Frontend] AI Mapping:', {
        mappingsCount: mapping.mappings?.length || 0,
        rulesCount: mapping.rules?.length || 0,
        validationsCount: mapping.validations?.length || 0,
        previewCount: mapping.preview?.length || 0,
        summary: mapping.summary,
        isPositionBased: mapping.isPositionBased,
        hasLayoutInfo: !!mapping.outputLayoutInfo,
        layoutInfoFields: mapping.outputLayoutInfo ? Object.keys(mapping.outputLayoutInfo).length : 0
      });
      
      // Debug: Log layout info details
      if (mapping.outputLayoutInfo && Object.keys(mapping.outputLayoutInfo).length > 0) {
        console.log('[Frontend] Position Layout Info detected!');
        console.log('[Frontend] Layout fields:', Object.keys(mapping.outputLayoutInfo));
        const sampleKey = Object.keys(mapping.outputLayoutInfo)[0];
        console.log('[Frontend] Sample layout:', sampleKey, mapping.outputLayoutInfo[sampleKey]);
      }
      
      setAiMapping(mapping);
      
      // Set position-based mode if detected from backend
      const hasPositionLayout = mapping.outputLayoutInfo && Object.keys(mapping.outputLayoutInfo).length > 0;
      if (mapping.isPositionBased || hasPositionLayout) {
        console.log('[Frontend] Setting position-based mode = true');
        setIsPositionBased(true);
        setOutputFormat('dat'); // Default to .dat for position-based output
      }
      if (mapping.outputLayoutInfo) {
        setOutputLayoutInfo(mapping.outputLayoutInfo);
      }
      
      // Initialize editable mappings from AI response
      if (mapping.mappings && Array.isArray(mapping.mappings)) {
        const editableMaps = mapping.mappings.map(m => ({
          inputField: m.inputField || '',
          outputField: m.outputField || '',
          rules: m.validation || '',
          transformations: m.transformation || '',
          required: m.required || false,
          dataType: m.dataType || 'string',
          // Position fields for fixed-width files
          startPos: m.startPos || null,
          endPos: m.endPos || null,
          length: m.length || null
        }));
        
        // Ensure ALL fields from preview are included in editableMappings
        // This fixes the issue where AI might miss some output fields
        if (mapping.preview && mapping.preview.length > 0) {
          const previewFields = Object.keys(mapping.preview[0]);
          const mappedOutputFields = new Set(editableMaps.map(m => m.outputField));
          
          previewFields.forEach(field => {
            if (!mappedOutputFields.has(field)) {
              console.log('[Frontend] Adding missing field from preview:', field);
              // Get position info from layoutInfo if available
              const layoutInfo = mapping.outputLayoutInfo?.[field];
              editableMaps.push({
                inputField: '',
                outputField: field,
                rules: '',
                transformations: '',
                required: false,
                dataType: 'string',
                startPos: layoutInfo?.startPos || null,
                endPos: layoutInfo?.endPos || null,
                length: layoutInfo?.length || null
              });
            }
          });
          
          // Sort by startPos if position-based to maintain correct order
          if (mapping.isPositionBased) {
            editableMaps.sort((a, b) => {
              if (a.startPos && b.startPos) return a.startPos - b.startPos;
              if (a.startPos) return -1;
              if (b.startPos) return 1;
              return 0;
            });
          }
        }
        
        console.log('[Frontend] Initialized', editableMaps.length, 'editable mappings');
        console.log('[Frontend] Sample mapping:', editableMaps[0]);
        if (mapping.isPositionBased) {
          console.log('[Frontend] Position-based output detected - mappings include position info');
        }
        setEditableMappings(editableMaps);
        // Store as previous state for change detection
        setPreviousMappings(JSON.parse(JSON.stringify(editableMaps)));
      }
      setHasChanges(false);
      
      setActiveStep(1);
      setSuccess('Files uploaded and analyzed successfully!');
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        setError('Request timed out. The file may be too large or the AI service is taking longer than expected. Please try again.');
      } else if (err.response) {
        const errorMsg = err.response.data?.error || err.response.data?.message || 'Error uploading files';
        setError(`Upload failed: ${errorMsg}`);
      } else if (err.request) {
        setError('Network error: Unable to connect to the server. Please check your connection and try again.');
      } else {
        setError(`Error: ${err.message || 'An unexpected error occurred'}`);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleMappingEdit = (index, field, value) => {
    console.log('[Frontend] Mapping edit:', { index, field, value });
    const updated = [...editableMappings];
    
    // Handle dataType - default to 'string' if empty, but show warning
    if (field === 'dataType') {
      if (!value || value.trim() === '') {
        // Auto-default to 'string' but show warning
        const outputField = updated[index]?.outputField || `Row ${index + 1}`;
        setValidationErrorDialog({
          open: true,
          title: 'Type Field is Required',
          message: `The "Type" field is mandatory and cannot be left blank.\n\nIt has been automatically set to "string" for ${outputField ? `"${outputField}"` : `row ${index + 1}`}.\n\nPlease select the appropriate data type if "string" is not correct.`
        });
        value = 'string'; // Default to string
      }
    }
    
    updated[index] = { ...updated[index], [field]: value };
    
    // Auto-calculate position fields for position-based files
    if (isPositionBased && (field === 'startPos' || field === 'endPos' || field === 'length')) {
      const mapping = updated[index];
      const startPos = mapping.startPos;
      const endPos = mapping.endPos;
      const length = mapping.length;
      
      // Calculate missing field based on the other two
      if (field === 'startPos' && startPos && length && !endPos) {
        updated[index].endPos = startPos + length - 1;
      } else if (field === 'endPos' && endPos && length && !startPos) {
        updated[index].startPos = endPos - length + 1;
      } else if (field === 'length' && startPos && length && !endPos) {
        updated[index].endPos = startPos + length - 1;
      } else if (field === 'startPos' && startPos && endPos) {
        updated[index].length = endPos - startPos + 1;
      } else if (field === 'endPos' && startPos && endPos) {
        updated[index].length = endPos - startPos + 1;
      } else if (field === 'length' && startPos && length) {
        updated[index].endPos = startPos + length - 1;
      }
    }
    
    setEditableMappings(updated);
    setHasChanges(true);
  };

  // Fetch jobs from backend
  const fetchJobs = async () => {
    try {
      setRefreshingJobs(true);
      const response = await axios.get(`${API_URL}/api/jobs`);
      if (response.data.success && response.data.jobs) {
        setJobs(response.data.jobs);
      }
    } catch (error) {
      console.error('[Frontend] Error fetching jobs:', error);
    } finally {
      setRefreshingJobs(false);
    }
  };

  // Format job status for display
  const getJobStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'running':
        return 'info';
      case 'failed':
        return 'error';
      case 'queued':
        return 'warning';
      default:
        return 'default';
    }
  };

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Auto-refresh jobs when job history dialog is open
  useEffect(() => {
    if (!showJobHistory) return;

    // Fetch immediately
    fetchJobs();

    // Set up polling every 5 seconds for running/queued jobs
    const interval = setInterval(() => {
      fetchJobs();
    }, 5000);

    return () => clearInterval(interval);
  }, [showJobHistory]);

  const handleAddMapping = () => {
    // Calculate next position for position-based files
    let nextStartPos = 1;
    if (isPositionBased && editableMappings.length > 0) {
      const lastMapping = editableMappings[editableMappings.length - 1];
      if (lastMapping.endPos) {
        nextStartPos = lastMapping.endPos + 1;
      }
    }
    
    setEditableMappings([...editableMappings, {
      inputField: '',
      outputField: '',
      rules: '',
      transformations: '',
      required: false,
      dataType: 'string',
      // Position fields for fixed-width files
      startPos: isPositionBased ? nextStartPos : null,
      endPos: null,
      length: null
    }]);
    setHasChanges(true);
  };

  const handleDeleteMapping = (index) => {
    const updated = editableMappings.filter((_, i) => i !== index);
    setEditableMappings(updated);
    setHasChanges(true);
  };

  // Transformation popup handlers
  const handleOpenTransformationPopup = (index) => {
    setTransformationPopup({
      open: true,
      rowIndex: index,
      value: editableMappings[index]?.transformations || ''
    });
  };

  const handleCloseTransformationPopup = () => {
    // Save the value when closing
    if (transformationPopup.rowIndex !== null) {
      handleMappingEdit(transformationPopup.rowIndex, 'transformations', transformationPopup.value);
    }
    setTransformationPopup({
      open: false,
      rowIndex: null,
      value: ''
    });
  };

  const handleTransformationPopupChange = (newValue) => {
    setTransformationPopup(prev => ({
      ...prev,
      value: newValue
    }));
  };

  const handleRefreshMappings = async () => {
    if (!uploadResult) {
      setError('No file data available. Please upload files first.');
      return;
    }
    
    // Validate that all mappings have required fields before refresh
    // Auto-default dataType to 'string' if missing, but show warning
    let hasMissingTypes = false;
    const mappingsWithMissingType = [];
    
    editableMappings.forEach((m, idx) => {
      if (m.outputField && m.outputField.trim() !== '' && (!m.dataType || m.dataType.trim() === '')) {
        hasMissingTypes = true;
        mappingsWithMissingType.push({ index: idx, outputField: m.outputField });
        // Auto-default to 'string'
        m.dataType = 'string';
      }
    });
    
    // Update editableMappings if we auto-defaulted any types
    if (hasMissingTypes) {
      setEditableMappings([...editableMappings]);
      const missingTypeRows = mappingsWithMissingType.map(m => m.index + 1);
      const missingTypeFields = mappingsWithMissingType.map(m => m.outputField).join(', ');
      
      setValidationErrorDialog({
        open: true,
        title: 'Type Field Auto-Defaulted',
        message: `The "Type" field is mandatory. The following field(s) had missing Type values and have been automatically set to "string":\n\n${missingTypeFields}\n\nRow${missingTypeRows.length > 1 ? 's' : ''}: ${missingTypeRows.join(', ')}\n\nPlease review and update the Type field if "string" is not appropriate.`
      });
      // Continue with refresh after showing warning
    }
    
    // Check for missing output fields (still required)
    const invalidMappings = editableMappings.filter(m => {
      // Check if outputField exists (required)
      if (!m.outputField || m.outputField.trim() === '') {
        return true;
      }
      return false;
    });
    
    if (invalidMappings.length > 0) {
      const missingOutputFields = invalidMappings.filter(m => !m.outputField || m.outputField.trim() === '').length;
      const rowsWithMissingOutput = invalidMappings
        .map((m, idx) => !m.outputField || m.outputField.trim() === '' ? idx + 1 : null)
        .filter(idx => idx !== null);
      
      let errorMsg = 'Please fill in all required fields before refreshing:\n\n';
      errorMsg += `• ${missingOutputFields} row(s) missing Output Field`;
      if (rowsWithMissingOutput.length > 0 && rowsWithMissingOutput.length <= 10) {
        errorMsg += ` (Row${rowsWithMissingOutput.length > 1 ? 's' : ''}: ${rowsWithMissingOutput.join(', ')})`;
      }
      errorMsg += '\n\nPlease fill in the Output Field in the Field Mapping table and try again.';
      
      // Show validation error in popup dialog
      setValidationErrorDialog({
        open: true,
        title: 'Validation Error',
        message: errorMsg
      });
      return;
    }

    // Filter out empty mappings - output field is required, input field is optional
    // This allows mappings with blank input fields (output-only columns with default values)
    // IMPORTANT: Include ALL mappings with outputField, even if inputField is empty
    const validMappings = editableMappings.filter(m => m.outputField && m.outputField.trim() !== '');
    
    if (validMappings.length === 0) {
      setError('Please add at least one valid mapping (output field is required).');
      return;
    }

    setRefreshing(true);
    // Clear all previous messages
    setError(null);
    setSuccess(null);
    setProfileMessage({ type: null, text: null });
    setTransformMessage({ type: null, text: null });

    try {
      // Identify which mappings have changed by comparing with previous state
      // Note: input field can be blank, so we use output field as primary key
      const previousValidMappings = previousMappings.filter(m => m.outputField);
      const changedMappings = [];
      const changedMappingKeys = new Set();
      
      validMappings.forEach(currentMapping => {
        // Use output field as primary key, input field is optional
        const key = `${currentMapping.inputField || ''}_${currentMapping.outputField}`;
        const previousMapping = previousValidMappings.find(p => 
          `${p.inputField || ''}_${p.outputField}` === key
        );
        
        // Check if mapping has changed
        if (!previousMapping) {
          // New mapping - always include it
          changedMappings.push(currentMapping);
          changedMappingKeys.add(key);
          console.log('[Frontend] New mapping detected:', key);
        } else {
          // Normalize required values for comparison (handle boolean/string/undefined differences)
          const currentRequired = currentMapping.required === true || currentMapping.required === 'true';
          const previousRequired = previousMapping.required === true || previousMapping.required === 'true';
          const requiredChanged = currentRequired !== previousRequired;
          
          // Compare fields to detect changes
          const hasChanged = 
            currentMapping.transformations !== previousMapping.transformations ||
            currentMapping.rules !== previousMapping.rules ||
            requiredChanged ||
            currentMapping.dataType !== previousMapping.dataType ||
            currentMapping.defaultValue !== previousMapping.defaultValue ||
            (currentMapping.inputField || '') !== (previousMapping.inputField || '') ||
            currentMapping.outputField !== previousMapping.outputField;
          
          if (hasChanged) {
            changedMappings.push(currentMapping);
            changedMappingKeys.add(key);
            console.log('[Frontend] Modified mapping detected:', key, {
              transformations: currentMapping.transformations !== previousMapping.transformations,
              rules: currentMapping.rules !== previousMapping.rules,
              required: requiredChanged,
              dataType: currentMapping.dataType !== previousMapping.dataType,
              currentRequiredValue: currentMapping.required,
              previousRequiredValue: previousMapping.required
            });
          }
        }
      });
      
      console.log('[Frontend] Changed mappings detected:', changedMappings.length, 'out of', validMappings.length);
      console.log('[Frontend] Changed mapping keys:', Array.from(changedMappingKeys));
      
      // Log the required field values for debugging
      if (changedMappings.length > 0) {
        changedMappings.forEach(m => {
          console.log('[Frontend] Changed mapping:', m.outputField, 'required:', m.required, 'type:', typeof m.required);
        });
      }
      
      // Prepare the updated mappings data with change tracking
      // For large files, use file path instead of data to ensure we have all records for preview
      const isLargeFile = uploadResult.inputFile?.isLargeFile || false;
      const inputFilePath = uploadResult.inputFile?.path;
      
      const mappingData = {
        // For large files, send file path; for small files, send data
        ...(isLargeFile && inputFilePath ? { inputFilePath: inputFilePath } : { inputData: uploadResult.inputFile?.data || [] }),
        outputSample: uploadResult.outputSampleFile?.data || [],
        inputReference: uploadResult.inputReference?.data || null,
        outputReference: uploadResult.outputReference?.data || null,
        customMappings: validMappings,
        changedMappings: changedMappings, // Only modified mappings
        changedMappingKeys: Array.from(changedMappingKeys), // Keys of modified mappings
        previousPreview: aiMapping?.preview || null, // Send previous preview for merging
        previousValidations: aiMapping?.validations || null, // Send previous validations for merging
        previousRules: aiMapping?.rules || null // Send previous rules for merging
      };
      
      if (isLargeFile && inputFilePath) {
        console.log('[Frontend] Large file detected, using file path for refresh:', inputFilePath);
      }

      console.log('[Frontend] Refreshing mappings with custom data...');
      console.log('[Frontend] Custom mappings count:', validMappings.length);
      console.log('[Frontend] Sample mapping being sent:', JSON.stringify(validMappings[0], null, 2));
      console.log('[Frontend] Current editableMappings before refresh:', editableMappings.length);
      console.log('[Frontend] Sample current editableMapping:', JSON.stringify(editableMappings.find(m => m.inputField === validMappings[0]?.inputField), null, 2));
      
      // Send to AI endpoint to regenerate preview
      const response = await axios.post(`${API_URL}/api/ai-map`, mappingData, {
        timeout: 300000, // 5 minutes timeout for AI processing with complex transformations
      });
      
      console.log('[Frontend] Refresh response received');
      const updatedMapping = response.data.mapping;
      console.log('[Frontend] Updated preview count:', updatedMapping.preview?.length || 0);
      console.log('[Frontend] Updated mappings from response:', updatedMapping.mappings?.length || 0);
      
      // Preserve incomplete/new rows (those without output field - input field is optional)
      const incompleteMappings = editableMappings.filter(m => !m.outputField);
      console.log('[Frontend] Preserving', incompleteMappings.length, 'incomplete/new rows (no output field)');
      
      // Update editableMappings with the response mappings to ensure UI reflects changes
      // The backend returns merged mappings with transformations applied
      if (updatedMapping.mappings && Array.isArray(updatedMapping.mappings)) {
        // Convert backend response mappings to frontend format (including position fields)
        const responseMappings = updatedMapping.mappings.map(m => ({
          inputField: m.inputField || '',
          outputField: m.outputField || '',
          rules: m.validation || m.rules || '',
          transformations: m.transformation || m.transformations || '',
          required: m.required !== undefined ? m.required : false,
          dataType: m.dataType || 'string',
          defaultValue: m.defaultValue,
          // Include position fields from response
          startPos: m.startPos || null,
          endPos: m.endPos || null,
          length: m.length || null
        }));
        
        // Create a map of response mappings by inputField+outputField for quick lookup
        // Input field can be blank, so use empty string as fallback
        const responseMappingsMap = new Map();
        responseMappings.forEach(m => {
          const key = `${m.inputField || ''}_${m.outputField}`;
          // If duplicate key exists, keep the first one (shouldn't happen, but safety)
          if (!responseMappingsMap.has(key)) {
            responseMappingsMap.set(key, m);
          }
        });
        
        // Create a map of existing valid mappings to preserve order (output field is required, input is optional)
        const existingValidMappings = editableMappings.filter(m => m.outputField);
        const existingMappingsMap = new Map();
        existingValidMappings.forEach(m => {
          const key = `${m.inputField || ''}_${m.outputField}`;
          existingMappingsMap.set(key, m);
        });
        
        // Build final mappings list: update existing ones, add new ones, preserve order
        const finalMappings = [];
        const processedKeys = new Set();
        
        // First, process existing mappings in their original order (update them)
        existingValidMappings.forEach(existingMapping => {
          const key = `${existingMapping.inputField || ''}_${existingMapping.outputField}`;
          const responseMapping = responseMappingsMap.get(key);
          
          if (responseMapping) {
            // Update existing mapping with response data (this includes transformations)
            // IMPORTANT: Preserve position fields from existing mapping if response doesn't have them
            finalMappings.push({
              ...responseMapping,
              // Preserve user's current edits if they're more recent (but transformations should come from backend)
              transformations: responseMapping.transformations || existingMapping.transformations,
              rules: responseMapping.rules || existingMapping.rules,
              // Preserve position fields - use existing values if response doesn't have them
              startPos: responseMapping.startPos || existingMapping.startPos || null,
              endPos: responseMapping.endPos || existingMapping.endPos || null,
              length: responseMapping.length || existingMapping.length || null
            });
            processedKeys.add(key);
          } else {
            // Mapping exists in frontend but not in response - keep it with all fields including position
            finalMappings.push(existingMapping);
            processedKeys.add(key);
          }
        });
        
        // Then, add any new mappings from response that weren't in existing mappings
        // For new mappings, try to get position info from outputLayoutInfo if available
        responseMappings.forEach(responseMapping => {
          const key = `${responseMapping.inputField || ''}_${responseMapping.outputField}`;
          if (!processedKeys.has(key)) {
            // Check if we have layout info for this field
            const layoutInfo = outputLayoutInfo[responseMapping.outputField];
            finalMappings.push({
              ...responseMapping,
              startPos: responseMapping.startPos || (layoutInfo?.startPos) || null,
              endPos: responseMapping.endPos || (layoutInfo?.endPos) || null,
              length: responseMapping.length || (layoutInfo?.length) || null
            });
            processedKeys.add(key);
          }
        });
        
        // Finally, add incomplete/new rows at the end
        finalMappings.push(...incompleteMappings);
        
        console.log('[Frontend] Final mappings count:', finalMappings.length, 
          '(updated:', existingValidMappings.length, 
          ', new from response:', responseMappings.length - existingValidMappings.length,
          ', incomplete:', incompleteMappings.length, ')');
        console.log('[Frontend] Sample updated mapping:', finalMappings[0]);
        
        // Update editableMappings with the final list
        setEditableMappings([...finalMappings]);
        // Update previous mappings for next comparison (output field is required, input field is optional)
        setPreviousMappings(JSON.parse(JSON.stringify(finalMappings.filter(m => m.outputField))));
      } else {
        // If no mappings in response, keep current editableMappings but update preview
        console.warn('[Frontend] No mappings in response, keeping current editableMappings');
      }
      
      // Update the AI mapping - merge only changed columns
      setAiMapping(prev => {
        if (!prev) {
          // No previous mapping, use response as-is
          return {
            preview: updatedMapping.preview || [],
            mappings: updatedMapping.mappings || [],
            validations: updatedMapping.validations || [],
            rules: updatedMapping.rules || [],
            summary: updatedMapping.summary || {}
          };
        }
        
        // Merge: update only changed columns, preserve others
        const changedOutputFields = new Set();
        
        if (changedMappings && Array.isArray(changedMappings)) {
          changedMappings.forEach(m => {
            if (m.outputField) {
              changedOutputFields.add(m.outputField);
            }
          });
        }
        
        // Merge preview: update only changed columns
        let mergedPreview = prev.preview || [];
        if (updatedMapping.preview && updatedMapping.preview.length > 0) {
          if (changedOutputFields.size > 0 && prev.preview && prev.preview.length > 0) {
            // Merge: update only changed columns
            mergedPreview = prev.preview.map((existingRecord, index) => {
              const newRecord = updatedMapping.preview[index];
              if (newRecord) {
                const mergedRecord = { ...existingRecord };
                changedOutputFields.forEach(field => {
                  if (newRecord[field] !== undefined) {
                    mergedRecord[field] = newRecord[field];
                    console.log('[Frontend] Updated preview field:', field, 'for record', index, ':', newRecord[field]);
                  }
                });
                return mergedRecord;
              }
              return existingRecord;
            });
            console.log('[Frontend] Merged preview: updated', changedOutputFields.size, 'columns');
          } else {
            mergedPreview = updatedMapping.preview;
            console.log('[Frontend] Using new preview (no previous preview or no changed fields)');
          }
        }
        
        // Merge validations: update only changed fields
        let mergedValidations = [...(prev.validations || [])];
        if (updatedMapping.validations && Array.isArray(updatedMapping.validations)) {
          const validationMap = new Map();
          mergedValidations.forEach(v => {
            validationMap.set(v.field, v);
          });
          
          updatedMapping.validations.forEach(v => {
            if (changedOutputFields.has(v.field)) {
              // Update validation for changed field
              validationMap.set(v.field, v);
              console.log('[Frontend] Updated validation for changed field:', v.field, 'type:', v.type);
            } else if (!validationMap.has(v.field)) {
              // Add new validation
              validationMap.set(v.field, v);
              console.log('[Frontend] Added new validation for field:', v.field, 'type:', v.type);
            }
          });
          
          mergedValidations = Array.from(validationMap.values());
          console.log('[Frontend] Merged validations count:', mergedValidations.length);
        }
        
        // Merge rules: update only changed fields and remove duplicates
        let mergedRules = [];
        if (updatedMapping.rules && Array.isArray(updatedMapping.rules)) {
          const rulesMap = new Map();
          const seenDescriptions = new Set();
          
          // Extract field name from rule - use outputField property first, then try description patterns
          const getFieldFromRule = (rule) => {
            // Priority 1: Use outputField property directly (new format)
            if (rule.outputField) {
              return rule.outputField;
            }
            // Priority 2: Try various description patterns
            if (rule.description) {
              // New format: "OutputField: transformation"
              const newFormatMatch = rule.description.match(/^(\w+):/);
              if (newFormatMatch) return newFormatMatch[1];
              
              // Arrow format: "Map X → OutputField"
              const arrowMatch = rule.description.match(/→\s*(\w+)/);
              if (arrowMatch) return arrowMatch[1];
              
              // Old format: "Transform X to OutputField: transformation"
              const toMatch = rule.description.match(/to (\w+):/);
              if (toMatch) return toMatch[1];
              
              // Generic: "to OutputField"
              const simpleToMatch = rule.description.match(/to (\w+)/);
              if (simpleToMatch) return simpleToMatch[1];
              
              // Field mention: "field OutputField"
              const fieldMatch = rule.description.match(/field (\w+)/);
              if (fieldMatch) return fieldMatch[1];
            }
            return null;
          };
          
          // First, process new rules from response (they have priority for changed fields)
          updatedMapping.rules.forEach(r => {
            const fieldName = getFieldFromRule(r);
            if (fieldName) {
              // For changed fields, always use the new rule
              if (changedOutputFields.has(fieldName) || !rulesMap.has(fieldName)) {
                rulesMap.set(fieldName, r);
                seenDescriptions.add(r.description);
                if (changedOutputFields.has(fieldName)) {
                  console.log('[Frontend] Updated rule for changed field:', fieldName);
                }
              }
            }
          });
          
          // Then, add existing rules that aren't for changed fields and don't duplicate
          (prev.rules || []).forEach(r => {
            const fieldName = getFieldFromRule(r);
            if (fieldName) {
              // Only keep if not already in map (new rules take priority)
              if (!rulesMap.has(fieldName) && !changedOutputFields.has(fieldName)) {
                rulesMap.set(fieldName, r);
                seenDescriptions.add(r.description);
              }
            } else if (r.description && !seenDescriptions.has(r.description)) {
              // General rule - add if description not seen
              rulesMap.set(`general_${rulesMap.size}`, r);
              seenDescriptions.add(r.description);
            }
          });
          
          mergedRules = Array.from(rulesMap.values());
          console.log('[Frontend] Merged rules count (after dedup):', mergedRules.length);
        } else {
          // No new rules, keep previous but deduplicate
          const seenFields = new Set();
          const seenDescriptions = new Set();
          (prev.rules || []).forEach(r => {
            const fieldName = r.outputField || null;
            const key = fieldName || r.description;
            if (key && !seenFields.has(key) && !seenDescriptions.has(r.description)) {
              mergedRules.push(r);
              if (fieldName) seenFields.add(fieldName);
              seenDescriptions.add(r.description);
            }
          });
        }
        
        const newMapping = {
          ...prev,
          preview: mergedPreview,
          mappings: updatedMapping.mappings || prev.mappings || [],
          validations: mergedValidations,
          rules: mergedRules,
          summary: updatedMapping.summary || prev.summary || {}
        };
        
        console.log('[Frontend] Merged AI mapping (only changed columns updated):');
        console.log('  - Changed output fields:', Array.from(changedOutputFields));
        console.log('  - Rules:', newMapping.rules?.length || 0);
        console.log('  - Validations:', newMapping.validations?.length || 0);
        console.log('  - Preview records:', newMapping.preview?.length || 0);
        
        // Force a new object reference to trigger re-render
        return { ...newMapping };
      });
      
      setSuccess('Mappings refreshed and preview updated!');
      setHasChanges(false);
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        setError('Request timed out. Please try again.');
      } else if (err.response) {
        const errorMsg = err.response.data?.error || err.response.data?.message || 'Error refreshing mappings';
        setError(`Refresh failed: ${errorMsg}`);
      } else if (err.request) {
        setError('Network error: Unable to connect to the server. Please check your connection.');
      } else {
        setError(`Error: ${err.message || 'An unexpected error occurred while refreshing mappings'}`);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const FileUploadCard = ({ title, fieldName, required, description, accept }) => (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Description sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6">
            {title} {required && <span style={{ color: 'red' }}>*</span>}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {description}
        </Typography>
        <input
          accept={accept}
          style={{ display: 'none' }}
          id={`file-${fieldName}`}
          type="file"
          onChange={handleFileChange(fieldName)}
        />
        <label htmlFor={`file-${fieldName}`}>
          <Button
            variant="outlined"
            component="span"
            startIcon={<CloudUpload />}
            fullWidth
          >
            {files[fieldName] ? files[fieldName].name : 'Choose File'}
          </Button>
        </label>
      </CardContent>
    </Card>
  );

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
          New Transformation
        </Typography>
      </Box>

      <Stepper activeStep={activeStep} sx={{ mb: 4, backgroundColor: 'rgba(255, 255, 255, 0.9)', p: 2, borderRadius: 2 }}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && (
        <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-line' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {activeStep === 0 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Upload Files
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Upload your input file and output sample. Reference documents are optional but can help improve mapping accuracy.
          </Typography>

          <FileUploadCard
            title="Input File"
            fieldName="inputFile"
            required
            description="Your source data file (.txt, .csv, .xlsx, or delimited)"
            accept=".txt,.csv,.xlsx,.xls,.dat"
          />

          <FileUploadCard
            title="Output Sample File"
            fieldName="outputSampleFile"
            required
            description="Sample of your desired output format (.txt, .csv, .xlsx, or delimited)"
            accept=".txt,.csv,.xlsx,.xls,.dat"
          />

          <FileUploadCard
            title="Input Reference (Optional)"
            fieldName="inputReference"
            description="Documentation or reference for input data (.pdf, .docx, .xlsx, .txt)"
            accept=".pdf,.docx,.doc,.xlsx,.xls,.txt"
          />

          <FileUploadCard
            title="Output Reference (Optional)"
            fieldName="outputReference"
            description="Documentation or reference for output format (.pdf, .docx, .xlsx, .txt)"
            accept=".pdf,.docx,.doc,.xlsx,.xls,.txt"
          />

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              size="large"
              onClick={handleImportFiles}
              disabled={uploading || !files.inputFile || !files.outputSampleFile}
              startIcon={uploading ? <CircularProgress size={20} color="inherit" /> : <CloudUpload />}
            >
              {uploading ? 'Importing & Analyzing...' : 'Import Files'}
            </Button>
          </Box>
        </Paper>
      )}

      {activeStep === 1 && aiMapping && (
        <Box>
          {/* Summary Section */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              AI Analysis Summary
            </Typography>
            {aiMapping.summary && (
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={12} sm={6} md={3}>
                  <Typography variant="body2" color="text.secondary">Total Input Fields</Typography>
                  <Typography variant="h6">{aiMapping.summary.totalInputFields || 0}</Typography>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <Typography variant="body2" color="text.secondary">Total Output Fields</Typography>
                  <Typography variant="h6">{aiMapping.summary.totalOutputFields || 0}</Typography>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <Typography variant="body2" color="text.secondary">Mapped Fields</Typography>
                  <Typography variant="h6">{aiMapping.summary.mappedFields || 0}</Typography>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <Typography variant="body2" color="text.secondary">Complexity</Typography>
                  <Chip 
                    label={aiMapping.summary.transformationComplexity || 'N/A'} 
                    color={aiMapping.summary.transformationComplexity === 'simple' ? 'success' : 
                           aiMapping.summary.transformationComplexity === 'moderate' ? 'warning' : 'error'}
                  />
                </Grid>
              </Grid>
            )}
          </Paper>

          {/* Editable Mappings Table */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="h6">
                    Field Mappings
                  </Typography>
                  {isPositionBased && (
                    <Chip 
                      label="Position-Based Layout" 
                      color="info" 
                      size="small"
                      sx={{ fontWeight: 'bold' }}
                    />
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {isPositionBased 
                    ? 'Edit mappings with position info (Start, End, Length) for fixed-width output.'
                    : 'Edit mappings directly in the table. Changes are tracked automatically.'}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={handleAddMapping}
                  size="small"
                >
                  Add Row
                </Button>
                <Button
                  variant="contained"
                  startIcon={refreshing ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
                  onClick={handleRefreshMappings}
                  disabled={refreshing || !hasChanges}
                  size="small"
                >
                  {refreshing ? 'Refreshing...' : 'Refresh Preview'}
                </Button>
              </Box>
            </Box>
            
            {hasChanges && (
              <Alert severity="info" sx={{ mb: 2 }}>
                You have unsaved changes. Click "Refresh Preview" to apply changes and update the preview.
              </Alert>
            )}
            
            <TableContainer sx={{ overflowX: 'auto', maxWidth: '100%' }}>
              <Table sx={{ minWidth: isPositionBased ? 1100 : 800 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold', minWidth: 150 }}>Input Field</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', minWidth: 150 }}>Output Field</TableCell>
                    {isPositionBased && (
                      <>
                        <TableCell sx={{ fontWeight: 'bold', minWidth: 70, textAlign: 'center' }} title="Start Position">Start</TableCell>
                        <TableCell sx={{ fontWeight: 'bold', minWidth: 70, textAlign: 'center' }} title="End Position">End</TableCell>
                        <TableCell sx={{ fontWeight: 'bold', minWidth: 60, textAlign: 'center' }} title="Field Length">Len</TableCell>
                      </>
                    )}
                    <TableCell sx={{ fontWeight: 'bold', minWidth: 50, textAlign: 'center' }}>Req</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', minWidth: 100 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', minWidth: isPositionBased ? 200 : 280 }}>Transformations</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', minWidth: 60, textAlign: 'center' }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {editableMappings.length > 0 ? (
                    editableMappings.map((mapping, index) => (
                      <TableRow key={index} hover>
                        <TableCell>
                          <TextField
                            size="small"
                            value={mapping.inputField}
                            onChange={(e) => handleMappingEdit(index, 'inputField', e.target.value)}
                            fullWidth
                            placeholder="Input field name"
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            value={mapping.outputField}
                            onChange={(e) => handleMappingEdit(index, 'outputField', e.target.value)}
                            fullWidth
                            placeholder="Output field name"
                          />
                        </TableCell>
                        {isPositionBased && (
                          <>
                            <TableCell sx={{ textAlign: 'center' }}>
                              <TextField
                                size="small"
                                type="number"
                                value={mapping.startPos || ''}
                                onChange={(e) => handleMappingEdit(index, 'startPos', e.target.value ? parseInt(e.target.value) : null)}
                                inputProps={{ min: 1, style: { textAlign: 'center', width: '50px' } }}
                                sx={{ '& input': { p: '6px 8px' }, width: '65px' }}
                              />
                            </TableCell>
                            <TableCell sx={{ textAlign: 'center' }}>
                              <TextField
                                size="small"
                                type="number"
                                value={mapping.endPos || ''}
                                onChange={(e) => handleMappingEdit(index, 'endPos', e.target.value ? parseInt(e.target.value) : null)}
                                inputProps={{ min: 1, style: { textAlign: 'center', width: '50px' } }}
                                sx={{ '& input': { p: '6px 8px' }, width: '65px' }}
                              />
                            </TableCell>
                            <TableCell sx={{ textAlign: 'center' }}>
                              <TextField
                                size="small"
                                type="number"
                                value={mapping.length || ''}
                                onChange={(e) => handleMappingEdit(index, 'length', e.target.value ? parseInt(e.target.value) : null)}
                                inputProps={{ min: 1, style: { textAlign: 'center', width: '45px' } }}
                                sx={{ '& input': { p: '6px 8px' }, width: '55px' }}
                              />
                            </TableCell>
                          </>
                        )}
                        <TableCell align="center">
                          <Checkbox
                            checked={mapping.required || false}
                            onChange={(e) => handleMappingEdit(index, 'required', e.target.checked)}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          <FormControl size="small" fullWidth required error={!mapping.dataType || mapping.dataType.trim() === ''}>
                            <InputLabel>Type *</InputLabel>
                            <Select
                              value={mapping.dataType || 'string'}
                              onChange={(e) => handleMappingEdit(index, 'dataType', e.target.value)}
                              label="Type *"
                              required
                            >
                              {dataTypes.map((type) => (
                                <MenuItem key={type} value={type}>
                                  {type}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell sx={{ overflow: 'hidden' }}>
                          <Box 
                            sx={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: 0.5,
                              cursor: 'pointer',
                              px: 1,
                              py: 0.5,
                              borderRadius: 1,
                              border: '1px solid',
                              borderColor: 'grey.300',
                              backgroundColor: mapping.transformations ? 'grey.50' : 'transparent',
                              '&:hover': {
                                backgroundColor: 'action.hover',
                                borderColor: 'primary.main'
                              },
                              minHeight: 32,
                              width: '100%',
                              boxSizing: 'border-box'
                            }}
                            onClick={() => handleOpenTransformationPopup(index)}
                          >
                            <Box sx={{ 
                              flex: 1, 
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontSize: '0.8rem',
                              color: mapping.transformations ? 'text.primary' : 'text.secondary',
                              minWidth: 0
                            }}>
                              {mapping.transformations || 'Click to edit...'}
                            </Box>
                            <EditIcon 
                              sx={{ 
                                fontSize: 16, 
                                color: 'action.active',
                                flexShrink: 0
                              }} 
                            />
                          </Box>
                        </TableCell>
                        <TableCell>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteMapping(index)}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} align="center">
                        <Typography variant="body2" color="text.secondary">
                          No mappings available. Click "Add Row" to create a new mapping.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          {/* Preview Table */}
          {aiMapping.preview && aiMapping.preview.length > 0 && (
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                Preview (First 100 Records)
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Preview of transformed data based on the mappings above.
              </Typography>
              <PreviewTable data={aiMapping.preview} />
            </Paper>
          )}

          {/* Save Profile Section */}
          <Paper sx={{ p: 3, mb: 3 }}>
            {/* Profile Save Message - shown above the save section */}
            {profileMessage.type && (
              <Alert 
                severity={profileMessage.type} 
                sx={{ mb: 2 }} 
                onClose={() => setProfileMessage({ type: null, text: null })}
              >
                {profileMessage.text}
              </Alert>
            )}
            
            <Typography variant="h6" gutterBottom>
              Save Profile (Optional)
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Save this transformation profile for future use.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <TextField
                label="Profile Name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="e.g., Customer Data Mapping"
                sx={{ flexGrow: 1 }}
                size="small"
              />
              <Button
                variant="outlined"
                color="secondary"
                onClick={async () => {
                  if (!profileName.trim()) {
                    setProfileMessage({ type: 'error', text: 'Please enter a profile name' });
                    return;
                  }
                  
                  // Validate that all mappings have required fields (outputField and dataType)
                  // Auto-default dataType to 'string' if missing, but show warning
                  let hasMissingTypes = false;
                  const mappingsWithMissingType = [];
                  
                  editableMappings.forEach((m, idx) => {
                    if (m.outputField && m.outputField.trim() !== '' && (!m.dataType || m.dataType.trim() === '')) {
                      hasMissingTypes = true;
                      mappingsWithMissingType.push({ index: idx, outputField: m.outputField });
                      // Auto-default to 'string'
                      m.dataType = 'string';
                    }
                  });
                  
                  // Update editableMappings if we auto-defaulted any types
                  if (hasMissingTypes) {
                    setEditableMappings([...editableMappings]);
                    const missingTypeRows = mappingsWithMissingType.map(m => m.index + 1);
                    const missingTypeFields = mappingsWithMissingType.map(m => m.outputField).join(', ');
                    
                    setValidationErrorDialog({
                      open: true,
                      title: 'Type Field Auto-Defaulted',
                      message: `The "Type" field is mandatory. The following field(s) had missing Type values and have been automatically set to "string":\n\n${missingTypeFields}\n\nRow${missingTypeRows.length > 1 ? 's' : ''}: ${missingTypeRows.join(', ')}\n\nPlease review and update the Type field if "string" is not appropriate.`
                    });
                    // Continue with save after showing warning
                  }
                  
                  // Check for missing output fields (still required)
                  const invalidMappings = editableMappings.filter(m => {
                    if (!m.outputField || m.outputField.trim() === '') return true;
                    return false;
                  });
                  
                  if (invalidMappings.length > 0) {
                    const missingOutputFields = invalidMappings.filter(m => !m.outputField || m.outputField.trim() === '').length;
                    const rowsWithMissingOutput = invalidMappings
                      .map((m, idx) => !m.outputField || m.outputField.trim() === '' ? idx + 1 : null)
                      .filter(idx => idx !== null);
                    
                    let errorMsg = 'Cannot save profile. Please fill in all required fields:\n\n';
                    errorMsg += `• ${missingOutputFields} row(s) missing Output Field`;
                    if (rowsWithMissingOutput.length > 0 && rowsWithMissingOutput.length <= 10) {
                      errorMsg += ` (Row${rowsWithMissingOutput.length > 1 ? 's' : ''}: ${rowsWithMissingOutput.join(', ')})`;
                    }
                    errorMsg += '\n\nPlease fill in the Output Field in the Field Mapping table and try again.';
                    
                    setValidationErrorDialog({
                      open: true,
                      title: 'Cannot Save Profile',
                      message: errorMsg
                    });
                    return;
                  }
                  setSavingProfile(true);
                  setProfileMessage({ type: null, text: null });
                  try {
                    // Build rules directly from editableMappings to ensure they're up-to-date
                    const updatedRules = editableMappings
                      .filter(m => m.outputField)
                      .map(m => ({
                        outputField: m.outputField,
                        inputField: m.inputField || '',
                        type: (m.transformations || m.transformation) ? 'formatting' : 'mapping',
                        transformationRule: m.transformations || m.transformation || '',
                        description: (m.transformations || m.transformation)
                          ? `${m.outputField}: ${m.transformations || m.transformation}`
                          : `Map ${m.inputField || '(generated)'} → ${m.outputField}`
                      }));
                    
                    // Build validations directly from editableMappings
                    const updatedValidations = editableMappings
                      .filter(m => m.outputField)
                      .map(m => ({
                        field: m.outputField,
                        type: (m.required === true || m.required === 'true') ? 'required' : 'optional',
                        rule: m.dataType || 'string',
                        message: `${m.outputField} must be ${m.dataType || 'string'}${(m.required === true || m.required === 'true') ? ' and is required' : ''}`
                      }));
                    
                    const profileData = {
                      name: profileName,
                      mappings: editableMappings,
                      rules: updatedRules,
                      validations: updatedValidations,
                      summary: aiMapping?.summary || {},
                      isPositionBased: isPositionBased,
                      outputLayoutInfo: outputLayoutInfo
                    };
                    
                    console.log('[Save Profile] Saving profile with', updatedRules.length, 'rules and', updatedValidations.length, 'validations');
                    if (isPositionBased) {
                      console.log('[Save Profile] Position-based format - mappings include position info');
                    }
                    
                    await axios.post(`${API_URL}/api/profiles`, profileData);
                    setProfileMessage({ type: 'success', text: 'Profile saved successfully!' });
                    setSavingProfile(false);
                  } catch (err) {
                    setProfileMessage({ type: 'error', text: err.response?.data?.error || 'Error saving profile' });
                    setSavingProfile(false);
                  }
                }}
                disabled={savingProfile || !profileName.trim()}
                startIcon={savingProfile ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
              >
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </Button>
            </Box>
          </Paper>

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Button
              variant="outlined"
              onClick={() => setActiveStep(0)}
            >
              Back
            </Button>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="outlined"
                onClick={() => {
                  setShowJobHistory(true);
                  fetchJobs();
                }}
                startIcon={<Description />}
              >
                View Jobs
              </Button>
              <Button
                variant="contained"
                onClick={() => setShowApproveDialog(true)}
                startIcon={<ApproveIcon />}
                size="large"
              >
                Approve & Transform
              </Button>
            </Box>
          </Box>
        </Box>
      )}

      {/* Approve Dialog */}
      {showApproveDialog && (
        <Paper sx={{ p: 3, mb: 3, backgroundColor: 'rgba(255, 255, 255, 0.95)' }}>
          <Typography variant="h6" gutterBottom>
            Approve & Transform
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
              {outputFormats.map((format) => (
                <MenuItem key={format} value={format}>
                  {format.toUpperCase()}
                </MenuItem>
              ))}
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

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3 }}>
            <Button
              variant="outlined"
              onClick={() => {
                setShowApproveDialog(false);
                setOutputPath('');
                setOutputFileName('transformed_output');
                setTransformMessage({ type: null, text: null });
              }}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={async () => {
                if (!outputPath.trim() || !outputFileName.trim()) {
                  setTransformMessage({ type: 'error', text: 'Please provide both output path and file name' });
                  return;
                }

                if (!uploadResult || !uploadResult.inputFile) {
                  setTransformMessage({ type: 'error', text: 'Input file not available. Please upload files first.' });
                  return;
                }
                
                // For large files, we might only have path, not data
                const isLargeFile = uploadResult.inputFile?.isLargeFile || false;
                const hasData = uploadResult.inputFile?.data && Array.isArray(uploadResult.inputFile.data);
                const hasPath = uploadResult.inputFile?.path;
                
                if (!isLargeFile && !hasData) {
                  setTransformMessage({ type: 'error', text: 'Input data not available. Please upload files first.' });
                  return;
                }
                
                if (isLargeFile && !hasPath) {
                  setTransformMessage({ type: 'error', text: 'Input file path not available. Please upload files again.' });
                  return;
                }

                // Filter mappings - only require outputField (inputField is optional for generated fields)
                const validMappings = editableMappings.filter(m => m.outputField);
                if (validMappings.length === 0) {
                  setTransformMessage({ type: 'error', text: 'Please add at least one valid mapping with an output field.' });
                  return;
                }
                
                console.log('[Approve] Sending', validMappings.length, 'mappings for transformation');
                console.log('[Approve] Sample mapping:', JSON.stringify(validMappings[0], null, 2));

                setApproving(true);
                setTransformMessage({ type: null, text: null });
                
                // Get file info (already validated above) - define outside try block for use in catch
                const inputData = uploadResult.inputFile?.data;
                const inputFilePath = uploadResult.inputFile?.path;
                const recordCount = uploadResult.inputFile?.totalRecords || (Array.isArray(inputData) ? inputData.length : 0);
                
                try {
                  
                  const requestPayload = {
                    mappings: validMappings,
                    outputPath: outputPath.trim(),
                    fileName: outputFileName.trim(),
                    format: outputFormat
                  };
                  
                  // For large files, send file path; for small files, send data
                  if (isLargeFile && inputFilePath) {
                    requestPayload.inputFilePath = inputFilePath;
                    console.log('[Approve] Large file detected, using file path:', inputFilePath);
                  } else {
                    requestPayload.inputData = inputData || [];
                    console.log('[Approve] Small file, sending data directly');
                  }
                  
                  const response = await axios.post(`${API_URL}/api/transform-and-save`, requestPayload, {
                    timeout: 1800000, // 30 minutes timeout for large file processing
                    headers: {
                      'Content-Type': 'application/json'
                    }
                  });

                  // Check if this was submitted as an async job
                  if (response.data.isAsync && response.data.jobId) {
                    setTransformMessage({ 
                      type: 'info', 
                      text: `Large file detected (${recordCount} records). Job ${response.data.jobId} created and processing in background. You can close this window - you'll receive a system notification when complete. Click "View Jobs" to check status.` 
                    });
                    setShowApproveDialog(false);
                    // Refresh jobs list
                    fetchJobs();
                  } else {
                    setTransformMessage({ type: 'success', text: `File transformed and saved successfully to ${response.data.filePath}` });
                  }
                  setApproving(false);
                } catch (err) {
                  // Check if this was a connection reset (server restart during processing)
                  if (err.code === 'ECONNRESET' || err.message?.includes('ECONNRESET') || err.message?.includes('connection')) {
                    // If it's a large file, it might have been submitted as a background job
                    if (recordCount > 1000) {
                      setTransformMessage({ 
                        type: 'info', 
                        text: `Connection was interrupted (server may have restarted). For large files (>1000 records), the job may have been created and is processing in the background. Check "View Jobs" to see job status.` 
                      });
                    } else {
                      setTransformMessage({ 
                        type: 'error', 
                        text: 'Connection was interrupted. Please try again. If the server restarted, your job may still be processing in the background - check "View Jobs".' 
                      });
                    }
                  } else {
                    setTransformMessage({ type: 'error', text: err.response?.data?.error || 'Error transforming and saving file' });
                  }
                  setApproving(false);
                }
              }}
              disabled={approving || !outputPath.trim() || !outputFileName.trim()}
              startIcon={approving ? <CircularProgress size={16} color="inherit" /> : <ApproveIcon />}
            >
              {approving ? 'Processing...' : 'Approve & Transform'}
            </Button>
          </Box>
          
          {/* Transform Message - shown below the buttons */}
          {transformMessage.type && (
            <Alert 
              severity={transformMessage.type} 
              sx={{ mt: 2 }} 
              onClose={() => setTransformMessage({ type: null, text: null })}
            >
              {transformMessage.text}
            </Alert>
          )}
        </Paper>
      )}

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

      {activeStep === 2 && aiMapping && (
        <Paper sx={{ p: 3 }}>
          {/* Profile Save Message - shown above the save section */}
          {profileMessage.type && (
            <Alert 
              severity={profileMessage.type} 
              sx={{ mb: 2 }} 
              onClose={() => setProfileMessage({ type: null, text: null })}
            >
              {profileMessage.text}
            </Alert>
          )}
          
          <Typography variant="h6" gutterBottom>
            Save Transformation Profile
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Save this transformation profile for future use. You can apply it to new input files later.
          </Typography>
          
          <TextField
            fullWidth
            label="Profile Name"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            sx={{ mt: 2, mb: 2 }}
            required
            placeholder="e.g., Customer Data Mapping"
          />

          <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              onClick={() => setActiveStep(1)}
            >
              Back
            </Button>
            <Button
              variant="contained"
              onClick={async () => {
                if (!profileName.trim()) {
                  setProfileMessage({ type: 'error', text: 'Please enter a profile name' });
                  return;
                }
                
                // Validate that all mappings have required fields (outputField and dataType)
                // Auto-default dataType to 'string' if missing, but show warning
                let hasMissingTypes = false;
                const mappingsWithMissingType = [];
                
                editableMappings.forEach((m, idx) => {
                  if (m.outputField && m.outputField.trim() !== '' && (!m.dataType || m.dataType.trim() === '')) {
                    hasMissingTypes = true;
                    mappingsWithMissingType.push({ index: idx, outputField: m.outputField });
                    // Auto-default to 'string'
                    m.dataType = 'string';
                  }
                });
                
                // Update editableMappings if we auto-defaulted any types
                if (hasMissingTypes) {
                  setEditableMappings([...editableMappings]);
                  const missingTypeRows = mappingsWithMissingType.map(m => m.index + 1);
                  const missingTypeFields = mappingsWithMissingType.map(m => m.outputField).join(', ');
                  
                  setValidationErrorDialog({
                    open: true,
                    title: 'Type Field Auto-Defaulted',
                    message: `The "Type" field is mandatory. The following field(s) had missing Type values and have been automatically set to "string":\n\n${missingTypeFields}\n\nRow${missingTypeRows.length > 1 ? 's' : ''}: ${missingTypeRows.join(', ')}\n\nPlease review and update the Type field if "string" is not appropriate.`
                  });
                  // Continue with save after showing warning
                }
                
                // Check for missing output fields (still required)
                const invalidMappings = editableMappings.filter(m => {
                  if (!m.outputField || m.outputField.trim() === '') return true;
                  return false;
                });
                
                if (invalidMappings.length > 0) {
                  const missingOutputFields = invalidMappings.filter(m => !m.outputField || m.outputField.trim() === '').length;
                  const rowsWithMissingOutput = invalidMappings
                    .map((m, idx) => !m.outputField || m.outputField.trim() === '' ? idx + 1 : null)
                    .filter(idx => idx !== null);
                  
                  let errorMsg = 'Cannot save profile. Please fill in all required fields:\n\n';
                  errorMsg += `• ${missingOutputFields} row(s) missing Output Field`;
                  if (rowsWithMissingOutput.length > 0 && rowsWithMissingOutput.length <= 10) {
                    errorMsg += ` (Row${rowsWithMissingOutput.length > 1 ? 's' : ''}: ${rowsWithMissingOutput.join(', ')})`;
                  }
                  errorMsg += '\n\nPlease fill in the Output Field in the Field Mapping table and try again.';
                  
                  setValidationErrorDialog({
                    open: true,
                    title: 'Cannot Save Profile',
                    message: errorMsg
                  });
                  return;
                }
                
                setSavingProfile(true);
                setProfileMessage({ type: null, text: null });
                try {
                  // Build rules directly from editableMappings to ensure they're up-to-date
                  const updatedRules = editableMappings
                    .filter(m => m.outputField)
                    .map(m => ({
                      outputField: m.outputField,
                      inputField: m.inputField || '',
                      type: (m.transformations || m.transformation) ? 'formatting' : 'mapping',
                      transformationRule: m.transformations || m.transformation || '',
                      description: (m.transformations || m.transformation)
                        ? `${m.outputField}: ${m.transformations || m.transformation}`
                        : `Map ${m.inputField || '(generated)'} → ${m.outputField}`
                    }));
                  
                  // Build validations directly from editableMappings
                  const updatedValidations = editableMappings
                    .filter(m => m.outputField)
                    .map(m => ({
                      field: m.outputField,
                      type: (m.required === true || m.required === 'true') ? 'required' : 'optional',
                      rule: m.dataType || 'string',
                      message: `${m.outputField} must be ${m.dataType || 'string'}${(m.required === true || m.required === 'true') ? ' and is required' : ''}`
                    }));
                  
                  const profileData = {
                    name: profileName,
                    mappings: editableMappings,
                    rules: updatedRules,
                    validations: updatedValidations,
                    summary: aiMapping?.summary || {},
                    isPositionBased: isPositionBased,
                    outputLayoutInfo: outputLayoutInfo
                  };
                  
                  console.log('[Save Profile] Saving profile with', updatedRules.length, 'rules and', updatedValidations.length, 'validations');
                  if (isPositionBased) {
                    console.log('[Save Profile] Position-based format - mappings include position info');
                  }
                  
                  await axios.post(`${API_URL}/api/profiles`, profileData);
                  setProfileMessage({ type: 'success', text: 'Profile saved successfully!' });
                  setSavingProfile(false);
                  setTimeout(() => navigate('/'), 2000);
                } catch (err) {
                  setProfileMessage({ type: 'error', text: err.response?.data?.error || 'Error saving profile' });
                  setSavingProfile(false);
                }
              }}
              disabled={!profileName.trim() || savingProfile}
              startIcon={savingProfile ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
            >
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </Button>
          </Box>
        </Paper>
      )}

      {/* Job History Dialog */}
      <Dialog
        open={showJobHistory}
        onClose={() => setShowJobHistory(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            minHeight: '500px',
            maxHeight: '80vh'
          }
        }}
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: 'divider',
          pb: 2
        }}>
          <Typography variant="h6">Job History</Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <IconButton 
              onClick={fetchJobs} 
              disabled={refreshingJobs}
              size="small"
              title="Refresh"
            >
              <RefreshIcon />
            </IconButton>
            <IconButton onClick={() => setShowJobHistory(false)} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {refreshingJobs && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          
          {jobs.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              No jobs found. Large files (>1000 records) will be processed as background jobs.
            </Typography>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Job ID</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Created</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Progress</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Records</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Output File</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Error</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id} hover>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {job.id}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={job.status.toUpperCase()} 
                          color={getJobStatusColor(job.status)}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: '0.75rem' }}>
                          {formatDate(job.createdAt)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {job.status === 'running' ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CircularProgress size={16} />
                            <Typography variant="body2">{job.progress || 0}%</Typography>
                          </Box>
                        ) : job.status === 'completed' ? (
                          <Typography variant="body2" color="success.main">100%</Typography>
                        ) : (
                          <Typography variant="body2" color="text.secondary">-</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {job.recordCount || '-'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {job.outputFilePath ? (
                          <Typography 
                            variant="body2" 
                            sx={{ 
                              fontFamily: 'monospace', 
                              fontSize: '0.75rem',
                              wordBreak: 'break-all',
                              maxWidth: '300px'
                            }}
                          >
                            {job.outputFilePath}
                          </Typography>
                        ) : (
                          <Typography variant="body2" color="text.secondary">-</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {job.error ? (
                          <Typography variant="body2" color="error.main" sx={{ fontSize: '0.75rem' }}>
                            {job.error}
                          </Typography>
                        ) : (
                          <Typography variant="body2" color="text.secondary">-</Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowJobHistory(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Transformation Rules Popup Dialog */}
      <Dialog
        open={transformationPopup.open}
        onClose={handleCloseTransformationPopup}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            minHeight: '400px',
            maxHeight: '80vh'
          }
        }}
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: 'divider',
          pb: 2
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <EditIcon color="primary" />
            <Typography variant="h6">
              Edit Transformation Rules
            </Typography>
          </Box>
          <IconButton onClick={handleCloseTransformationPopup} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter transformation rules using natural language. Examples:
          </Typography>
          <Box sx={{ 
            mb: 3, 
            p: 2, 
            backgroundColor: 'grey.50', 
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'grey.200'
          }}>
            <Typography variant="body2" component="div" sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
              • <strong>uppercase</strong> - Convert to uppercase<br/>
              • <strong>lowercase</strong> - Convert to lowercase<br/>
              • <strong>trim</strong> - Remove leading/trailing spaces<br/>
              • <strong>first 5 characters</strong> - Extract first N characters<br/>
              • <strong>format as date MM/DD/YYYY</strong> - Format date<br/>
              • <strong>concatenate FirstName and LastName with space</strong> - Combine fields<br/>
              • <strong>replace "old" with "new"</strong> - Replace text<br/>
              • <strong>add prefix "EMP-"</strong> - Add prefix to value
            </Typography>
          </Box>
          {transformationPopup.rowIndex !== null && editableMappings[transformationPopup.rowIndex] && (
            <Box sx={{ mb: 2 }}>
              <Chip 
                label={`Output Field: ${editableMappings[transformationPopup.rowIndex]?.outputField || 'N/A'}`}
                color="primary"
                variant="outlined"
                size="small"
                sx={{ mr: 1 }}
              />
              {editableMappings[transformationPopup.rowIndex]?.inputField && (
                <Chip 
                  label={`Input Field: ${editableMappings[transformationPopup.rowIndex]?.inputField}`}
                  color="secondary"
                  variant="outlined"
                  size="small"
                />
              )}
            </Box>
          )}
          <TextField
            autoFocus
            multiline
            rows={8}
            fullWidth
            variant="outlined"
            placeholder="Enter transformation rules here... (e.g., 'convert to uppercase and trim whitespace')"
            value={transformationPopup.value}
            onChange={(e) => handleTransformationPopupChange(e.target.value)}
            sx={{
              '& .MuiInputBase-root': {
                fontFamily: 'inherit',
                fontSize: '1rem',
                lineHeight: 1.6
              },
              '& .MuiOutlinedInput-root': {
                '&.Mui-focused fieldset': {
                  borderColor: 'primary.main',
                  borderWidth: 2
                }
              }
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Tip: You can write complex rules in plain English. The AI will interpret and apply them during transformation.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ 
          px: 3, 
          py: 2, 
          borderTop: '1px solid',
          borderColor: 'divider'
        }}>
          <Button onClick={handleCloseTransformationPopup} color="inherit">
            Cancel
          </Button>
          <Button 
            onClick={handleCloseTransformationPopup} 
            variant="contained"
            startIcon={<CheckCircle />}
          >
            Apply
          </Button>
        </DialogActions>
      </Dialog>

      {/* Validation Error Dialog */}
      <Dialog 
        open={validationErrorDialog.open} 
        onClose={() => setValidationErrorDialog({ open: false, title: '', message: '' })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 1,
          color: 'error.main',
          pb: 1
        }}>
          <CheckCircle sx={{ color: 'error.main' }} />
          {validationErrorDialog.title || 'Validation Error'}
        </DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 2 }}>
            <Typography variant="body1" component="pre" sx={{ 
              whiteSpace: 'pre-line', 
              fontFamily: 'inherit',
              margin: 0
            }}>
              {validationErrorDialog.message}
            </Typography>
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button 
            onClick={() => setValidationErrorDialog({ open: false, title: '', message: '' })} 
            variant="contained"
            color="primary"
          >
            OK
          </Button>
        </DialogActions>
      </Dialog>
      </Container>
    </Box>
  );
};

export default NewTransformation;
