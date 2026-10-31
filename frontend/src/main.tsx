import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { setupSpanishNumberFormatting } from './utils/numberFormat'

// Inicializar formato numérico estándar español (separador de miles con punto y decimal con coma)
setupSpanishNumberFormatting();

// Clear potentially corrupted auth data on app start
const clearCorruptedAuthData = () => {
  try {
    const authData = localStorage.getItem('rpa-auth-storage');
    if (authData) {
      const parsed = JSON.parse(authData);
      // If no token or token looks corrupted, clear everything
      if (!parsed.state?.token || typeof parsed.state.token !== 'string') {
        console.log('Clearing corrupted auth data...');
        localStorage.removeItem('rpa-auth-storage');
        localStorage.removeItem('rpa_token');
        sessionStorage.clear();
      }
    }
  } catch (error) {
    // If JSON parsing fails, definitely clear
    console.log('Clearing invalid auth data...');
    localStorage.removeItem('rpa-auth-storage');
    localStorage.removeItem('rpa_token');
    sessionStorage.clear();
  }
};

// Run cleanup before mounting app
clearCorruptedAuthData();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />,
)