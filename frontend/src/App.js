import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Home from './pages/Home';
import NewTransformation from './pages/NewTransformation';
import ExistingTransformation from './pages/ExistingTransformation';

const theme = createTheme({
  palette: {
    primary: {
      main: '#667eea',
    },
    secondary: {
      main: '#764ba2',
    },
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/new-transformation" element={<NewTransformation />} />
          <Route path="/existing-transformation" element={<ExistingTransformation />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

export default App;
