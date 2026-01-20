import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import LenderPortal from './pages/LenderPortal';
import LPPortalAuth from './pages/LPPortalAuth';
import LPInvestmentDetailAuth from './pages/LPInvestmentDetailAuth';
// New LP Portal pages
import LPHome from './pages/lp/LPHome';
import LPInvestments from './pages/lp/LPInvestments';
import LPCapitalCalls from './pages/lp/LPCapitalCalls';
import LPCapitalCallDetail from './pages/lp/LPCapitalCallDetail';
import LPDistributions from './pages/lp/LPDistributions';
import LPDistributionDetail from './pages/lp/LPDistributionDetail';
import LPUpdates from './pages/lp/LPUpdates';
import LPUpdateDetail from './pages/lp/LPUpdateDetail';
import ApiErrorOverlay from '@/components/dev/ApiErrorOverlay';
import ErrorBoundary from '@/components/ErrorBoundary';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>
    <ErrorBoundary>{children}</ErrorBoundary>
  </Layout>
  : <ErrorBoundary>{children}</ErrorBoundary>;

// LP User App - completely separate UI for LP role users
const LPUserApp = () => {
  return (
    <ErrorBoundary>
      <Routes>
      {/* New LP Portal pages */}
      <Route path="/" element={<LPHome />} />
      <Route path="/investments" element={<LPInvestments />} />
      <Route path="/investments/:dealId" element={<LPInvestmentDetailAuth />} />
      <Route path="/investments/:dealId/capital-calls" element={<LPCapitalCalls />} />
      <Route path="/investments/:dealId/capital-calls/:callId" element={<LPCapitalCallDetail />} />
      <Route path="/investments/:dealId/distributions" element={<LPDistributions />} />
      <Route path="/investments/:dealId/distributions/:distributionId" element={<LPDistributionDetail />} />
      <Route path="/investments/:dealId/updates" element={<LPUpdates />} />
      <Route path="/investments/:dealId/updates/:updateId" element={<LPUpdateDetail />} />

      {/* Legacy routes - redirect to new pages */}
      <Route path="/LPPortal" element={<Navigate to="/" replace />} />
      <Route path="/LPInvestmentDetail" element={<Navigate to="/investments" replace />} />
      <Route path="/Login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
};

const AuthenticatedApp = () => {
  const { user, isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Check if user is an LP - route to LP-specific UI
  if (user?.role === 'LP') {
    return <LPUserApp />;
  }

  // Render the main GP/Admin app
  return (
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <Routes>
            {/* Public portal routes (no auth required, token-based access) */}
            <Route
              path="/portal/lender"
              element={
                <ErrorBoundary>
                  <LenderPortal />
                </ErrorBoundary>
              }
            />
            {/* All other routes require auth */}
            <Route path="*" element={<AuthenticatedApp />} />
          </Routes>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
