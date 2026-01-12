import Deals from './pages/Deals';
import CreateDeal from './pages/CreateDeal';
import DealOverview from './pages/DealOverview';
import Lifecycle from './pages/Lifecycle';
import Traceability from './pages/Traceability';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Deals": Deals,
    "CreateDeal": CreateDeal,
    "DealOverview": DealOverview,
    "Lifecycle": Lifecycle,
    "Traceability": Traceability,
}

export const pagesConfig = {
    mainPage: "Deals",
    Pages: PAGES,
    Layout: __Layout,
};