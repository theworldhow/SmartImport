import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Container, 
  Typography, 
  Box, 
  Button, 
  Card, 
  CardContent, 
  CardActions,
  Grid
} from '@mui/material';
import { 
  AddCircleOutline, 
  FolderOpen,
  Transform as TransformIcon
} from '@mui/icons-material';

const Home = () => {
  const navigate = useNavigate();

  return (
    <Box sx={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', py: 4 }}>
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <TransformIcon sx={{ fontSize: 60, color: 'white', mb: 2 }} />
          <Typography variant="h3" component="h1" gutterBottom sx={{ fontWeight: 'bold', color: 'white' }}>
            SmartImport
          </Typography>
          <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.9)' }}>
            AI-Assisted Data Mapping & Transformation
          </Typography>
        </Box>

      <Grid container spacing={4} justifyContent="center">
        <Grid item xs={12} sm={6} md={5}>
          <Card 
            sx={{ 
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              transition: 'transform 0.2s, box-shadow 0.2s',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: 6
              }
            }}
          >
            <CardContent sx={{ flexGrow: 1, textAlign: 'center', pt: 4 }}>
              <AddCircleOutline sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
              <Typography variant="h5" component="h2" gutterBottom>
                New Transformation
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Create a new data transformation by uploading your input file, 
                output sample, and optional reference documents. Our AI will 
                analyze and suggest intelligent field mappings.
              </Typography>
            </CardContent>
            <CardActions sx={{ justifyContent: 'center', pb: 3 }}>
              <Button 
                variant="contained" 
                size="large"
                onClick={() => navigate('/new-transformation')}
                sx={{ px: 4 }}
              >
                Get Started
              </Button>
            </CardActions>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={5}>
          <Card 
            sx={{ 
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              transition: 'transform 0.2s, box-shadow 0.2s',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: 6
              }
            }}
          >
            <CardContent sx={{ flexGrow: 1, textAlign: 'center', pt: 4 }}>
              <FolderOpen sx={{ fontSize: 60, color: 'secondary.main', mb: 2 }} />
              <Typography variant="h5" component="h2" gutterBottom>
                Existing Transformation
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Use a saved transformation profile (.prf file) to transform 
                your input data. Upload your input file and select the profile 
                to apply the transformation rules.
              </Typography>
            </CardContent>
            <CardActions sx={{ justifyContent: 'center', pb: 3 }}>
              <Button 
                variant="contained" 
                color="secondary"
                size="large"
                onClick={() => navigate('/existing-transformation')}
                sx={{ px: 4 }}
              >
                Use Profile
              </Button>
            </CardActions>
          </Card>
        </Grid>
      </Grid>
      </Container>
    </Box>
  );
};

export default Home;

