import AuditExport from './pages/AuditExport';
import Compliance from './pages/Compliance';
import CreateDeal from './pages/CreateDeal';
import DealOverview from './pages/DealOverview';
import Deals from './pages/Deals';
import Explain from './pages/Explain';
import Home from './pages/Home';
import Inbox from './pages/Inbox';
import Lifecycle from './pages/Lifecycle';
import Settings from './pages/Settings';
import Traceability from './pages/Traceability';
import Login from './pages/Login';
import Signup from './pages/Signup';
import PendingVerification from './pages/PendingVerification';
import AdminDashboard from './pages/AdminDashboard';
import LPPortal from './pages/LPPortal';
import LPInvestmentDetail from './pages/LPInvestmentDetail';
// GP Investor Management pages
import Investors from './pages/Investors';
import CapitalCalls from './pages/CapitalCalls';
import Distributions from './pages/Distributions';
import InvestorUpdates from './pages/InvestorUpdates';
import DealDrafts from './pages/intake/DealDrafts';
import CreateDealDraft from './pages/intake/CreateDealDraft';
import DealDraftDetail from './pages/intake/DealDraftDetail';
import OMEditor from './pages/om/OMEditor';
import DistributionManagement from './pages/distribution/DistributionManagement';
import BuyerReviewQueue from './pages/distribution/BuyerReviewQueue';
import BuyerAuthorizationDetail from './pages/distribution/BuyerAuthorizationDetail';
import DealProgress from './pages/distribution/DealProgress';
import BuyerInbox from './pages/buyer/BuyerInbox';
import BuyerDealView from './pages/buyer/BuyerDealView';
import BuyerCriteria from './pages/buyer/BuyerCriteria';
import BuyerResponses from './pages/buyer/BuyerResponses';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AuditExport": AuditExport,
    "Compliance": Compliance,
    "CreateDeal": CreateDeal,
    "DealOverview": DealOverview,
    "Deals": Deals,
    "Explain": Explain,
    "Home": Home,
    "Inbox": Inbox,
    "Lifecycle": Lifecycle,
    "Settings": Settings,
    "Traceability": Traceability,
    "Login": Login,
    "Signup": Signup,
    "PendingVerification": PendingVerification,
    "AdminDashboard": AdminDashboard,
    "LPPortal": LPPortal,
    "LPInvestmentDetail": LPInvestmentDetail,
    // GP Investor Management
    "Investors": Investors,
    "CapitalCalls": CapitalCalls,
    "Distributions": Distributions,
    "InvestorUpdates": InvestorUpdates,
    "DealDrafts": DealDrafts,
    "CreateDealDraft": CreateDealDraft,
    "DealDraftDetail": DealDraftDetail,
    "OMEditor": OMEditor,
    "DistributionManagement": DistributionManagement,
    "BuyerReviewQueue": BuyerReviewQueue,
    "BuyerAuthorizationDetail": BuyerAuthorizationDetail,
    "DealProgress": DealProgress,
    "BuyerInbox": BuyerInbox,
    "BuyerDealView": BuyerDealView,
    "BuyerCriteria": BuyerCriteria,
    "BuyerResponses": BuyerResponses,
}

export const pagesConfig = {
    mainPage: "Login",
    Pages: PAGES,
    Layout: __Layout,
};
