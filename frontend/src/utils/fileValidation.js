// File validation utilities

export const ALLOWED_INPUT_FORMATS = ['.txt', '.csv', '.xlsx', '.xls', '.dat'];
export const ALLOWED_REFERENCE_FORMATS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.txt'];
export const ALLOWED_PROFILE_FORMATS = ['.prf'];

export const validateFileFormat = (file, allowedFormats) => {
  if (!file) return { valid: false, error: 'No file selected' };
  
  const fileName = file.name.toLowerCase();
  const extension = fileName.substring(fileName.lastIndexOf('.'));
  
  if (!allowedFormats.includes(extension)) {
    return {
      valid: false,
      error: `Invalid file format. Allowed formats: ${allowedFormats.join(', ')}`
    };
  }
  
  return { valid: true };
};

export const validateFileSize = (file, maxSizeMB = 5120) => {
  if (!file) return { valid: false, error: 'No file selected' };
  
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    const currentSizeMB = (file.size / 1024 / 1024).toFixed(2);
    const maxSizeGB = (maxSizeMB / 1024).toFixed(1);
    return {
      valid: false,
      error: `File size exceeds ${maxSizeGB}GB limit. Current size: ${currentSizeMB}MB (${(file.size / 1024 / 1024 / 1024).toFixed(2)}GB)`
    };
  }
  
  return { valid: true };
};

export const getFileType = (fileName) => {
  const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
  if (['.csv', '.txt', '.dat'].includes(extension)) return 'text';
  if (['.xlsx', '.xls'].includes(extension)) return 'excel';
  if (['.pdf'].includes(extension)) return 'pdf';
  if (['.docx', '.doc'].includes(extension)) return 'word';
  if (['.prf'].includes(extension)) return 'profile';
  return 'unknown';
};

