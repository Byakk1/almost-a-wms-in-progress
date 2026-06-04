import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthRoute } from './components/AuthRoute';
import Login from './pages/Login';
import AppLayout from './layouts/AppLayout';

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* Protected Routes */}
        <Route 
          path="/*" 
          element={
            <AuthRoute>
              <AppLayout />
            </AuthRoute>
          } 
        />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
