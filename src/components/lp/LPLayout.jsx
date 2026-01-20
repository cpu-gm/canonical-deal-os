import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import {
  Building2, Home, Briefcase, FileText, Activity, MessageSquare,
  User, Settings, LogOut, Bell, ChevronDown, HelpCircle, Search
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import LPAIChat from './LPAIChat';

const NAV_ITEMS = [
  { path: '/', label: 'Home', icon: Home },
  { path: '/investments', label: 'Investments', icon: Briefcase },
  { path: '/documents', label: 'Documents', icon: FileText },
  { path: '/activity', label: 'Activity', icon: Activity },
  { path: '/messages', label: 'Messages', icon: MessageSquare },
];

function NavItem({ item, isActive }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
        isActive
          ? "bg-blue-50 text-blue-700"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      )}
    >
      <Icon className="w-4 h-4" />
      {item.label}
    </NavLink>
  );
}

export default function LPLayout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout(false);
    window.location.href = '/Login';
  };

  const orgName = user?.organization?.name || 'Your GP';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo and brand */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600 rounded-lg">
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="font-semibold text-gray-900 text-sm">LP Investor Portal</h1>
                  <p className="text-xs text-gray-500">{orgName}</p>
                </div>
              </div>

              {/* Main navigation */}
              <nav className="hidden md:flex items-center gap-1">
                {NAV_ITEMS.map((item) => (
                  <NavItem
                    key={item.path}
                    item={item}
                    isActive={location.pathname === item.path ||
                      (item.path !== '/' && location.pathname.startsWith(item.path))}
                  />
                ))}
              </nav>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-3">
              {/* Search */}
              <Button variant="ghost" size="sm" className="hidden sm:flex">
                <Search className="w-4 h-4 text-gray-500" />
              </Button>

              {/* Notifications */}
              <Button variant="ghost" size="sm" className="relative">
                <Bell className="w-4 h-4 text-gray-500" />
                {/* Notification badge - show when there are unread notifications */}
                {/* <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span> */}
              </Button>

              {/* User menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                      <span className="text-sm font-medium text-blue-700">
                        {user?.name?.charAt(0)?.toUpperCase() || 'U'}
                      </span>
                    </div>
                    <span className="hidden sm:inline text-sm text-gray-700">
                      {user?.name || 'User'}
                    </span>
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-3 py-2">
                    <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                    <p className="text-xs text-gray-500">{user?.email}</p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/account')}>
                    <User className="w-4 h-4 mr-2" />
                    Account Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/account/preferences')}>
                    <Settings className="w-4 h-4 mr-2" />
                    Notification Preferences
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/account/tax')}>
                    <FileText className="w-4 h-4 mr-2" />
                    Tax Documents
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <HelpCircle className="w-4 h-4 mr-2" />
                    Help & Support
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Mobile navigation */}
        <div className="md:hidden border-t border-gray-100">
          <div className="px-4 py-2 flex gap-1 overflow-x-auto">
            {NAV_ITEMS.map((item) => (
              <NavItem
                key={item.path}
                item={item}
                isActive={location.pathname === item.path ||
                  (item.path !== '/' && location.pathname.startsWith(item.path))}
              />
            ))}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm text-gray-500">
              {orgName} LP Portal
            </p>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <button className="hover:text-gray-700">Privacy Policy</button>
              <button className="hover:text-gray-700">Terms of Service</button>
              <button className="hover:text-gray-700">Contact Support</button>
            </div>
          </div>
        </div>
      </footer>

      {/* AI Chat Assistant */}
      <LPAIChat />
    </div>
  );
}
