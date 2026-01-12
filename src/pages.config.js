import Deals from './pages/Deals';
import CreateDeal from './pages/CreateDeal';
import DealOverview from './pages/DealOverview';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Deals": Deals,
    "CreateDeal": CreateDeal,
    "DealOverview": DealOverview,
}

export const pagesConfig = {
    mainPage: "Deals",
    Pages: PAGES,
    Layout: __Layout,
};