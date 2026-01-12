import Deals from './pages/Deals';
import CreateDeal from './pages/CreateDeal';
import DealOverview from './pages/DealOverview';
import Lifecycle from './pages/Lifecycle';
import Traceability from './pages/Traceability';
import Explain from './pages/Explain';
import Compliance from './pages/Compliance';
import AuditExport from './pages/AuditExport';
import Settings from './pages/Settings';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Deals": Deals,
    "CreateDeal": CreateDeal,
    "DealOverview": DealOverview,
    "Lifecycle": Lifecycle,
    "Traceability": Traceability,
    "Explain": Explain,
    "Compliance": Compliance,
    "AuditExport": AuditExport,
    "Settings": Settings,
}

export const pagesConfig = {
    mainPage: "Deals",
    Pages: PAGES,
    Layout: __Layout,
};