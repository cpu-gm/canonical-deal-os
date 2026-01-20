import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { createPageUrl } from './utils';
import {
  LayoutDashboard,
  Home,
  PlusCircle,
  GitBranch,
  Inbox,
  Search,
  MessageSquare,
  Shield,
  FileDown,
  Settings,
  ChevronRight,
  Menu,
  X,
  Users,
  CheckCircle2,
  UserPlus,
  Building2,
  FileInput,
  Send
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { ChatProvider } from '@/context/ChatContext';
import ChatPanel from '@/components/chat/ChatPanel';
import ChatFAB from '@/components/chat/ChatFAB';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/use-toast';

export const RoleContext = createContext();

export const useRole = () => useContext(RoleContext);

export default function Layout({ children, currentPageName }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [currentRole, setCurrentRole] = useState('GP');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, authToken } = useAuth();
  const queryClient = useQueryClient();
  const previousPendingRef = useRef(null);
  const notifiedRequestsRef = useRef(new Set());

  const roles = ['GP', 'GP Analyst', 'Lender', 'Counsel', 'Regulator', 'Auditor', 'LP'];

  // Check if user is an admin
  const isAdmin = user?.role === 'Admin';

  // Approve mutation for quick approve from toast
  const approveMutation = useMutation({
    mutationFn: async (requestId) => {
      const res = await fetch(`/api/admin/verification-requests/${requestId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        }
      });
      if (!res.ok) throw new Error('Failed to approve');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['verification-queue']);
      toast({
        title: "User approved",
        description: "The user has been approved and can now access the platform.",
      });
    }
  });

  // Fetch pending verification count for admins
  const { data: verificationData } = useQuery({
    queryKey: ['verification-queue'],
    queryFn: async () => {
      const res = await fetch('/api/admin/verification-queue', {
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        }
      });
      if (!res.ok) return { requests: [] };
      return res.json();
    },
    enabled: isAdmin && !!authToken,
    refetchInterval: 30000 // Refetch every 30 seconds
  });

  const pendingCount = verificationData?.requests?.length || 0;
  const pendingRequests = verificationData?.requests || [];

  // Show toast when new verification request comes in
  useEffect(() => {
    if (!isAdmin || !pendingRequests.length) return;

    const isInitialLoad = previousPendingRef.current === null;

    // On initial load, show a summary toast if there are pending requests
    if (isInitialLoad && pendingRequests.length > 0) {
      // Mark all current requests as notified
      pendingRequests.forEach((req) => notifiedRequestsRef.current.add(req.id));

      toast({
        title: `${pendingRequests.length} user${pendingRequests.length > 1 ? 's' : ''} awaiting approval`,
        description: (
          <div className="flex flex-col gap-2">
            <p>You have pending verification requests that need your attention.</p>
            <button
              onClick={() => navigate(createPageUrl('AdminDashboard'))}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md font-medium transition-colors w-fit"
            >
              <UserPlus className="w-4 h-4" />
              Review Now
            </button>
          </div>
        ),
        duration: 10000,
      });
    } else {
      // Find new requests that we haven't notified about yet
      pendingRequests.forEach((request) => {
        if (!notifiedRequestsRef.current.has(request.id)) {
          notifiedRequestsRef.current.add(request.id);

          const handleApprove = () => {
            approveMutation.mutate(request.id);
          };

          toast({
            title: "New user awaiting approval",
            description: (
              <div className="flex flex-col gap-2">
                <p><strong>{request.user.name}</strong> ({request.user.email}) wants to join as {request.requestedRole}</p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleApprove}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-md font-medium transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Approve
                  </button>
                  <button
                    onClick={() => navigate(createPageUrl('AdminDashboard'))}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm rounded-md font-medium transition-colors"
                  >
                    View All
                  </button>
                </div>
              </div>
            ),
            duration: 15000, // Show for 15 seconds
          });
        }
      });
    }

    previousPendingRef.current = pendingRequests.length;
  }, [pendingRequests, isAdmin, navigate, approveMutation]);

  // URL-based role switching: ?role=GP%20Analyst
  useEffect(() => {
    const roleParam = searchParams.get('role');
    if (roleParam && roles.includes(roleParam)) {
      setCurrentRole(roleParam);
    }
  }, [searchParams]);

  const navSections = [
    {
      title: 'SELLING',
      items: [
        { name: 'Deal Intake', href: 'DealDrafts', icon: FileInput },
        { name: 'My Deals', href: 'Deals', icon: Building2 },
        { name: 'Distribution', href: 'DistributionManagement', icon: Send }
      ]
    },
    {
      title: 'BUYING',
      items: [
        { name: 'Deal Inbox', href: 'BuyerInbox', icon: Inbox },
        { name: 'My Criteria', href: 'BuyerCriteria', icon: Settings },
        { name: 'My Responses', href: 'BuyerResponses', icon: MessageSquare }
      ]
    },
    {
      title: 'PORTFOLIO',
      items: [
        { name: 'Home', href: 'Home', icon: Home },
        { name: 'Inbox', href: 'Inbox', icon: LayoutDashboard },
        { name: 'Create Deal', href: 'CreateDeal', icon: PlusCircle },
        { name: 'Investors', href: 'Investors', icon: Users },
        { name: 'Capital Calls', href: 'CapitalCalls', icon: LayoutDashboard },
        { name: 'Distributions', href: 'Distributions', icon: LayoutDashboard },
        { name: 'Investor Updates', href: 'InvestorUpdates', icon: LayoutDashboard },
        { name: 'Lifecycle', href: 'Lifecycle', icon: GitBranch },
        { name: 'Traceability', href: 'Traceability', icon: Search },
        { name: 'Explain', href: 'Explain', icon: MessageSquare },
        { name: 'Compliance', href: 'Compliance', icon: Shield },
        { name: 'Audit Export', href: 'AuditExport', icon: FileDown }
      ]
    }
  ];

  // Add admin navigation items
  const adminNavigation = isAdmin ? [
    { name: 'Admin Dashboard', href: 'AdminDashboard', icon: Users, badge: pendingCount },
  ] : [];

  return (
    <RoleContext.Provider value={{ currentRole, setCurrentRole }}>
      <style>{`
        :root {
          --color-bg: #FAFAFA;
          --color-surface: #FFFFFF;
          --color-border: #E5E5E5;
          --color-text-primary: #171717;
          --color-text-secondary: #737373;
          --color-text-tertiary: #A3A3A3;
          --color-accent: #0A0A0A;
          --color-success: #16A34A;
          --color-warning: #CA8A04;
          --color-danger: #DC2626;
        }
      `}</style>
      
      <div className="min-h-screen bg-[#FAFAFA] flex">
        {/* Mobile Overlay */}
        {mobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black/20 z-40 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside className={cn(
          "fixed left-0 top-0 h-full bg-white border-r border-[#E5E5E5] flex flex-col transition-all duration-300 z-50",
          sidebarCollapsed ? "w-16" : "w-64",
          "lg:translate-x-0",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}>
          {/* Logo */}
          <div className="h-16 flex items-center px-5 border-b border-[#E5E5E5] justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-[#0A0A0A] rounded-lg flex items-center justify-center">
                <span className="text-white font-semibold text-sm">C</span>
              </div>
              {!sidebarCollapsed && (
                <div>
                  <h1 className="font-semibold text-[#171717] text-sm tracking-tight">Canonical Deal OS</h1>
                  <p className="text-[10px] text-[#A3A3A3] tracking-wide">PROVABLE TRUTH</p>
                </div>
              )}
            </div>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-2 hover:bg-[#F5F5F5] rounded-lg"
            >
              <X className="w-5 h-5 text-[#171717]" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-4 px-3 space-y-4 overflow-y-auto">
            {navSections.map((section, sectionIndex) => (
              <div key={section.title} className="space-y-1">
                {!sidebarCollapsed && (
                  <div className={cn("px-3 pb-2", sectionIndex > 0 && "pt-4")}>
                    <span className="text-[10px] font-medium text-[#A3A3A3] uppercase tracking-wider">
                      {section.title}
                    </span>
                  </div>
                )}
                {section.items.map((item) => {
                  const isActive = currentPageName === item.href;
                  return (
                    <Link
                      key={item.name}
                      to={createPageUrl(item.href)}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                        isActive
                          ? "bg-[#0A0A0A] text-white"
                          : "text-[#737373] hover:bg-[#F5F5F5] hover:text-[#171717]"
                      )}
                    >
                      <item.icon className="w-4 h-4 flex-shrink-0" />
                      {!sidebarCollapsed && <span>{item.name}</span>}
                    </Link>
                  );
                })}
              </div>
            ))}

            {/* Admin Navigation */}
            {adminNavigation.length > 0 && (
              <>
                <div className="pt-4 pb-2 px-3">
                  {!sidebarCollapsed && (
                    <span className="text-[10px] font-medium text-[#A3A3A3] uppercase tracking-wider">Admin</span>
                  )}
                </div>
                {adminNavigation.map((item) => {
                  const isActive = currentPageName === item.href;
                  return (
                    <Link
                      key={item.name}
                      to={createPageUrl(item.href)}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 relative",
                        isActive
                          ? "bg-[#0A0A0A] text-white"
                          : "text-[#737373] hover:bg-[#F5F5F5] hover:text-[#171717]"
                      )}
                    >
                      <div className="relative">
                        <item.icon className="w-4 h-4 flex-shrink-0" />
                        {item.badge > 0 && sidebarCollapsed && (
                          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                            {item.badge > 9 ? '9+' : item.badge}
                          </span>
                        )}
                      </div>
                      {!sidebarCollapsed && (
                        <>
                          <span className="flex-1">{item.name}</span>
                          {item.badge > 0 && (
                            <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full font-medium">
                              {item.badge}
                            </span>
                          )}
                        </>
                      )}
                    </Link>
                  );
                })}
              </>
            )}
          </nav>

          {/* Role Switcher */}
          <div className="p-3 border-t border-[#E5E5E5]">
            {!sidebarCollapsed && (
              <div className="mb-2 px-3">
                <span className="text-[10px] font-medium text-[#A3A3A3] uppercase tracking-wider">Viewing As</span>
              </div>
            )}
            <Link
              to={createPageUrl('Settings')}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                currentPageName === 'Settings'
                  ? "bg-[#0A0A0A] text-white"
                  : "text-[#737373] hover:bg-[#F5F5F5] hover:text-[#171717]"
              )}
            >
              <Settings className="w-4 h-4" />
              {!sidebarCollapsed && (
                <div className="flex items-center justify-between flex-1">
                  <span className="text-sm font-medium">{currentRole}</span>
                  <ChevronRight className="w-3 h-3" />
                </div>
              )}
            </Link>
          </div>
        </aside>

        {/* Main Content */}
        <main className={cn(
          "flex-1 transition-all duration-300",
          "lg:ml-64",
          sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"
        )}>
          {/* Mobile Header */}
          <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-[#E5E5E5] flex items-center px-4 z-30">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 hover:bg-[#F5F5F5] rounded-lg"
            >
              <Menu className="w-5 h-5 text-[#171717]" />
            </button>
            <div className="ml-3 flex items-center gap-2">
              <div className="w-6 h-6 bg-[#0A0A0A] rounded-md flex items-center justify-center">
                <span className="text-white font-semibold text-xs">C</span>
              </div>
              <span className="font-semibold text-[#171717] text-sm">Canonical</span>
            </div>
          </div>

          <div className="min-h-screen pt-16 lg:pt-0">
            {children}
          </div>
        </main>

        {/* Chat Components */}
        <ChatProvider>
          <ChatPanel />
          <ChatFAB />
        </ChatProvider>
      </div>
    </RoleContext.Provider>
  );
}
