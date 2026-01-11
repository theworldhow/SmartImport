const fs = require('fs');
const path = require('path');

// Try to load node-notifier, but don't fail if it's not available
let notifier = null;
try {
  notifier = require('node-notifier');
} catch (error) {
  console.warn('[JobManager] node-notifier not available, OS notifications disabled');
}

// Job statuses
const JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// Ensure jobs directory exists
const jobsDir = path.join(__dirname, 'jobs');
if (!fs.existsSync(jobsDir)) {
  fs.mkdirSync(jobsDir, { recursive: true });
}

// Generate unique job ID
const generateJobId = () => {
  return `job-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

// Get job file path
const getJobFilePath = (jobId) => {
  return path.join(jobsDir, `${jobId}.json`);
};

// Create a new job
const createJob = (jobData) => {
  const jobId = generateJobId();
  const job = {
    id: jobId,
    status: JOB_STATUS.QUEUED,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    inputFile: jobData.inputFile,
    inputFilePath: jobData.inputFilePath,
    mappings: jobData.mappings,
    outputPath: jobData.outputPath,
    fileName: jobData.fileName,
    format: jobData.format,
    outputFilePath: null,
    recordCount: null,
    error: null,
    progress: 0
  };

  const jobFilePath = getJobFilePath(jobId);
  fs.writeFileSync(jobFilePath, JSON.stringify(job, null, 2), 'utf8');
  
  console.log('[JobManager] Created job:', jobId);
  return job;
};

// Get job by ID
const getJob = (jobId) => {
  try {
    const jobFilePath = getJobFilePath(jobId);
    if (!fs.existsSync(jobFilePath)) {
      return null;
    }
    const jobData = fs.readFileSync(jobFilePath, 'utf8');
    return JSON.parse(jobData);
  } catch (error) {
    console.error('[JobManager] Error reading job:', jobId, error.message);
    return null;
  }
};

// Update job status
const updateJob = (jobId, updates) => {
  try {
    const job = getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    Object.assign(job, updates);
    if (updates.status === JOB_STATUS.RUNNING && !job.startedAt) {
      job.startedAt = new Date().toISOString();
    }
    if ((updates.status === JOB_STATUS.COMPLETED || updates.status === JOB_STATUS.FAILED) && !job.finishedAt) {
      job.finishedAt = new Date().toISOString();
    }

    const jobFilePath = getJobFilePath(jobId);
    fs.writeFileSync(jobFilePath, JSON.stringify(job, null, 2), 'utf8');
    
    return job;
  } catch (error) {
    console.error('[JobManager] Error updating job:', jobId, error.message);
    throw error;
  }
};

// Get all jobs (sorted by creation date, newest first)
const getAllJobs = () => {
  try {
    const files = fs.readdirSync(jobsDir);
    const jobs = files
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try {
          const jobData = fs.readFileSync(path.join(jobsDir, file), 'utf8');
          return JSON.parse(jobData);
        } catch (error) {
          console.error('[JobManager] Error reading job file:', file, error.message);
          return null;
        }
      })
      .filter(job => job !== null)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return jobs;
  } catch (error) {
    console.error('[JobManager] Error listing jobs:', error.message);
    return [];
  }
};

// Get queued jobs
const getQueuedJobs = () => {
  const allJobs = getAllJobs();
  return allJobs.filter(job => job.status === JOB_STATUS.QUEUED);
};

// Send OS notification
const sendNotification = (title, message, jobId = null) => {
  if (!notifier) {
    console.log('[JobManager] Notification skipped (node-notifier not available):', title, message);
    return;
  }
  
  try {
    notifier.notify({
      title: title,
      message: message,
      sound: true,
      wait: false,
      timeout: 10
    });
    console.log('[JobManager] Notification sent:', title, message);
  } catch (error) {
    console.warn('[JobManager] Failed to send notification:', error.message);
  }
};

// Delete old completed jobs (optional cleanup)
const cleanupOldJobs = (daysOld = 7) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const jobs = getAllJobs();
    let deletedCount = 0;
    
    jobs.forEach(job => {
      if (job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.FAILED) {
        const jobDate = new Date(job.finishedAt || job.createdAt);
        if (jobDate < cutoffDate) {
          const jobFilePath = getJobFilePath(job.id);
          if (fs.existsSync(jobFilePath)) {
            fs.unlinkSync(jobFilePath);
            deletedCount++;
          }
        }
      }
    });
    
    if (deletedCount > 0) {
      console.log('[JobManager] Cleaned up', deletedCount, 'old jobs');
    }
  } catch (error) {
    console.error('[JobManager] Error cleaning up jobs:', error.message);
  }
};

module.exports = {
  JOB_STATUS,
  createJob,
  getJob,
  updateJob,
  getAllJobs,
  getQueuedJobs,
  sendNotification,
  cleanupOldJobs
};

